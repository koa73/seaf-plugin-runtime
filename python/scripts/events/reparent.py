#!/usr/bin/env python3
"""Handle stencil `reparent` events: two-level layer tree (semantic layer under page layer), no OID."""

from typing import Any, Callable, Dict, List, Set, Tuple

from lib.events import build_move_layer_under_layer_command, log_event_items, resolve_layer_for_schema
from lib.io import build_error_policy_payload, read_request, write_response
from lib.logging import build_script_logger


def build_commands(payload: Dict[str, Any], log_info: Callable[[Dict[str, Any]], None]) -> List[Dict[str, Any]]:
    """Emit `moveLayerUnderLayer` for unique (semantic layer, target parent layer) pairs; never assigns OID."""
    event = payload.get("event") or {}
    page = event.get("page") or {}
    page_id = page.get("id")
    items = event.get("items") or []
    seen: Set[Tuple[str, str]] = set()
    commands: List[Dict[str, Any]] = []

    for item in items:
        if not isinstance(item, dict):
            continue
        schema = str(item.get("schema") or "").strip()
        if not schema:
            data = item.get("data") or {}
            if isinstance(data, dict):
                schema = str(data.get("schema") or "").strip()
        object_id = str(item.get("objectId") or item.get("id") or "").strip()
        if not schema:
            log_info({"handler": "reparent", "action": "layer_skip_schema_missing", "objectId": object_id or None})
            continue

        semantic_layer, has_multiple = resolve_layer_for_schema(schema)
        if has_multiple:
            log_info(
                {
                    "handler": "reparent",
                    "action": "layer_config_multiple_values",
                    "schema": schema,
                    "selectedLayer": semantic_layer,
                }
            )
        if not semantic_layer:
            log_info(
                {
                    "handler": "reparent",
                    "action": "layer_skip_missing_mapping",
                    "schema": schema,
                    "objectId": object_id or None,
                }
            )
            continue

        target_parent = str(item.get("targetParentLayerName") or "").strip()
        if not target_parent:
            log_info(
                {
                    "handler": "reparent",
                    "action": "reparent_skip_missing_target_parent",
                    "schema": schema,
                    "objectId": object_id or None,
                    "semanticLayer": semantic_layer,
                }
            )
            continue

        sem = semantic_layer.strip()
        if sem == target_parent:
            log_info(
                {
                    "handler": "reparent",
                    "action": "reparent_skip_same_child_and_parent_name",
                    "schema": schema,
                    "layerName": sem,
                }
            )
            continue

        key = (sem, target_parent)
        if key in seen:
            continue
        seen.add(key)
        commands.append(
            build_move_layer_under_layer_command(
                page_id,
                sem,
                target_parent,
                suppress_stencil_events=True,
            )
        )

    return commands


def main() -> int:
    """Read request, validate event type, emit layer-under-layer commands only."""
    try:
        req = read_request()
        payload = req.get("payload") or {}
        logger = build_script_logger(payload)
        event = payload.get("event") or {}
        event_type = str(event.get("eventType") or "").strip().lower()
        if event_type and event_type != "reparent":
            logger.error(f"reparent handler received wrong eventType={event_type!r}")
            return write_response(
                status="error",
                message=f"reparent handler expects eventType=reparent, got {event_type!r}",
                payload=build_error_policy_payload({"handler": "reparent"}, user_visible=False),
            )
        items = event.get("items") or []
        log_event_items("reparent", event, items, logger.info)
        commands = build_commands(payload, logger.info)
        return write_response(
            status="success",
            message=f"reparent processed: {len(items)}",
            payload={
                "handler": "reparent",
                "count": len(items),
                "note": "uiCommandResults are attached by renderer after command execution",
            },
            commands=commands,
        )
    except Exception as exc:
        logger = build_script_logger({})
        logger.error(f"reparent failed: {exc}")
        return write_response(
            status="error",
            message=f"reparent failed: {exc}",
            payload=build_error_policy_payload({"handler": "reparent"}, user_visible=False),
        )


if __name__ == "__main__":
    raise SystemExit(main())
