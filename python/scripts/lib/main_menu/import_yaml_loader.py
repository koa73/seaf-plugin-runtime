"""Load and merge SEAF YAML files for P41 Import."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import yaml

from lib.main_menu.export_helpers import is_seaf_export_schema
from lib.main_menu.export_yaml_generator import ExportYamlGeneratorService, default_schema_dir
from lib.main_menu.seaf_data_map import normalize_import_attrs


@dataclass
class ImportLoadStats:
    """Detailed loader statistics for INFO/DEBUG reporting."""

    files_read: List[str] = field(default_factory=list)
    files_invalid: List[Dict[str, Any]] = field(default_factory=list)
    loaded: List[Dict[str, Any]] = field(default_factory=list)
    skipped_duplicate: List[Dict[str, Any]] = field(default_factory=list)
    skipped_schema: List[Dict[str, Any]] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    @property
    def loaded_count(self) -> int:
        return len(self.loaded)


def build_import_map_from_sources(
    yaml_files: List[str],
    env: Optional[Dict[str, Any]] = None,
) -> Tuple[Dict[str, Dict[str, Dict[str, Any]]], ImportLoadStats]:
    """Load yaml files and merge into map {schema: {oid: attrs}}."""
    stats = ImportLoadStats()
    import_map: Dict[str, Dict[str, Dict[str, Any]]] = {}
    service = ExportYamlGeneratorService(default_schema_dir(env))
    seen_keys: set = set()

    for path in yaml_files:
        stats.files_read.append(path)
        parsed = _read_yaml_file(path)
        if not isinstance(parsed, dict):
            stats.files_invalid.append({"file": path, "reason": "root_not_object"})
            continue

        file_loaded = 0
        for schema, oid_map in parsed.items():
            schema_s = str(schema or "").strip()
            if not is_seaf_export_schema(schema_s):
                continue
            if not isinstance(oid_map, dict):
                stats.files_invalid.append(
                    {"file": path, "reason": "schema_value_not_object", "schema": schema_s}
                )
                continue
            if not service.has_entity(schema_s):
                stats.skipped_schema.append({"file": path, "schema": schema_s})
                stats.warnings.append(f"schema not in catalog, skipped: {schema_s}")
                continue

            schema_bucket = import_map.setdefault(schema_s, {})
            for oid, attrs in oid_map.items():
                oid_s = str(oid or "").strip()
                if not oid_s:
                    continue
                if not isinstance(attrs, dict):
                    stats.files_invalid.append(
                        {
                            "file": path,
                            "reason": "oid_value_not_object",
                            "schema": schema_s,
                            "oid": oid_s,
                        }
                    )
                    continue

                normalized = normalize_import_attrs(attrs)
                key = (schema_s, oid_s)
                if key in seen_keys:
                    prev = schema_bucket.get(oid_s)
                    if prev == normalized:
                        stats.skipped_duplicate.append(
                            {
                                "file": path,
                                "schema": schema_s,
                                "oid": oid_s,
                                "reason": "duplicate_oid_same_attrs",
                            }
                        )
                    else:
                        stats.warnings.append(
                            f"OID data conflict for schema={schema_s}, OID={oid_s}; using latest"
                        )
                        stats.skipped_duplicate.append(
                            {
                                "file": path,
                                "schema": schema_s,
                                "oid": oid_s,
                                "reason": "duplicate_oid_conflict",
                            }
                        )
                schema_bucket[oid_s] = normalized
                seen_keys.add(key)
                file_loaded += 1
                stats.loaded.append({"file": path, "schema": schema_s, "oid": oid_s})

        if file_loaded == 0:
            stats.files_invalid.append({"file": path, "reason": "no_valid_seaf_data"})

    return import_map, stats


def _read_yaml_file(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}

