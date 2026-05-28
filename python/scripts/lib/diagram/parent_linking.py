"""Shared parent-linking helpers for stencil data prefill flows."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Tuple


def _config_path() -> Path:
    return Path(__file__).resolve().parents[4] / "conf" / "stencils" / "config.yaml"


def normalize_schema_list(raw_schema: Any) -> List[str]:
    if isinstance(raw_schema, str):
        normalized = raw_schema.strip()
        return [normalized] if normalized else []
    if not isinstance(raw_schema, list):
        return []
    out: List[str] = []
    for item in raw_schema:
        value = str(item or "").strip()
        if value and value not in out:
            out.append(value)
    return out


def load_parent_rules() -> Dict[str, Dict[str, Any]]:
    path = _config_path()
    if not path.exists():
        return {}

    text = path.read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore

        parsed = yaml.safe_load(text) or {}
        schemas = parsed.get("schemas") if isinstance(parsed, dict) else {}
        if not isinstance(schemas, dict):
            return {}

        out: Dict[str, Dict[str, Any]] = {}
        for schema, entry in schemas.items():
            if not isinstance(schema, str) or not isinstance(entry, dict):
                continue
            parent = entry.get("parent")
            if not isinstance(parent, dict):
                continue
            parent_schemas = normalize_schema_list(parent.get("schema"))
            parent_field = str(parent.get("field") or "").strip()
            if parent_schemas and parent_field:
                out[schema.strip()] = {"schemas": parent_schemas, "field": parent_field}
        return out
    except Exception:
        return {}


def extract_stencil_items_from_payload(payload: Dict[str, Any], key: str = "selection") -> List[Dict[str, Any]]:
    selected = payload.get(key)
    if not isinstance(selected, list):
        return []
    out: List[Dict[str, Any]] = []
    seen_ids: set[str] = set()
    for item in selected:
        if not isinstance(item, dict):
            continue
        data = item.get("data") if isinstance(item.get("data"), dict) else {}
        object_id = str(item.get("objectId") or item.get("id") or "").strip()
        schema = str(data.get("schema") or "").strip()
        oid = str(data.get("OID") or "").strip()
        if not object_id or object_id in seen_ids:
            continue
        seen_ids.add(object_id)
        out.append(
            {
                "objectId": object_id,
                "schema": schema,
                "oid": oid,
                "data": data,
            }
        )
    return out


def build_parent_link_updates(
    selected: List[Dict[str, Any]],
    parent_rules: Dict[str, Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    updates: List[Dict[str, Any]] = []
    collisions: List[Dict[str, Any]] = []
    missing: List[Dict[str, Any]] = []
    skipped_no_rule: List[Dict[str, Any]] = []

    for child in selected:
        child_schema = str(child.get("schema") or "").strip()
        child_id = str(child.get("objectId") or "").strip()
        if not child_id:
            continue
        if not child_schema or child_schema not in parent_rules:
            skipped_no_rule.append({"objectId": child_id, "schema": child_schema})
            continue

        rule = parent_rules[child_schema]
        parent_schemas = [str(x).strip() for x in rule.get("schemas") or [] if str(x).strip()]
        parent_field = str(rule.get("field") or "").strip()
        if not parent_schemas or not parent_field:
            skipped_no_rule.append({"objectId": child_id, "schema": child_schema})
            continue

        candidates = [
            candidate
            for candidate in selected
            if str(candidate.get("objectId") or "").strip() != child_id
            and str(candidate.get("schema") or "").strip() in parent_schemas
            and str(candidate.get("oid") or "").strip()
        ]

        if len(candidates) == 1:
            updates.append(
                {
                    "objectId": child_id,
                    "mode": "merge",
                    "data": {parent_field: str(candidates[0].get("oid") or "").strip()},
                }
            )
            continue

        if len(candidates) == 0:
            missing.append(
                {
                    "objectId": child_id,
                    "schema": child_schema,
                    "expectedParentSchemas": parent_schemas,
                    "field": parent_field,
                }
            )
            continue

        collisions.append(
            {
                "objectId": child_id,
                "schema": child_schema,
                "expectedParentSchemas": parent_schemas,
                "field": parent_field,
                "candidateParentObjectIds": [str(x.get("objectId") or "").strip() for x in candidates],
                "candidateParentSchemas": [str(x.get("schema") or "").strip() for x in candidates],
                "candidateParentOids": [str(x.get("oid") or "").strip() for x in candidates],
            }
        )

    return updates, collisions, missing, skipped_no_rule
