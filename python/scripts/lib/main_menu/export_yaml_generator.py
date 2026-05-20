"""SEAF YAML export via vendored yaml_schema_generator."""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from lib.main_menu.export_helpers import (
    is_directory_output_target,
    schema_to_export_filename,
)
from lib.main_menu.export_report import ExportReport

_VENDOR_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "vendor")
)
if _VENDOR_ROOT not in sys.path:
    sys.path.insert(0, _VENDOR_ROOT)

from yaml_schema_generator.schema_loader import SchemaLoader  # noqa: E402
from yaml_schema_generator.yaml_generator import YAMLGenerator  # noqa: E402
from yaml_schema_generator.data_validator import DataValidator  # noqa: E402


def default_schema_dir(env: Optional[Dict[str, Any]] = None) -> str:
    """Resolve bundled schemas directory (optional env.schemaDir override)."""
    env = env or {}
    override = str(env.get("schemaDir") or "").strip()
    if override and os.path.isdir(override):
        return os.path.abspath(override)
    return os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "vendor", "yaml_schema_generator", "schemas"
    )


def _normalize_export_value(value: Any) -> Any:
    """Coerce draw.io string encodings to types expected by schema generator."""
    if not isinstance(value, str):
        return value
    text = value.strip()
    if text == "[]":
        return []
    if text.startswith("[") and text.endswith("]"):
        try:
            parsed = json.loads(text.replace("'", '"'))
            if isinstance(parsed, list):
                return parsed
        except (json.JSONDecodeError, ValueError):
            pass
    return value


def normalize_instance_attrs(attrs: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize attribute dict before YAML generation."""
    out: Dict[str, Any] = {}
    for key, value in attrs.items():
        normalized_key = str(key).strip()
        if not normalized_key:
            continue
        out[normalized_key] = _normalize_export_value(value)
    return out


@dataclass
class GeneratorWriteResult:
    """Result of writing export_map through yaml_schema_generator."""

    written_files: List[str] = field(default_factory=list)
    write_mode: str = "directory"
    warnings: List[str] = field(default_factory=list)
    schemas_exported: List[str] = field(default_factory=list)
    schemas_skipped: List[str] = field(default_factory=list)
    exported: List[Dict[str, Any]] = field(default_factory=list)
    validation_errors: List[Dict[str, Any]] = field(default_factory=list)
    skipped_schema: List[Dict[str, Any]] = field(default_factory=list)


class ExportYamlGeneratorService:
    """Wrap SchemaLoader + YAMLGenerator for plugin export."""

    def __init__(self, schema_dir: str):
        self.schema_dir = os.path.abspath(schema_dir)
        self.loader = SchemaLoader(self.schema_dir).load_all()
        self.generator = YAMLGenerator(self.loader)
        self.validator = DataValidator(self.loader)

    def has_entity(self, schema: str) -> bool:
        return self.loader.has_entity(schema)

    def generate_schema_yaml(self, schema: str, oid_map: Dict[str, Dict[str, Any]]) -> Optional[str]:
        instances = {
            oid: normalize_instance_attrs(attrs)
            for oid, attrs in oid_map.items()
            if isinstance(attrs, dict)
        }
        return self.generator.generate_yaml_string(
            schema,
            instances,
            include_extra_fields=True,
        )

    def validate_schema_instances(
        self, schema: str, oid_map: Dict[str, Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        instances = {
            oid: normalize_instance_attrs(attrs)
            for oid, attrs in oid_map.items()
            if isinstance(attrs, dict)
        }
        result = self.validator.validate(schema, instances)
        errors: List[Dict[str, Any]] = []
        for err in result.errors:
            field_path = str(getattr(err, "field_path", "") or "")
            oid = field_path.split(".", 1)[0] if field_path else ""
            errors.append(
                {
                    "schema": schema,
                    "oid": oid,
                    "fieldPath": field_path,
                    "message": str(getattr(err, "message", err)),
                    "value": getattr(err, "value", None),
                }
            )
        return errors


def write_export_outputs_via_generator(
    export_map: Dict[str, Dict[str, Dict[str, Any]]],
    output_path: str,
    env: Optional[Dict[str, Any]] = None,
    report: Optional[ExportReport] = None,
) -> GeneratorWriteResult:
    """Write export_map using yaml_schema_generator (SEAF entity wrapper in YAML)."""
    service = ExportYamlGeneratorService(default_schema_dir(env))
    result = GeneratorWriteResult()
    env = env or {}

    if is_directory_output_target(output_path):
        result.write_mode = "directory"
        out_dir = os.path.abspath(output_path)
        os.makedirs(out_dir, exist_ok=True)
        for schema in sorted(export_map.keys()):
            oid_map = export_map.get(schema) if isinstance(export_map.get(schema), dict) else {}
            if not oid_map:
                continue
            _write_one_schema(service, schema, oid_map, out_dir, result, report)
        result.written_files = sorted(result.written_files)
        return result

    result.write_mode = "file"
    _, ext = os.path.splitext(output_path)
    if ext.lower() == ".json":
        import json as json_mod

        serializable: Dict[str, Any] = {}
        for schema in sorted(export_map.keys()):
            oid_map = export_map.get(schema) if isinstance(export_map.get(schema), dict) else {}
            if not service.has_entity(schema):
                result.schemas_skipped.append(schema)
                result.warnings.append(f"schema not in catalog, skipped: {schema}")
                if report is not None:
                    report.skipped_schema.append(
                        {
                            "schema": schema,
                            "oids": sorted(oid_map.keys()),
                            "reason": "schema_not_in_catalog",
                        }
                    )
                continue
            yaml_text = service.generate_schema_yaml(schema, oid_map)
            if yaml_text:
                import yaml as pyyaml

                serializable.update(pyyaml.safe_load(yaml_text) or {})
            result.validation_errors.extend(service.validate_schema_instances(schema, oid_map))
        with open(output_path, "w", encoding="utf-8") as handle:
            json_mod.dump(serializable, handle, ensure_ascii=False, indent=2)
        result.written_files = [output_path]
        result.schemas_exported = sorted(serializable.keys())
        return result

    parts: List[str] = []
    for schema in sorted(export_map.keys()):
        oid_map = export_map.get(schema) if isinstance(export_map.get(schema), dict) else {}
        if not oid_map:
            continue
        if not service.has_entity(schema):
            result.schemas_skipped.append(schema)
            result.warnings.append(f"schema not in catalog, skipped: {schema}")
            if report is not None:
                report.skipped_schema.append(
                    {
                        "schema": schema,
                        "oids": sorted(oid_map.keys()),
                        "reason": "schema_not_in_catalog",
                    }
                )
            continue
        yaml_text = service.generate_schema_yaml(schema, oid_map)
        if yaml_text:
            parts.append(yaml_text.rstrip() + "\n")
        result.schemas_exported.append(schema)
        result.validation_errors.extend(service.validate_schema_instances(schema, oid_map))
        file_path = output_path
        for oid in sorted(oid_map.keys()):
            result.exported.append(
                {
                    "schema": schema,
                    "oid": oid,
                    "outputFile": file_path,
                    "attrKeys": sorted(oid_map[oid].keys()) if isinstance(oid_map.get(oid), dict) else [],
                    "attrs": normalize_instance_attrs(oid_map[oid]) if isinstance(oid_map.get(oid), dict) else {},
                }
            )
    combined = "\n".join(parts)
    with open(output_path, "w", encoding="utf-8") as handle:
        handle.write(combined)
    result.written_files = [output_path]
    return result


def _write_one_schema(
    service: ExportYamlGeneratorService,
    schema: str,
    oid_map: Dict[str, Dict[str, Any]],
    out_dir: str,
    result: GeneratorWriteResult,
    report: Optional[ExportReport],
) -> None:
    if not service.has_entity(schema):
        result.schemas_skipped.append(schema)
        result.warnings.append(f"schema not in catalog, skipped: {schema}")
        skipped_entry = {
            "schema": schema,
            "oids": sorted(oid_map.keys()),
            "reason": "schema_not_in_catalog",
        }
        result.skipped_schema.append(skipped_entry)
        if report is not None:
            report.skipped_schema.append(skipped_entry)
        return

    yaml_text = service.generate_schema_yaml(schema, oid_map)
    if not yaml_text:
        result.warnings.append(f"YAML generation failed for schema={schema}")
        return

    file_path = os.path.join(out_dir, schema_to_export_filename(schema))
    with open(file_path, "w", encoding="utf-8") as handle:
        handle.write(yaml_text)
    result.written_files.append(file_path)
    result.schemas_exported.append(schema)
    result.validation_errors.extend(service.validate_schema_instances(schema, oid_map))

    for oid in sorted(oid_map.keys()):
        attrs = oid_map.get(oid) if isinstance(oid_map.get(oid), dict) else {}
        entry = {
            "schema": schema,
            "oid": oid,
            "outputFile": file_path,
            "attrKeys": sorted(attrs.keys()),
            "attrs": normalize_instance_attrs(attrs),
        }
        result.exported.append(entry)
        if report is not None:
            report.exported.append(entry)
