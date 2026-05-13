#!/usr/bin/env python3
"""Handle stencil `reparent` events: no OID, no layer UI commands (semantic layer fixed after `add`)."""

from typing import Any, Callable, Dict, List

from lib.events import log_event_items
from lib.io import build_error_policy_payload, read_request, write_response
from lib.logging import build_script_logger


def build_commands(payload: Dict[str, Any], log_info: Callable[[Dict[str, Any]], None]) -> List[Dict[str, Any]]:
    """Do not emit `moveLayerUnderLayer` / `moveObjectsToLayer` on reparent.

    Semantic layer name from `schemas.<schema>.layer` is assigned on `add` only; moving a stencil
    in the graph (new mx parent under another container) must not rewire layer cells or OID.
    """
    event = payload.get("event") or {}
    items = event.get("items") or []
    if items:
        log_info(
            {
                "handler": "reparent",
                "action": "reparent_no_layer_commands_semantic_layer_fixed_after_add",
                "itemCount": len(items),
            }
        )
    return []


def main() -> int:
    """Read request, validate event type; reparent returns success with no layer commands."""
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
                "layerPolicy": "semantic_fixed_no_commands_on_reparent",
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
