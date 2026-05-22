"""Build diagram indexes from payload.schemaObjects (shared by Import and Edit Data)."""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from lib.main_menu.export_helpers import is_seaf_export_schema


def _normalize_schema_object(item: Dict[str, Any]) -> Dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    schema = str(item.get("schema") or "").strip()
    oid = str(item.get("oid") or item.get("OID") or "").strip()
    object_id = str(item.get("objectId") or item.get("id") or "").strip()
    if not schema or not oid or not object_id:
        return None
    if not is_seaf_export_schema(schema):
        return None
    cell_data = item.get("data") if isinstance(item.get("data"), dict) else {}
    linked_page_id = str(item.get("linkedPageId") or "").strip()
    return {
        "pageId": item.get("pageId"),
        "pageName": item.get("pageName") or "",
        "objectId": object_id,
        "schema": schema,
        "oid": oid,
        "data": dict(cell_data),
        "linkedPageId": linked_page_id,
    }


def build_diagram_index_by_schema_oid(
    schema_objects: List[Dict[str, Any]],
) -> Dict[Tuple[str, str], List[Dict[str, Any]]]:
    """Map (schema, oid) -> list of diagram object snapshots."""
    out: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    for item in schema_objects:
        normalized = _normalize_schema_object(item)
        if normalized is None:
            continue
        key = (normalized["schema"], normalized["oid"])
        out.setdefault(key, []).append(normalized)
    return out


def build_diagram_index_by_object_id(
    schema_objects: List[Dict[str, Any]],
) -> Dict[str, Dict[str, Any]]:
    """Map objectId -> diagram object snapshot (last wins if duplicate ids)."""
    out: Dict[str, Dict[str, Any]] = {}
    for item in schema_objects:
        normalized = _normalize_schema_object(item)
        if normalized is None:
            continue
        out[normalized["objectId"]] = normalized
    return out
