"""Support functions for the all_add event handler."""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Sequence

from lib.oid import build_conflict_table_rows


def log_event_items(
    handler: str, event: Dict[str, Any], items: List[Dict[str, Any]], emit_info: Callable[[Dict[str, Any]], None]
) -> None:
    """Log each event item with page and geometry metadata."""
    page = event.get("page") or {}
    for item in items:
        geometry = item.get("geometry") or {}
        data = item.get("data") or {}
        object_id = item.get("objectId") or item.get("id")
        emit_info(
            {
                "handler": handler,
                "objectId": object_id,
                "pageId": page.get("id"),
                "pageName": page.get("name"),
                "geometry": {
                    "x": geometry.get("x"),
                    "y": geometry.get("y"),
                    "width": geometry.get("width"),
                    "height": geometry.get("height"),
                },
                "data": data,
            }
        )


def resolve_company_prefix(payload: Dict[str, Any], fallback: str = "company") -> str:
    """Resolve company prefix from arguments/env with deterministic fallback."""
    company_prefix = str((payload.get("arguments") or {}).get("companyPrefix") or "").strip()
    if company_prefix:
        return company_prefix

    env = payload.get("env") or {}
    company_prefix = str(env.get("companyPrefix") or "").strip()
    if company_prefix:
        return company_prefix

    return fallback


def build_collision_message(conflicts: List[Dict[str, Any]]) -> str:
    """Build user-facing collisions message with a tabular payload."""
    return (
        "Обнаружены коллизии OID при добавлении/импорте. "
        "Автоматическая дедупликация не выполняется. "
        "Требуется ручной разбор.\n\n"
        + build_conflict_table_rows(conflicts)
    )


def build_update_stencil_data_bulk_command(page_id: Any, updates: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Build command payload for batched stencil data updates."""
    return {
        "name": "updateStencilDataBulk",
        "args": {
            "pageId": page_id,
            "updates": updates,
        },
    }


def build_move_objects_to_layer_command(
    page_id: Any,
    layer_name: str,
    object_ids: List[str],
    *,
    suppress_stencil_events: bool = False,
    target_mode: str | None = None,
) -> Dict[str, Any]:
    """Build command payload to move explicit objects to a layer."""
    args: Dict[str, Any] = {
        "pageId": page_id,
        "layerName": layer_name,
        "objectIds": object_ids,
        "makeVisible": True,
    }
    if target_mode and str(target_mode).strip():
        args["targetMode"] = str(target_mode).strip()
    if suppress_stencil_events:
        args["suppressStencilEvents"] = True
    return {
        "name": "moveObjectsToLayer",
        "args": args,
    }


def build_move_layer_under_layer_command(
    page_id: Any,
    child_layer_name: str,
    parent_layer_name: str,
    *,
    suppress_stencil_events: bool = False,
) -> Dict[str, Any]:
    """Build UI command to reparent a layer mxCell under another page layer (nested layer tree)."""
    args: Dict[str, Any] = {
        "pageId": page_id,
        "childLayerName": str(child_layer_name or "").strip(),
        "parentLayerName": str(parent_layer_name or "").strip(),
        "makeVisible": True,
    }
    if suppress_stencil_events:
        args["suppressStencilEvents"] = True
    return {
        "name": "moveLayerUnderLayer",
        "args": args,
    }


def sanitize_patch_data(
    patch: Dict[str, Any],
    excluded_fields: Sequence[str] = ("OID", "schema"),
) -> Dict[str, Any]:
    """Return a patch without empty keys and excluded service attributes."""
    if not isinstance(patch, dict):
        return {}
    excluded = {str(name).strip() for name in excluded_fields if str(name).strip()}
    out: Dict[str, Any] = {}
    for key, value in patch.items():
        normalized_key = str(key).strip()
        if not normalized_key or normalized_key in excluded:
            continue
        out[normalized_key] = value
    return out


def build_data_mirror_atomic_command(
    schema: str,
    oid: str,
    patch: Dict[str, Any],
    source_rollbacks: List[Dict[str, Any]],
    excluded_fields: Sequence[str] = ("OID", "schema"),
) -> Dict[str, Any]:
    """Build atomic runtime command for schema+OID data mirroring."""
    return {
        "name": "mirrorDataByOidAtomic",
        "args": {
            "schema": str(schema or "").strip(),
            "oid": str(oid or "").strip(),
            "patch": patch if isinstance(patch, dict) else {},
            "excludedFields": [str(name) for name in excluded_fields if str(name).strip()],
            "sourceRollbacks": source_rollbacks if isinstance(source_rollbacks, list) else [],
            "mode": "merge",
            "suppressStencilEvents": True,
        },
    }


def format_data_mirror_error_details(failures: Sequence[Dict[str, Any]]) -> str:
    """Build readable error details with pageName and OID for user/log output."""
    rows: List[str] = []
    for failure in failures:
        if not isinstance(failure, dict):
            continue
        page_name = str(failure.get("pageName") or "unknown_page").strip() or "unknown_page"
        oid = str(failure.get("oid") or "unknown_oid").strip() or "unknown_oid"
        reason = str(failure.get("reason") or "unknown_error").strip() or "unknown_error"
        rows.append(f"[page={page_name}] [OID={oid}] {reason}")
    return "\n".join(rows)
