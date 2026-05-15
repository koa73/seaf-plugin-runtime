"""
YAML Schema Generator Library

Парсинг YAML схем SEAF и генерация YAML объектов на их основе.
Поддерживает: allOf, oneOf, anyOf, $ref, $defs, patternProperties, base_entity.
"""

from .schema_loader import SchemaLoader
from .schema_resolver import SchemaResolver, ResolvedEntity, OneOfBranch, PropertyDef
from .yaml_generator import YAMLGenerator
from .data_validator import DataValidator, ValidationResult, ValidationError
from .launcher import Launcher
from .flat_dict_utils import flatten_yaml, unflatten_dict, compare_flat_dicts

__all__ = [
    "SchemaLoader",
    "SchemaResolver",
    "ResolvedEntity",
    "OneOfBranch",
    "PropertyDef",
    "YAMLGenerator",
    "DataValidator",
    "ValidationResult",
    "ValidationError",
    "Launcher",
    "flatten_yaml",
    "unflatten_dict",
    "compare_flat_dicts",
]
