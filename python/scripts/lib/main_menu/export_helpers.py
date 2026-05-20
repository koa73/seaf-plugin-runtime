"""Build schema/OID export dictionary and resolve output file path."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

EXPORT_EXCLUDED = frozenset({"id", "label", "link", "OID", "schema"})
_YAML_KEY_UNSAFE = re.compile(r"[^A-Za-z0-9_.-]")


def sanitize_export_data(data: Dict[str, Any]) -> Dict[str, Any]:
    """Return export payload attributes without service keys."""
    if not isinstance(data, dict):
        return {}
    out: Dict[str, Any] = {}
    for key, value in data.items():
        normalized_key = str(key).strip()
        if not normalized_key or normalized_key in EXPORT_EXCLUDED:
            continue
        if isinstance(value, (str, int, float, bool)) or value is None:
            out[normalized_key] = value
        else:
            out[normalized_key] = str(value)
    return out


def resolve_output_path(env: Dict[str, Any]) -> str:
    """Resolve output file path from env (Edit Config), with same-file fallback."""
    output_raw = str(env.get("outputSeafFile") or "").strip()
    use_same = env.get("useSameOutputFile") is True
    if output_raw:
        return output_raw
    if use_same:
        return str(env.get("inputSeafFile") or "").strip()
    return ""


def is_seaf_export_schema(schema: str) -> bool:
    """True when schema is a SEAF entity (seaf.*) subject to OID export rules."""
    return str(schema or "").strip().startswith("seaf.")


@dataclass
class ExportBuildStats:
    """Per-object stats collected during export_map build."""

    eligible: List[Dict[str, Any]] = field(default_factory=list)
    skipped_input: List[Dict[str, Any]] = field(default_factory=list)
    skipped_ignored: List[Dict[str, Any]] = field(default_factory=list)
    skipped_duplicate: List[Dict[str, Any]] = field(default_factory=list)

    @property
    def unique_eligible_count(self) -> int:
        return len(self.eligible)


def _object_ref(item: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "pageId": item.get("pageId"),
        "pageName": item.get("pageName") or "",
        "objectId": str(item.get("objectId") or item.get("id") or "").strip(),
        "schema": str(item.get("schema") or "").strip(),
        "oid": str(item.get("oid") or item.get("OID") or "").strip(),
    }


def build_export_by_schema(
    objects: Sequence[Dict[str, Any]],
    collect_stats: bool = False,
) -> Tuple[Dict[str, Dict[str, Dict[str, Any]]], List[str], Optional[ExportBuildStats]]:
    """Group schema objects into {schema: {OID: {attrs}}}."""
    export_map: Dict[str, Dict[str, Dict[str, Any]]] = {}
    warnings: List[str] = []
    stats = ExportBuildStats() if collect_stats else None
    seen_export_keys: set = set()

    for item in objects:
        if not isinstance(item, dict):
            continue
        ref = _object_ref(item)
        schema = ref["schema"]
        oid = ref["oid"]
        if not schema:
            if stats is not None:
                entry = dict(ref)
                entry["reason"] = "missing_schema"
                stats.skipped_ignored.append(entry)
            continue
        if not oid:
            if is_seaf_export_schema(schema):
                object_id = ref["objectId"] or "unknown"
                warnings.append(
                    f"SEAF object without OID: schema={schema}, objectId={object_id}"
                )
                if stats is not None:
                    entry = dict(ref)
                    entry["reason"] = "missing_oid_seaf"
                    stats.skipped_input.append(entry)
            elif stats is not None:
                entry = dict(ref)
                entry["reason"] = "missing_oid_non_seaf"
                stats.skipped_ignored.append(entry)
            continue

        raw_data = item.get("data") if isinstance(item.get("data"), dict) else {}
        sanitized = sanitize_export_data(raw_data)
        schema_bucket = export_map.setdefault(schema, {})
        export_key = (schema, oid)

        if export_key in seen_export_keys:
            if stats is not None:
                entry = dict(ref)
                if schema_bucket.get(oid) != sanitized:
                    warnings.append(
                        f"OID data conflict for schema={schema}, OID={oid}; using latest"
                    )
                    entry["reason"] = "oid_conflict"
                    stats.skipped_input.append(entry)
                else:
                    entry["reason"] = "duplicate_oid"
                    stats.skipped_duplicate.append(entry)
            schema_bucket[oid] = sanitized
            continue

        if oid in schema_bucket and schema_bucket[oid] != sanitized:
            warnings.append(f"OID data conflict for schema={schema}, OID={oid}; using latest")
            if stats is not None:
                entry = dict(ref)
                entry["reason"] = "oid_conflict"
                stats.skipped_input.append(entry)
        schema_bucket[oid] = sanitized
        seen_export_keys.add(export_key)
        if stats is not None:
            stats.eligible.append(ref)

    return export_map, warnings, stats


def count_unique_export_objects(export_map: Dict[str, Dict[str, Dict[str, Any]]]) -> int:
    """Count unique (schema, OID) instances in export map."""
    total = 0
    for oid_map in export_map.values():
        if isinstance(oid_map, dict):
            total += len(oid_map)
    return total


def schema_to_export_basename(schema: str) -> str:
    """Last two dot-separated components of schema (e.g. services.network_segments)."""
    parts = [part.strip() for part in str(schema or "").split(".") if part.strip()]
    if len(parts) >= 2:
        return ".".join(parts[-2:])
    if len(parts) == 1:
        return parts[0]
    return "unknown"


def schema_to_export_filename(schema: str) -> str:
    """YAML file name for one schema bucket."""
    return f"{schema_to_export_basename(schema)}.yaml"


def _yaml_quote_scalar(value: Any) -> str:
    if value is None:
        return '""'
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    text = str(value)
    if text == "" or _YAML_KEY_UNSAFE.search(text):
        escaped = text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        return f'"{escaped}"'
    return text


def _yaml_key(key: str) -> str:
    normalized = str(key or "").strip()
    if not normalized or _YAML_KEY_UNSAFE.search(normalized):
        escaped = normalized.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return normalized


def dump_yaml_oid_map(oid_map: Dict[str, Dict[str, Any]]) -> str:
    """Serialize {OID: {attr: value}} to YAML."""
    lines: List[str] = []
    for oid in sorted(oid_map.keys()):
        attrs = oid_map.get(oid) if isinstance(oid_map.get(oid), dict) else {}
        lines.append(f"{_yaml_key(oid)}:")
        if not attrs:
            lines.append("  {}")
            continue
        for attr_name in sorted(attrs.keys()):
            lines.append(f"  {_yaml_key(attr_name)}: {_yaml_quote_scalar(attrs[attr_name])}")
    return "\n".join(lines) + ("\n" if lines else "")


def dump_yaml_export_map(export_map: Dict[str, Dict[str, Dict[str, Any]]]) -> str:
    """Serialize full {schema: {OID: attrs}} map to YAML."""
    lines: List[str] = []
    for schema in sorted(export_map.keys()):
        oid_map = export_map.get(schema) if isinstance(export_map.get(schema), dict) else {}
        lines.append(f"{_yaml_key(schema)}:")
        nested = dump_yaml_oid_map(oid_map).splitlines()
        if not nested:
            lines.append("  {}")
            continue
        for line in nested:
            lines.append(f"  {line}" if line else "  ")
    return "\n".join(lines) + ("\n" if lines else "")


def is_directory_output_target(path: str) -> bool:
    """True when output path denotes a directory (existing dir, trailing slash, or no extension)."""
    normalized = str(path or "").strip()
    if not normalized:
        return False
    if normalized.endswith(("/", "\\")):
        return True
    if os.path.isdir(normalized):
        return True
    if os.path.isfile(normalized):
        return False
    _, ext = os.path.splitext(normalized)
    return ext == ""


def write_export_outputs(
    export_map: Dict[str, Dict[str, Dict[str, Any]]],
    output_path: str,
) -> Tuple[List[str], str]:
    """Write export map to directory (per-schema YAML) or single file (YAML/JSON)."""
    if is_directory_output_target(output_path):
        out_dir = os.path.abspath(output_path)
        os.makedirs(out_dir, exist_ok=True)
        written: List[str] = []
        for schema in sorted(export_map.keys()):
            oid_map = export_map.get(schema) if isinstance(export_map.get(schema), dict) else {}
            file_path = os.path.join(out_dir, schema_to_export_filename(schema))
            with open(file_path, "w", encoding="utf-8") as handle:
                handle.write(dump_yaml_oid_map(oid_map))
            written.append(file_path)
        return written, "directory"

    _, ext = os.path.splitext(output_path)
    if ext.lower() == ".json":
        with open(output_path, "w", encoding="utf-8") as handle:
            json.dump(export_map, handle, ensure_ascii=False, indent=2)
    else:
        with open(output_path, "w", encoding="utf-8") as handle:
            handle.write(dump_yaml_export_map(export_map))
    return [output_path], "file"
