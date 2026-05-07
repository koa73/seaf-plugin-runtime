#!/usr/bin/env python3
"""Handle the draw.io `all_add` event and prepare follow-up commands."""

from typing import Any, Callable, Dict, List, Tuple

from lib.config import load_stencil_layer_config, resolve_layer_name
from lib.io import read_request, write_response
from lib.events import (
    build_collision_message,
    build_move_objects_to_layer_command,
    build_update_stencil_data_bulk_command,
    log_event_items,
    resolve_company_prefix,
)
from lib.logging import build_script_logger
from lib.oid import build_oid_updates, collect_import_conflicts


def create_oid(payload: Dict, log_info: Callable[[Dict], None]) -> Tuple[List[Dict], List[Dict]]:
    """Create OID updates and optional conflict notification command."""
    event = payload.get("event") or {}
    items = event.get("items") or []
    index = event.get("index") or {}
    by_oid = index.get("byOid") or {}
    company_prefix = resolve_company_prefix(payload)

    commands: List[Dict] = []
    conflicts = collect_import_conflicts(items, by_oid)
    if conflicts:
        commands.append(
            {
                "name": "showMessage",
                "args": {
                    "level": "info",
                    "text": build_collision_message(conflicts),
                },
            }
        )

    updates, assigned = build_oid_updates(items, company_prefix, by_oid)
    for row in assigned:
        log_info({"handler": "all_add", "action": "assign_oid", "objectId": row["objectId"], "OID": row["OID"]})

    return commands, updates


def create_layer_commands(payload: Dict, log_info: Callable[[Dict], None]) -> List[Dict]:
    """Build layer-routing commands for added items using schema config."""
    event = payload.get("event") or {}
    page = event.get("page") or {}
    page_id = page.get("id")
    items = event.get("items") or []
    layer_config = load_stencil_layer_config()

    grouped: Dict[str, List[str]] = {}
    for item in items:
        object_id = str(item.get("objectId") or item.get("id") or "").strip()
        if not object_id:
            continue
        schema = str(item.get("schema") or (item.get("data") or {}).get("schema") or "").strip()
        if not schema:
            log_info({"handler": "all_add", "action": "layer_skip_schema_missing", "objectId": object_id})
            continue
        layer_name, has_multiple = resolve_layer_name(schema, layer_config)
        if has_multiple:
            log_info(
                {
                    "handler": "all_add",
                    "action": "layer_config_multiple_values",
                    "schema": schema,
                    "selectedLayer": layer_name,
                }
            )
        if not layer_name:
            continue
        grouped.setdefault(layer_name, []).append(object_id)

    commands: List[Dict] = []
    for layer_name, object_ids in grouped.items():
        commands.append(build_move_objects_to_layer_command(page_id, layer_name, object_ids))
    return commands


def build_commands(payload: Dict, log_info: Callable[[Dict], None] = lambda _payload: None) -> List[Dict]:
    """Build command list and keep explicit execution order."""
    event = payload.get("event") or {}
    page = event.get("page") or {}
    page_id = page.get("id")

    commands: List[Dict] = []
    oid_commands, updates = create_oid(payload, log_info)
    commands.extend(oid_commands)

    if updates:
        commands.append(build_update_stencil_data_bulk_command(page_id, updates))
    commands.extend(create_layer_commands(payload, log_info))

    return commands


def main() -> int:
    """Read request, execute `all_add` handling, and write standardized response."""
    try:
        req = read_request()
        payload = req.get("payload") or {}
        logger = build_script_logger(payload)
        event = payload.get("event") or {}
        items = event.get("items") or []
        log_event_items("all_add", event, items, logger.info)
        commands = build_commands(payload, logger.info)
        return write_response(
            status="success",
            message=f"all_add processed: {len(items)}",
            payload={"handler": "all_add", "count": len(items), "note": "uiCommandResults are attached by renderer after command execution"},
            commands=commands,
        )
    except Exception as exc:
        logger = build_script_logger({})
        logger.error(f"all_add failed: {exc}")
        return write_response(status="error", message=f"all_add failed: {exc}", payload={"handler": "all_add"})


if __name__ == "__main__":
    raise SystemExit(main())
