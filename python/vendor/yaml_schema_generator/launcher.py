"""
Ланчер — точка входа для генерации YAML из словаря.

Принимает на вход данные в формате словаря, выбирает соответствующий шаблон
и формирует на выходе YAML файл.

Пример использования:
    # Программный API
    from yaml_schema_generator import Launcher

    launcher = Launcher("/path/to/schemas")
    result = launcher.run({
        "entity_type": "seaf.company.ta.services.dcs",
        "jupiter.dc.moscow_dc01": {
            "title": "Sber Cloud DC",
            "vendor": "Sber",
            "ownership": "Собственный",
            ...
        }
    }, output_path="/path/to/output.yaml")

    # CLI
    python -m yaml_schema_generator.launcher input.json output.yaml --schemas /path/to/schemas
"""

import json
import sys
import os
from typing import Any, Dict, Optional

import yaml

from .schema_loader import SchemaLoader
from .yaml_generator import YAMLGenerator
from .data_validator import DataValidator


class Launcher:
    """Ланчер генерации YAML файлов.

    Получает на вход данные в формате словаря, выбирает соответствующий
    шаблон (схему) и формирует на выходе YAML файл.
    """

    def __init__(self, schema_dir: str):
        """
        Args:
            schema_dir: Путь к каталогу с YAML-схемами.
        """
        self.schema_dir = schema_dir
        self.loader = SchemaLoader(schema_dir).load_all()
        self.generator = YAMLGenerator(self.loader)
        self.validator = DataValidator(self.loader)

    def run(
        self,
        data: dict,
        output_path: Optional[str] = None,
        validate: bool = True,
        include_extra: bool = True,
    ) -> Dict[str, Any]:
        """Выполнить генерацию YAML.

        Args:
            data: Входные данные в формате:
                {
                    "entity_type": "seaf.company.ta.services.dcs",
                    "instance.key.1": { ... },
                    "instance.key.2": { ... }
                }
                или плоский формат:
                {
                    "entity_type": "...",
                    "key|field": value,
                    ...
                }
            output_path: Путь для сохранения YAML файла. Если None — не сохранять.
            validate: Проверять ли данные перед генерацией.
            include_extra: Включать ли поля, отсутствующие в схеме.

        Returns:
            Словарь с результатом:
            {
                "success": bool,
                "yaml_string": str or None,
                "output_path": str or None,
                "validation": ValidationResult or None,
                "entity_type": str,
                "error": str or None
            }
        """
        result = {
            "success": False,
            "yaml_string": None,
            "output_path": None,
            "validation": None,
            "entity_type": "",
            "error": None,
        }

        # Определяем тип сущности
        entity_type = self._detect_entity_type(data)
        if not entity_type:
            result["error"] = "Не удалось определить тип сущности. Укажите 'entity_type' в данных."
            return result

        result["entity_type"] = entity_type

        # Проверяем наличие схемы
        if not self.loader.has_entity(entity_type):
            available = self.loader.list_entities()
            result["error"] = (
                f"Схема для сущности '{entity_type}' не найдена. "
                f"Доступные: {available[:10]}..."
            )
            return result

        # Определяем формат данных (плоский или иерархический)
        is_flat = self._is_flat_format(data)
        if is_flat:
            # Конвертируем плоский формат в иерархический
            from .flat_dict_utils import unflatten_dict
            separator = self._detect_separator(data)
            hierarchical_data = unflatten_dict(data, separator=separator)
            instances = hierarchical_data.get(entity_type, {})
        else:
            # Извлекаем экземпляры
            instances = {}
            for k, v in data.items():
                if k == "entity_type":
                    continue
                if isinstance(v, dict):
                    instances[k] = v

        # Валидация
        if validate:
            validation_result = self.validator.validate(entity_type, instances)
            result["validation"] = validation_result
            if not validation_result.is_valid:
                result["error"] = (
                    f"Ошибки валидации ({len(validation_result.errors)}): "
                    + "; ".join(str(e) for e in validation_result.errors[:5])
                )
                # Продолжаем генерацию даже при ошибках валидации

        # Генерация YAML
        yaml_string = self.generator.generate_yaml_string(
            entity_type, instances, include_extra_fields=include_extra
        )
        if yaml_string is None:
            result["error"] = "Ошибка генерации YAML"
            return result

        result["yaml_string"] = yaml_string
        result["success"] = True

        # Сохранение в файл
        if output_path:
            os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(yaml_string)
            result["output_path"] = output_path

        return result

    def run_batch(
        self,
        batch_data: list,
        output_dir: str,
        validate: bool = True,
    ) -> list:
        """Пакетная генерация нескольких YAML файлов.

        Args:
            batch_data: Список словарей с данными.
            output_dir: Каталог для сохранения.
            validate: Проверять ли данные.

        Returns:
            Список результатов для каждого элемента.
        """
        results = []
        for i, data in enumerate(batch_data):
            entity_type = data.get("entity_type", f"unknown_{i}")
            # Формируем имя файла из entity_type
            safe_name = entity_type.split(".")[-1] if "." in entity_type else entity_type
            output_path = os.path.join(output_dir, f"{safe_name}.yaml")

            result = self.run(data, output_path, validate)
            results.append(result)

        return results

    def _detect_entity_type(self, data: dict) -> Optional[str]:
        """Определить тип сущности из входных данных."""
        if "entity_type" in data:
            return data["entity_type"]

        # Пробуем определить по структуре
        for key, value in data.items():
            if isinstance(value, dict) and "entity_type" in value:
                return value["entity_type"]

        return None

    def _is_flat_format(self, data: dict) -> bool:
        """Определить, является ли словарь плоским форматом."""
        non_meta_keys = [k for k in data.keys() if k != "entity_type"]
        if not non_meta_keys:
            return False

        # Плоский формат: значения — не словари (за исключением meta)
        non_dict_values = 0
        for key in non_meta_keys:
            if not isinstance(data[key], dict):
                non_dict_values += 1

        # Если больше половины значений — не словари, это плоский формат
        return non_dict_values > len(non_meta_keys) / 2

    def _detect_separator(self, data: dict) -> str:
        """Определить разделитель в плоском словаре."""
        for key in data.keys():
            if key == "entity_type":
                continue
            for sep in ["|", ":", "::", "."]:
                if sep in key:
                    return sep
            break
        return "|"


def main():
    """CLI точка входа."""
    import argparse

    parser = argparse.ArgumentParser(description="Генератор YAML из словаря по SEAF схемам")
    parser.add_argument("input", help="Входной JSON файл с данными")
    parser.add_argument("output", help="Выходной YAML файл")
    parser.add_argument(
        "--schemas", "-s",
        required=True,
        help="Путь к каталогу с YAML-схемами",
    )
    parser.add_argument(
        "--no-validate",
        action="store_true",
        help="Отключить валидацию",
    )
    parser.add_argument(
        "--no-extra",
        action="store_true",
        help="Не включать поля, отсутствующие в схеме",
    )

    args = parser.parse_args()

    # Загружаем входные данные
    with open(args.input, "r", encoding="utf-8") as f:
        if args.input.endswith(".json"):
            data = json.load(f)
        else:
            data = yaml.safe_load(f) or {}

    # Запускаем генерацию
    launcher = Launcher(args.schemas)
    result = launcher.run(
        data,
        output_path=args.output,
        validate=not args.no_validate,
        include_extra=not args.no_extra,
    )

    if result["success"]:
        print(f"YAML успешно сгенерирован: {result['output_path']}")
        if result["validation"] and not result["validation"].is_valid:
            print(f"Предупреждения валидации ({len(result['validation'].errors)}):")
            for err in result["validation"].errors:
                print(f"  - {err}")
    else:
        print(f"Ошибка: {result['error']}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
