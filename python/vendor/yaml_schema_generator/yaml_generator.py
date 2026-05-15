"""
Генератор YAML файлов из схем и входных данных.
"""

import copy
import re
from typing import Any, Dict, Optional

import yaml

from .schema_loader import SchemaLoader
from .schema_resolver import SchemaResolver
from .models import ResolvedEntity, PropertyDef, OneOfBranch


class YAMLGenerator:
    """Генератор YAML на основе схем SEAF.

    Принимает имя сущности и словарь с данными экземпляров,
    формирует корректный YAML-файл согласно схеме.
    """

    def __init__(self, schema_loader: SchemaLoader):
        self.loader = schema_loader
        self.resolver = SchemaResolver(schema_loader)

    def generate(
        self,
        entity_name: str,
        data: dict,
        include_extra_fields: bool = True,
    ) -> Optional[dict]:
        """Сгенерировать структуру YAML из данных.

        Args:
            entity_name: Имя сущности (например, 'seaf.company.ta.services.dcs').
            data: Словарь с данными.
                  Формат: {instance_key: {field: value, ...}, ...}
                  или {instance_key: {field: value}, ...} (без entity_type).
            include_extra_fields: Включать ли поля, отсутствующие в схеме.

        Returns:
            Словарь, готовый для сериализации в YAML, или None при ошибке.
        """
        entity = self.resolver.resolve_entity(entity_name)
        if entity is None:
            return None

        result = {}

        # Обработка входных данных
        instances_data = self._extract_instances(data, entity_name)
        if not instances_data:
            return {entity_name: {}}

        result[entity_name] = {}
        for instance_key, instance_data in instances_data.items():
            # Проверяем соответствие ключа паттерну
            if entity.instance_pattern:
                if not re.match(entity.instance_pattern, instance_key):
                    continue  # Пропускаем несоответствующие ключи

            result[entity_name][instance_key] = self._build_instance(
                entity, instance_key, instance_data, include_extra_fields
            )

        return result

    def generate_yaml_string(
        self,
        entity_name: str,
        data: dict,
        include_extra_fields: bool = True,
        sort_keys: bool = False,
    ) -> Optional[str]:
        """Сгенерировать YAML-строку.

        Args:
            entity_name: Имя сущности.
            data: Словарь с данными.
            include_extra_fields: Включать ли поля, отсутствующие в схеме.
            sort_keys: Сортировать ли ключи.

        Returns:
            YAML-строка или None при ошибке.
        """
        result = self.generate(entity_name, data, include_extra_fields)
        if result is None:
            return None
        return yaml.dump(
            result,
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=sort_keys,
            width=1000,
        )

    def generate_to_file(
        self,
        entity_name: str,
        data: dict,
        output_path: str,
        include_extra_fields: bool = True,
        sort_keys: bool = False,
    ) -> bool:
        """Сгенерировать YAML и записать в файл.

        Args:
            entity_name: Имя сущности.
            data: Словарь с данными.
            output_path: Путь к выходному файлу.
            include_extra_fields: Включать ли поля, отсутствующие в схеме.
            sort_keys: Сортировать ли ключи.

        Returns:
            True при успешной записи.
        """
        yaml_str = self.generate_yaml_string(
            entity_name, data, include_extra_fields, sort_keys
        )
        if yaml_str is None:
            return False

        with open(output_path, "w", encoding="utf-8") as f:
            f.write(yaml_str)
        return True

    def _is_flat_format(self, data: dict) -> bool:
        """Определить, является ли словарь плоским форматом (с разделителями)."""
        non_meta = [k for k in data.keys() if k != "entity_type" and k != "instances"]
        if not non_meta:
            return False
        # Если значения — не словари и ключи содержат разделитель, это плоский формат
        non_dict_count = 0
        for key in non_meta:
            if not isinstance(data[key], dict):
                non_dict_count += 1
        return non_dict_count > len(non_meta) / 2

    def _detect_separator(self, data: dict) -> str:
        """Определить разделитель в плоском словаре."""
        for key in data.keys():
            if key in ("entity_type", "instances"):
                continue
            for sep in ["|", ":", "::"]:
                if sep in key:
                    return sep
            break
        return "|"

    def _extract_instances(self, data: dict, entity_name: str) -> dict:
        """Извлечь словарь экземпляров из входных данных.

        Поддерживает форматы:
        - {"entity_type": "...", "instance_key": {fields...}}  — иерархический
        - {"entity_type": "...", "inst_key|field": value}      — плоский
        - {"instance_key": {fields...}}                         — иерархический без entity_type
        - {"instances": {"key": {fields...}}}                  — обёрнутый формат
        """
        # Формат с "instances"
        if "instances" in data and isinstance(data["instances"], dict):
            return data["instances"]

        # Проверяем, плоский ли формат
        if self._is_flat_format(data):
            return self._flat_to_instances(data)

        # Иерархический формат
        result = {}
        for key, value in data.items():
            if key == "entity_type":
                continue
            if isinstance(value, dict):
                result[key] = value

        return result

    def _flat_to_instances(self, flat_data: dict) -> dict:
        """Преобразовать плоский словарь в иерархический.

        {"jupiter.dc.moscow|title": "DC", "jupiter.dc.moscow|vendor": "Sber"}
        → {"jupiter.dc.moscow": {"title": "DC", "vendor": "Sber"}}
        """
        sep = self._detect_separator(flat_data)
        instances = {}

        for key, value in flat_data.items():
            if key in ("entity_type", "instances"):
                continue

            parts = key.split(sep, 1)
            if len(parts) != 2:
                continue

            inst_key, field_path = parts

            if inst_key not in instances:
                instances[inst_key] = {}

            # Устанавливаем вложенное значение
            self._set_nested(instances[inst_key], field_path, value, sep)

        return instances

    def _set_nested(self, obj: dict, path: str, value: Any, sep: str):
        """Установить вложенное значение по пути.

        Поддерживает пути вида: field.subfield.0.nested_field
        где 0 означает индекс в списке.
        """
        parts = path.split(sep)
        current = obj
        i = 0

        while i < len(parts):
            part = parts[i]
            is_last = (i == len(parts) - 1)

            # Если текущая часть — число и текущий объект — список
            if part.isdigit() and isinstance(current, list):
                idx = int(part)
                if is_last:
                    # Установка значения по индексу
                    while len(current) <= idx:
                        current.append(None)
                    current[idx] = value
                    return
                # Навигация по списку
                while len(current) <= idx:
                    current.append({})
                if isinstance(current[idx], dict):
                    current = current[idx]
                else:
                    current[idx] = {}
                    current = current[idx]
                i += 1
                continue

            # Если текущая часть — число, но мы в dict — проверяем, является ли
            # это индексом списка, который нужно создать
            if part.isdigit() and isinstance(current, dict) and not is_last:
                # Это может быть индекс в созданном списке
                i += 1
                continue

            # Если следующая часть — число
            next_part = parts[i + 1] if i + 1 < len(parts) else ""
            if next_part.isdigit() and not is_last:
                idx = int(next_part)
                if part not in current:
                    current[part] = []
                if not isinstance(current[part], list):
                    current[part] = []

                if i + 2 >= len(parts):
                    # Следующая часть — последняя, устанавливаем значение в список
                    while len(current[part]) <= idx:
                        current[part].append(None)
                    current[part][idx] = value
                    return

                # Навигация внутрь элемента списка
                while len(current[part]) <= idx:
                    current[part].append({})
                elem = current[part][idx]
                if isinstance(elem, dict):
                    current = elem
                else:
                    current[part][idx] = {}
                    current = current[part][idx]
                i += 2
                continue

            # Обычная установка или навигация
            if is_last:
                current[part] = value
                return

            # Навигация по dict
            if part not in current:
                current[part] = {}
            if not isinstance(current[part], dict):
                current[part] = {}
            current = current[part]
            i += 1

    def _build_instance(
        self,
        entity: ResolvedEntity,
        instance_key: str,
        data: dict,
        include_extra: bool,
    ) -> dict:
        """Построить один экземпляр сущности."""
        result = {}

        # Определяем, есть ли oneOf ветвление
        active_branch = None
        if entity.oneof_branches:
            active_branch = self._select_oneof_branch(entity.oneof_branches, data)

        # Собираем все допустимые свойства
        allowed_props = set(entity.properties.keys())
        if active_branch:
            allowed_props.update(active_branch.properties.keys())

        for field_name, value in data.items():
            if not include_extra and field_name not in allowed_props:
                continue

            pdef = entity.properties.get(field_name)
            if pdef is None and active_branch:
                pdef = active_branch.properties.get(field_name)

            if pdef is None:
                # Свойство не найдено в схеме — включаем как есть
                if include_extra:
                    result[field_name] = value
                continue

            # Обрабатываем значение согласно типу свойства
            result[field_name] = self._process_field_value(pdef, value)

        return result

    def _select_oneof_branch(
        self, branches: list, data: dict
    ) -> Optional[OneOfBranch]:
        """Выбрать подходящую oneOf ветку на основе данных."""
        for branch in branches:
            if not branch.discriminator_field:
                continue

            disc_value = data.get(branch.discriminator_field)
            if disc_value is None:
                continue

            if branch.discriminator_values and disc_value in branch.discriminator_values:
                return branch
            if branch.discriminator_value is not None and disc_value == branch.discriminator_value:
                return branch

        return None

    def _process_field_value(self, pdef: PropertyDef, value: Any) -> Any:
        """Обработать значение поля согласно определению свойства."""
        if value is None:
            return None

        # Для ref-полей — просто строка
        if pdef.prop_type == "ref":
            return value

        # Для строк — без преобразования
        if pdef.prop_type == "string":
            return str(value) if not isinstance(value, str) else value

        # Для чисел
        if pdef.prop_type == "integer":
            if isinstance(value, int) and not isinstance(value, bool):
                if pdef.minimum is not None:
                    value = max(value, pdef.minimum)
                return value
            try:
                result = int(value)
                if pdef.minimum is not None:
                    result = max(result, pdef.minimum)
                return result
            except (ValueError, TypeError):
                return value

        if pdef.prop_type == "number":
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                return value
            try:
                return float(value)
            except (ValueError, TypeError):
                return value

        # Для булевых
        if pdef.prop_type == "boolean":
            if isinstance(value, bool):
                return value
            if isinstance(value, str):
                return value.lower() in ("true", "yes", "1", "да")
            return bool(value)

        # Для массивов
        if pdef.prop_type == "array":
            if not isinstance(value, list):
                return value
            return value

        # Для объектов — рекурсивная обработка
        if pdef.prop_type == "object" and isinstance(value, dict):
            if pdef.properties:
                result = {}
                for pk, pv in value.items():
                    sub_def = pdef.properties.get(pk)
                    if sub_def:
                        result[pk] = self._process_field_value(sub_def, pv)
                    else:
                        result[pk] = pv
                return result
            return value

        return value
