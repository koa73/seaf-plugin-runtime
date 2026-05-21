"""
Модуль валидации JSON-шаблонов для device_analyzer
"""
import json
import sys
from pathlib import Path
from typing import Dict, Any, List, Tuple


class PatternValidator:
    """Валидатор JSON-шаблонов на основе JSON Schema."""

    def __init__(self, schema_path: str):
        self.schema_path = Path(schema_path).resolve()
        self.schema: Dict[str, Any] = {}
        self._load_schema()

    def _load_schema(self) -> None:
        """Загружает JSON Schema."""
        try:
            with open(self.schema_path, 'r', encoding='utf-8') as f:
                self.schema = json.load(f)
        except Exception as e:
            sys.stderr.write(f"❌ Ошибка загрузки схемы: {e}\n")
            sys.exit(1)

    def validate(self, pattern: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """
        Валидирует шаблон на соответствие схеме.
        
        Args:
            pattern: JSON-шаблон для валидации
            
        Returns:
            Кортеж (успешно, список ошибок)
        """
        errors = []

        # Проверка обязательных полей
        required = self.schema.get('required', [])
        for field in required:
            if field not in pattern:
                errors.append(f"Отсутствует обязательное поле: {field}")

        # Проверка типа vendor
        if 'vendor' in pattern:
            if not isinstance(pattern['vendor'], str) or not pattern['vendor'].strip():
                errors.append("Поле 'vendor' должно быть непустой строкой")

        # Проверка формата version
        if 'version' in pattern:
            import re
            version = pattern['version']
            if not isinstance(version, str) or not re.match(r'^\d+\.\d+$', version):
                errors.append(f"Поле 'version' должно быть в формате X.Y (получено: {version})")

        # Проверка vendor_signatures
        if 'vendor_signatures' in pattern:
            if not isinstance(pattern['vendor_signatures'], list):
                errors.append("Поле 'vendor_signatures' должно быть массивом")
            elif len(pattern['vendor_signatures']) == 0:
                errors.append("Поле 'vendor_signatures' не должно быть пустым")
            else:
                for i, sig in enumerate(pattern['vendor_signatures']):
                    if not isinstance(sig, str) or not sig.strip():
                        errors.append(f"vendor_signatures[{i}]: должен быть непустой строкой")

        # Проверка name_patterns
        if 'name_patterns' in pattern:
            errors.extend(self._validate_pattern_rules(pattern['name_patterns'], 'name_patterns'))

        # Проверка model_patterns
        if 'model_patterns' in pattern:
            errors.extend(self._validate_pattern_rules(pattern['model_patterns'], 'model_patterns'))

        # Проверка model_fallback_rules
        if 'model_fallback_rules' in pattern:
            errors.extend(self._validate_model_fallback_rules(pattern['model_fallback_rules']))

        # Проверка type_inference / type_rules
        if 'type_inference' in pattern:
            errors.extend(self._validate_type_rules(pattern['type_inference'], 'type_inference'))
        if 'type_rules' in pattern:
            errors.extend(self._validate_type_rules(pattern['type_rules'], 'type_rules'))

        # Проверка default_device_type
        if 'default_device_type' in pattern:
            # Читаем допустимые значения из схемы
            valid_types = self.schema.get('properties', {}).get('default_device_type', {}).get('enum', [
                'switch', 'router', 'firewall', 'router_or_switch',
                'wireless_controller', 'olt_device', 'carrier_switch',
                'carrier_router', 'enterprise_switch', 'enterprise_router',
                'load_balancer', 'unknown'
            ])
            if pattern['default_device_type'] not in valid_types:
                errors.append(f"Недопустимый default_device_type: {pattern['default_device_type']}. "
                            f"Допустимые: {', '.join(valid_types)}")

        # Проверка network_extraction_rules
        if 'network_extraction_rules' in pattern:
            errors.extend(self._validate_network_rules(pattern['network_extraction_rules']))

        # Проверка routing_extraction_rules
        if 'routing_extraction_rules' in pattern:
            errors.extend(self._validate_routing_rules(pattern['routing_extraction_rules']))

        # Проверка bgp_extraction_rules
        if 'bgp_extraction_rules' in pattern:
            if not isinstance(pattern['bgp_extraction_rules'], dict):
                errors.append("bgp_extraction_rules должен быть объектом")
            elif 'enabled' not in pattern['bgp_extraction_rules']:
                errors.append("bgp_extraction_rules должен содержать поле 'enabled'")

        # Проверка vxlan_extraction_rules
        if 'vxlan_extraction_rules' in pattern:
            if not isinstance(pattern['vxlan_extraction_rules'], dict):
                errors.append("vxlan_extraction_rules должен быть объектом")
            elif 'enabled' not in pattern['vxlan_extraction_rules']:
                errors.append("vxlan_extraction_rules должен содержать поле 'enabled'")

        # Проверка management_extraction_rules
        if 'management_extraction_rules' in pattern:
            if not isinstance(pattern['management_extraction_rules'], dict):
                errors.append("management_extraction_rules должен быть объектом")
            elif 'enabled' not in pattern['management_extraction_rules']:
                errors.append("management_extraction_rules должен содержать поле 'enabled'")

        return len(errors) == 0, errors

    def _validate_pattern_rules(self, rules: Any, field_name: str) -> List[str]:
        """Валидирует паттерны (name_patterns, model_patterns)."""
        errors = []
        if not isinstance(rules, list):
            return [f"{field_name} должен быть массивом"]

        for i, rule in enumerate(rules):
            if not isinstance(rule, dict):
                errors.append(f"{field_name}[{i}]: должен быть объектом")
                continue

            if 'pattern' not in rule:
                errors.append(f"{field_name}[{i}]: отсутствует обязательное поле 'pattern'")
            elif not isinstance(rule['pattern'], str) or not rule['pattern'].strip():
                errors.append(f"{field_name}[{i}]: 'pattern' должен быть непустой строкой")

            if 'group' not in rule:
                errors.append(f"{field_name}[{i}]: отсутствует обязательное поле 'group'")
            elif not isinstance(rule['group'], int) or rule['group'] < 0:
                errors.append(f"{field_name}[{i}]: 'group' должен быть неотрицательным числом")

            # Проверка приоритета
            if 'priority' in rule:
                if not isinstance(rule['priority'], int):
                    errors.append(f"{field_name}[{i}]: 'priority' должен быть числом")

        return errors

    def _validate_model_fallback_rules(self, rules: List[Any]) -> List[str]:
        """Валидирует model_fallback_rules."""
        errors = []
        if not isinstance(rules, list):
            return ["model_fallback_rules должен быть массивом"]

        for i, rule in enumerate(rules):
            if not isinstance(rule, dict):
                errors.append(f"model_fallback_rules[{i}]: должен быть объектом")
                continue

            if 'conditions' not in rule:
                errors.append(f"model_fallback_rules[{i}]: отсутствует 'conditions'")
            else:
                conditions = rule['conditions']
                if not isinstance(conditions, dict):
                    errors.append(f"model_fallback_rules[{i}]: 'conditions' должен быть объектом")
                elif not any(k in conditions for k in ['all', 'any', 'not']):
                    errors.append(f"model_fallback_rules[{i}]: 'conditions' должен содержать 'all', 'any' или 'not'")

            if 'model' not in rule:
                errors.append(f"model_fallback_rules[{i}]: отсутствует 'model'")
            elif not isinstance(rule['model'], str) or not rule['model'].strip():
                errors.append(f"model_fallback_rules[{i}]: 'model' должен быть непустой строкой")

        return errors

    def _validate_type_rules(self, rules: List[Any], field_name: str) -> List[str]:
        """Валидирует type_inference / type_rules."""
        errors = []
        if not isinstance(rules, list):
            return [f"{field_name} должен быть массивом"]

        for i, rule in enumerate(rules):
            if not isinstance(rule, dict):
                errors.append(f"{field_name}[{i}]: должен быть объектом")
                continue

            # Проверка наличия условий
            has_any = 'any' in rule
            has_all = 'all' in rule
            has_not = 'not' in rule

            if not (has_any or has_all):
                errors.append(f"{field_name}[{i}]: должен содержать 'any' или 'all'")

            # Проверка типа
            if 'type' not in rule:
                errors.append(f"{field_name}[{i}]: отсутствует 'type'")

            # Проверка score
            if 'score' in rule:
                if not isinstance(rule['score'], int) or rule['score'] < 0:
                    errors.append(f"{field_name}[{i}]: 'score' должен быть неотрицательным числом")

        return errors

    def _validate_network_rules(self, rules: Dict[str, Any]) -> List[str]:
        """Валидирует network_extraction_rules."""
        errors = []
        if not isinstance(rules, dict):
            return ["network_extraction_rules должен быть объектом"]

        if 'interfaces' in rules:
            intf = rules['interfaces']
            if not isinstance(intf, dict):
                errors.append("network_extraction_rules.interfaces должен быть объектом")
            else:
                # Проверка формата
                if 'format' in intf:
                    valid_formats = ['mikrotik_section', 'single_line', 'multi_line', 'juniper_set']
                    if intf['format'] not in valid_formats:
                        errors.append(f"Недопустимый format: {intf['format']}")

        if 'vlans' in rules:
            vlans = rules['vlans']
            if not isinstance(vlans, dict):
                errors.append("network_extraction_rules.vlans должен быть объектом")

        return errors

    def _validate_routing_rules(self, rules: Dict[str, Any]) -> List[str]:
        """Валидирует routing_extraction_rules."""
        errors = []
        if not isinstance(rules, dict):
            return ["routing_extraction_rules должен быть объектом"]

        if 'enabled' not in rules:
            errors.append("routing_extraction_rules должен содержать 'enabled'")

        if 'format' in rules:
            valid_formats = ['mikrotik_section', 'static_route']
            if rules['format'] not in valid_formats:
                errors.append(f"Недопустимый format: {rules['format']}")

        return errors


def validate_pattern_file(filepath: Path, schema: PatternValidator) -> Tuple[bool, List[str]]:
    """
    Валидирует файл шаблона.
    
    Args:
        filepath: Путь к файлу шаблона
        schema: Экземпляр валидатора
        
    Returns:
        Кортеж (успешно, список ошибок)
    """
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            pattern = json.load(f)
        return schema.validate(pattern)
    except json.JSONDecodeError as e:
        return False, [f"Ошибка JSON: {e}"]
    except Exception as e:
        return False, [f"Ошибка чтения файла: {e}"]
