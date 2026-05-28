#!/usr/bin/env python3
"""Handle the draw.io `all_add` event and prepare follow-up commands."""

from typing import Any, Callable, Dict, List, Tuple

from lib.io import build_error_policy_payload, read_request, write_response
from lib.events import (
    build_layer_commands_for_items,
    build_collision_message,
    build_update_stencil_data_bulk_command,
    log_event_items,
    resolve_company_prefix,
)
from lib.logging import build_script_logger
from lib.oid import build_oid_updates_for_empty_oid_items, collect_import_conflicts


def _normalize_index_maps(event: Any, log_info: Callable[[Dict], None]) -> Tuple[Dict[str, Any], Dict[str, str]]:
    """Normalize event.index maps to keep OID generation robust."""
    if not isinstance(event, dict):
        log_info({"handler": "all_add", "action": "normalize_index", "warning": "event is not a dict"})
        return {}, {}
    index = event.get("index")
    if not isinstance(index, dict):
        if index is not None:
            log_info({"handler": "all_add", "action": "normalize_index", "warning": "event.index is not a dict"})
        return {}, {}

    raw_by_oid = index.get("byOid")
    by_oid: Dict[str, Any] = {}
    if isinstance(raw_by_oid, dict):
        for oid_raw, owners_raw in raw_by_oid.items():
            oid = str(oid_raw or "").strip()
            if not oid:
                continue
            owners: List[str] = []
            if isinstance(owners_raw, list):
                owners = [str(row).strip() for row in owners_raw if str(row).strip()]
            elif isinstance(owners_raw, dict):
                object_ids = owners_raw.get("objectIds")
                if isinstance(object_ids, list):
                    owners = [str(row).strip() for row in object_ids if str(row).strip()]
                else:
                    owners = [str(key).strip() for key in owners_raw.keys() if str(key).strip()]
            elif isinstance(owners_raw, str):
                owner = owners_raw.strip()
                if owner:
                    owners = [owner]
            by_oid[oid] = owners
    elif raw_by_oid is not None:
        log_info({"handler": "all_add", "action": "normalize_index", "warning": "event.index.byOid is not a dict"})

    raw_object_page = index.get("objectPage")
    object_page: Dict[str, str] = {}
    if isinstance(raw_object_page, dict):
        for object_id_raw, page_raw in raw_object_page.items():
            object_id = str(object_id_raw or "").strip()
            if not object_id:
                continue
            object_page[object_id] = str(page_raw or "").strip()
    elif raw_object_page is not None:
        log_info({"handler": "all_add", "action": "normalize_index", "warning": "event.index.objectPage is not a dict"})

    return by_oid, object_page


def create_oid(payload: Dict, log_info: Callable[[Dict], None]) -> Tuple[List[Dict], List[Dict]]:
    """Create OID updates and optional conflict notification command."""
    event = payload.get("event") if isinstance(payload.get("event"), dict) else {}
    items = event.get("items") or []
    by_oid, object_page = _normalize_index_maps(event, log_info)
    page = event.get("page") or {}
    event_page_id = str(page.get("id") or "").strip()
    company_prefix = resolve_company_prefix(payload)

    commands: List[Dict] = []
    conflicts = collect_import_conflicts(
        items,
        by_oid,
        object_page=object_page if isinstance(object_page, dict) else None,
        event_page_id=event_page_id,
    )
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

    updates, assigned = build_oid_updates_for_empty_oid_items(items, company_prefix, by_oid)
    for row in assigned:
        log_info({"handler": "all_add", "action": "assign_oid", "objectId": row["objectId"], "OID": row["OID"]})

    return commands, updates


def create_layer_commands(payload: Dict, log_info: Callable[[Dict], None]) -> List[Dict]:
    """Build layer-routing commands for added items using schema config."""
    event = payload.get("event") or {}
    page = event.get("page") or {}
    page_id = page.get("id")
    items = event.get("items") or []
    return build_layer_commands_for_items(page_id, items, log_info, "all_add")


def build_commands(payload: Dict, log_info: Callable[[Dict], None] = lambda _payload: None) -> List[Dict]:
    """Build command list and keep explicit execution order."""
    event = payload.get("event") or {}
    if str(event.get("eventType") or "").strip().lower() == "reparent":
        log_info(
            {
                "handler": "all_add",
                "action": "reject_reparent_misroute",
                "count": len(event.get("items") or []),
            }
        )
        return []
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
        if str(event.get("eventType") or "").strip().lower() == "reparent":
            logger.error("all_add invoked for reparent event (routing misconfiguration)")
            return write_response(
                status="error",
                message="all_add does not handle reparent; use seafStencilReparent",
                payload=build_error_policy_payload({"handler": "all_add"}, user_visible=False),
            )
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
        return write_response(
            status="error",
            message=f"all_add failed: {exc}",
            payload=build_error_policy_payload({"handler": "all_add"}, user_visible=False),
        )


if __name__ == "__main__":
    raise SystemExit(main())
