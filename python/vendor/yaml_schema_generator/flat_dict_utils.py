"""
Утилиты для преобразования между иерархическими и плоскими словарями.
"""

from typing import Any, Dict, Optional


def flatten_yaml(
    yaml_data: dict,
    separator: str = "|",
) -> dict:
    """Преобразовать иерархический YAML-словарь в плоский словарь.

    Пример входа:
        {
            "seaf.company.ta.services.dcs": {
                "jupiter.dc.moscow_dc01": {
                    "title": "Sber Cloud DC",
                    "vendor": "Sber"
                }
            }
        }

    Пример выхода:
        {
            "entity_type": "seaf.company.ta.services.dcs",
            "jupiter.dc.moscow_dc01|title": "Sber Cloud DC",
            "jupiter.dc.moscow_dc01|vendor": "Sber"
        }

    Args:
        yaml_data: Иерархический словарь из YAML файла.
        separator: Разделитель для плоских ключей (по умолчанию '|').

    Returns:
        Плоский словарь {ключ: значение}.
    """
    result = {}

    if not yaml_data or not isinstance(yaml_data, dict):
        return result

    # Определяем entity_type (верхний уровень — один ключ)
    entity_names = [k for k in yaml_data.keys() if k != "imports"]
    if not entity_names:
        return result

    entity_type = entity_names[0]
    result["entity_type"] = entity_type

    # Обрабатываем экземпляры
    entity_data = yaml_data.get(entity_type, {})
    if isinstance(entity_data, dict):
        for inst_key, inst_data in entity_data.items():
            _flatten_instance(inst_key, inst_data, result, separator)

    return result


def _flatten_instance(
    inst_key: str,
    data: Any,
    result: dict,
    separator: str,
    prefix: str = "",
):
    """Рекурсивно преобразовать экземпляр в плоский словарь."""
    if isinstance(data, dict):
        for k, v in data.items():
            full_key = f"{inst_key}{separator}{prefix}{k}" if prefix else f"{inst_key}{separator}{k}"
            _flatten_value(full_key, v, result, separator)
    elif isinstance(data, list):
        for idx, item in enumerate(data):
            full_key = f"{inst_key}{separator}{prefix}{idx}" if prefix else f"{inst_key}{separator}{idx}"
            _flatten_value(full_key, item, result, separator)
    else:
        full_key = f"{inst_key}{separator}{prefix}" if prefix else inst_key
        result[full_key] = data


def _flatten_value(
    key: str,
    value: Any,
    result: dict,
    separator: str,
):
    """Рекурсивное Flatten одного значения."""
    if isinstance(value, dict):
        for k, v in value.items():
            _flatten_value(f"{key}{separator}{k}", v, result, separator)
    elif isinstance(value, list):
        for idx, item in enumerate(value):
            _flatten_value(f"{key}{separator}{idx}", item, result, separator)
    else:
        result[key] = value


def unflatten_dict(
    flat_data: dict,
    separator: str = "|",
) -> dict:
    """Преобразовать плоский словарь обратно в иерархический.

    Пример входа:
        {
            "entity_type": "seaf.company.ta.services.dcs",
            "jupiter.dc.moscow_dc01|title": "Sber Cloud DC",
            "jupiter.dc.moscow_dc01|vendor": "Sber"
        }

    Пример выхода:
        {
            "seaf.company.ta.services.dcs": {
                "jupiter.dc.moscow_dc01": {
                    "title": "Sber Cloud DC",
                    "vendor": "Sber"
                }
            }
        }

    Args:
        flat_data: Плоский словарь.
        separator: Разделитель для плоских ключей.

    Returns:
        Иерархический словарь.
    """
    entity_type = flat_data.get("entity_type", "")
    if not entity_type:
        return {}

    # Группируем по экземплярам
    instances = {}
    for key, value in flat_data.items():
        if key == "entity_type":
            continue

        parts = key.split(separator, 1)
        if len(parts) == 2:
            inst_key, field_path = parts
        elif len(parts) == 1:
            inst_key = parts[0]
            field_path = ""
        else:
            continue

        if inst_key not in instances:
            instances[inst_key] = {}

        if field_path:
            _set_nested_value(instances[inst_key], field_path, value, separator)

    return {entity_type: instances}


def _set_nested_value(obj: dict, path: str, value: Any, separator: str):
    """Установить вложенное значение по пути."""
    parts = path.split(separator)
    current = obj

    for i, part in enumerate(parts[:-1]):
        next_part = parts[i + 1] if i + 1 < len(parts) else ""

        # Определяем, нужен ли список
        if next_part.isdigit():
            idx = int(next_part)
            if part not in current:
                current[part] = []
            # Убеждаемся что это список
            if isinstance(current[part], list):
                while len(current[part]) <= idx:
                    current[part].append({})
                current = current[part][idx] if isinstance(current[part][idx], dict) else {}
                continue
            else:
                current = current[part]
                continue

        if part not in current:
            current[part] = {}
        current = current[part]

    last_part = parts[-1]
    if last_part.isdigit():
        idx = int(last_part)
        if not isinstance(current, list):
            parent_key = parts[-2] if len(parts) > 1 else None
            # Некорректная ситуация, просто устанавливаем
            current[last_part] = value
        else:
            while len(current) <= idx:
                current.append(None)
            current[idx] = value
    else:
        current[last_part] = value


def compare_flat_dicts(
    dict1: dict,
    dict2: dict,
    ignore_keys: Optional[list] = None,
) -> dict:
    """Сравнить два плоских словаря.

    Args:
        dict1: Первый словарь.
        dict2: Второй словарь.
        ignore_keys: Список ключей для игнорирования.

    Returns:
        Словарь с результатами сравнения:
        {
            "match": bool,
            "only_in_dict1": [keys],
            "only_in_dict2": [keys],
            "different_values": {key: (val1, val2)},
            "matched_keys": [keys]
        }
    """
    ignore = set(ignore_keys or [])
    keys1 = set(dict1.keys()) - ignore
    keys2 = set(dict2.keys()) - ignore

    only_in_1 = sorted(keys1 - keys2)
    only_in_2 = sorted(keys2 - keys1)
    common = keys1 & keys2

    different = {}
    matched = []
    for key in sorted(common):
        v1 = dict1[key]
        v2 = dict2[key]
        if v1 == v2:
            matched.append(key)
        else:
            different[key] = (v1, v2)

    is_match = len(only_in_1) == 0 and len(only_in_2) == 0 and len(different) == 0

    return {
        "match": is_match,
        "only_in_dict1": only_in_1,
        "only_in_dict2": only_in_2,
        "different_values": different,
        "matched_keys": matched,
    }
