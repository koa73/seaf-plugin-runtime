"""
Валидатор данных по YAML схемам.
Проверяет типы, enum, required, minimum/maximum и прочие ограничения.
"""

import re
from dataclasses import dataclass, field
from typing import Any, List, Optional

from .schema_loader import SchemaLoader
from .schema_resolver import SchemaResolver, ResolvedEntity
from .models import PropertyDef


@dataclass
class ValidationError:
    """Описание ошибки валидации."""
    field_path: str
    message: str
    value: Any = None
    expected: str = ""

    def __str__(self):
        parts = [f"Поле '{self.field_path}': {self.message}"]
        if self.value is not None:
            parts.append(f" (значение: {self.value!r})")
        if self.expected:
            parts.append(f" (ожидалось: {self.expected})")
        return "".join(parts)


@dataclass
class ValidationResult:
    """Результат валидации."""
    is_valid: bool = True
    errors: List[ValidationError] = field(default_factory=list)

    def add_error(self, field_path: str, message: str, value: Any = None, expected: str = ""):
        """Добавить ошибку валидации."""
        self.errors.append(ValidationError(
            field_path=field_path,
            message=message,
            value=value,
            expected=expected,
        ))
        self.is_valid = False

    def merge(self, other: "ValidationResult"):
        """Объединить с другим результатом."""
        if not other.is_valid:
            self.is_valid = False
            self.errors.extend(other.errors)


class DataValidator:
    """Валидатор входных данных по YAML-схемам SEAF."""

    def __init__(self, schema_loader: SchemaLoader):
        self.loader = schema_loader
        self.resolver = SchemaResolver(schema_loader)

    def validate(self, entity_name: str, data: dict) -> ValidationResult:
        """Валидировать данные по схеме сущности.

        Args:
            entity_name: Имя сущности.
            data: Словарь с данными экземпляров.
                  Формат: {instance_key: {field: value, ...}, ...}

        Returns:
            ValidationResult с деталями ошибок.
        """
        result = ValidationResult()

        entity = self.resolver.resolve_entity(entity_name)
        if entity is None:
            result.add_error("entity", f"Сущность '{entity_name}' не найдена")
            return result

        # Извлекаем экземпляры
        instances = self._extract_instances(data)
        if not instances:
            result.add_error("data", "Нет данных для валидации")
            return result

        for inst_key, inst_data in instances.items():
            # Проверяем паттерн ключа
            if entity.instance_pattern:
                if not re.match(entity.instance_pattern, inst_key):
                    result.add_error(
                        inst_key,
                        f"Ключ не соответствует паттерну: {entity.instance_pattern}",
                        value=inst_key,
                    )
                    continue

            # Валидируем экземпляр
            inst_result = self._validate_instance(entity, inst_key, inst_data)
            result.merge(inst_result)

        return result

    def validate_flat(self, entity_name: str, flat_data: dict, separator: str = "|") -> ValidationResult:
        """Валидировать плоский словарь по схеме.

        Args:
            entity_name: Имя сущности.
            flat_data: Плоский словарь {instance_key|field_path: value, ...}.
            separator: Разделитель в ключах.

        Returns:
            ValidationResult.
        """
        # Превращаем плоский словарь в иерархический
        hierarchical = {}
        for key, value in flat_data.items():
            if key == "entity_type":
                continue
            parts = key.split(separator, 1)
            if len(parts) == 2:
                inst_key, field_path = parts
                if inst_key not in hierarchical:
                    hierarchical[inst_key] = {}
                hierarchical[inst_key][field_path] = value
            else:
                # Ключ без разделителя — пропускаем
                continue

        return self.validate(entity_name, hierarchical)

    def _extract_instances(self, data: dict) -> dict:
        """Извлечь экземпляры из входных данных."""
        if "instances" in data and isinstance(data["instances"], dict):
            return data["instances"]

        result = {}
        for key, value in data.items():
            if key == "entity_type":
                continue
            if isinstance(value, dict):
                result[key] = value
        return result

    def _validate_instance(
        self, entity: ResolvedEntity, inst_key: str, data: dict
    ) -> ValidationResult:
        """Валидировать один экземпляр."""
        result = ValidationResult()

        # Проверяем обязательные поля
        for req_field in entity.required_fields:
            if req_field not in data:
                result.add_error(
                    f"{inst_key}.{req_field}",
                    f"Обязательное поле отсутствует",
                    expected=f"{req_field} (required)",
                )

        # Проверяем наличие дискриминатора oneOf
        active_branch = None
        if entity.oneof_branches:
            has_matching_branch = False
            for branch in entity.oneof_branches:
                if not branch.discriminator_field:
                    continue
                disc_value = data.get(branch.discriminator_field)
                if disc_value is not None:
                    if branch.discriminator_values and disc_value in branch.discriminator_values:
                        active_branch = branch
                        has_matching_branch = True
                        break
                    elif branch.discriminator_value is not None and disc_value == branch.discriminator_value:
                        active_branch = branch
                        has_matching_branch = True
                        break

            # Проверяем, что данные соответствуют хотя бы одной ветке
            if not has_matching_branch and entity.oneof_branches:
                # Пробуем определить по любому дискриминатору
                all_disc_fields = set()
                for b in entity.oneof_branches:
                    if b.discriminator_field:
                        all_disc_fields.add(b.discriminator_field)

                # Если дискриминаторное поле отсутствует — это ошибка
                for df in all_disc_fields:
                    if df not in data:
                        result.add_error(
                            f"{inst_key}.{df}",
                            f"Отсутствует поле-дискриминатор для oneOf (возможные значения см. в схеме)",
                            expected="одно из значений enum/const из oneOf",
                        )
                        break

        # Валидируем свойства
        all_props = dict(entity.properties)
        if active_branch:
            all_props.update(active_branch.properties)

        for field_name, value in data.items():
            field_path = f"{inst_key}.{field_name}"
            pdef = all_props.get(field_name)

            if pdef is None:
                # Поля нет в схеме — предупреждение, не ошибка
                if not entity.additional_properties:
                    result.add_error(
                        field_path,
                        f"Поле не определено в схеме, additionalProperties=false",
                        value=value,
                    )
                continue

            # Валидируем тип
            self._validate_type(field_path, pdef, value, result)

            # Валидируем enum
            if pdef.enum and value is not None:
                if value not in pdef.enum:
                    result.add_error(
                        field_path,
                        f"Значение не входит в допустимый список",
                        value=value,
                        expected=f"один из {pdef.enum}",
                    )

            # Валидируем const
            if pdef.const is not None and value is not None:
                if value != pdef.const:
                    result.add_error(
                        field_path,
                        f"Значение должно быть константой",
                        value=value,
                        expected=str(pdef.const),
                    )

            # Валидируем minimum
            if pdef.minimum is not None and value is not None:
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    if value < pdef.minimum:
                        result.add_error(
                            field_path,
                            f"Значение меньше минимально допустимого",
                            value=value,
                            expected=f">= {pdef.minimum}",
                        )

            # Валидируем maximum
            if pdef.maximum is not None and value is not None:
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    if value > pdef.maximum:
                        result.add_error(
                            field_path,
                            f"Значение больше максимально допустимого",
                            value=value,
                            expected=f"<= {pdef.maximum}",
                        )

            # Валидируем maxItems
            if pdef.max_items is not None and isinstance(value, list):
                if len(value) > pdef.max_items:
                    result.add_error(
                        field_path,
                        f"Количество элементов превышает максимум",
                        value=len(value),
                        expected=f"<= {pdef.max_items}",
                    )

            # Валидируем minItems
            if pdef.min_items is not None and isinstance(value, list):
                if len(value) < pdef.min_items:
                    result.add_error(
                        field_path,
                        f"Количество элементов меньше минимума",
                        value=len(value),
                        expected=f">= {pdef.min_items}",
                    )

            # Валидируем элементы массива
            if pdef.prop_type == "array" and isinstance(value, list):
                for idx, item in enumerate(value):
                    item_path = f"{field_path}[{idx}]"
                    self._validate_array_item(item_path, pdef, item, result)

            # Валидируем вложенные объекты
            if pdef.prop_type == "object" and isinstance(value, dict):
                if pdef.properties:
                    for pk, pv in value.items():
                        sub_def = pdef.properties.get(pk)
                        if sub_def:
                            sub_path = f"{field_path}.{pk}"
                            self._validate_type(sub_path, sub_def, pv, result)

        # Проверяем обязательные поля oneOf ветки
        if active_branch:
            for req_field in active_branch.required_fields:
                if req_field not in data and req_field not in entity.required_fields:
                    result.add_error(
                        f"{inst_key}.{req_field}",
                        f"Обязательное поле для ветки '{active_branch.title}' отсутствует",
                        expected=f"{req_field} (required в {active_branch.title})",
                    )

        return result

    def _validate_type(
        self, field_path: str, pdef: PropertyDef, value: Any, result: ValidationResult
    ):
        """Валидировать тип значения."""
        if value is None:
            return  # None всегда допустим (отсутствующее поле)

        if pdef.prop_type == "string":
            if not isinstance(value, str):
                result.add_error(
                    field_path,
                    "Неверный тип данных",
                    value=value,
                    expected="string",
                )

        elif pdef.prop_type == "integer":
            if isinstance(value, bool) or not isinstance(value, int):
                result.add_error(
                    field_path,
                    "Неверный тип данных",
                    value=value,
                    expected="integer",
                )

        elif pdef.prop_type == "number":
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                result.add_error(
                    field_path,
                    "Неверный тип данных",
                    value=value,
                    expected="number",
                )

        elif pdef.prop_type == "boolean":
            if not isinstance(value, bool):
                result.add_error(
                    field_path,
                    "Неверный тип данных",
                    value=value,
                    expected="boolean",
                )

        elif pdef.prop_type == "array":
            if not isinstance(value, list):
                result.add_error(
                    field_path,
                    "Неверный тип данных",
                    value=value,
                    expected="array",
                )

        elif pdef.prop_type == "object":
            if not isinstance(value, dict):
                result.add_error(
                    field_path,
                    "Неверный тип данных",
                    value=value,
                    expected="object",
                )

        # ref тип — строковая ссылка
        elif pdef.prop_type == "ref":
            if not isinstance(value, str):
                result.add_error(
                    field_path,
                    "Ссылочное поле должно быть строкой",
                    value=value,
                    expected="string (ref)",
                )

    def _validate_array_item(
        self, item_path: str, pdef: PropertyDef, item: Any, result: ValidationResult
    ):
        """Валидировать элемент массива."""
        if pdef.items_anyof:
            # anyOf — элемент может быть любого из указанных типов (все строки-ссылки)
            if not isinstance(item, str):
                result.add_error(
                    item_path,
                    "Элемент массива должен быть строкой-ссылкой",
                    value=item,
                    expected="string (anyOf ref)",
                )
        elif pdef.items_ref:
            # Одиночный $ref
            if not isinstance(item, str):
                result.add_error(
                    item_path,
                    "Элемент массива должен быть строкой-ссылкой",
                    value=item,
                    expected="string (ref)",
                )
        elif pdef.prop_type == "array" and isinstance(item, dict):
            # Массив объектов — проверяем свойства элементов
            if pdef.properties:
                for pk, pv in item.items():
                    sub_def = pdef.properties.get(pk)
                    if sub_def:
                        self._validate_type(f"{item_path}.{pk}", sub_def, pv, result)
