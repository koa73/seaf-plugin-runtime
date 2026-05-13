#!/usr/bin/env python3
"""reparent handler: audit event and enforce schema-based layer routing."""

from typing import Callable, Dict, List

from lib.events import build_layer_commands_for_items
from lib.io import build_error_policy_payload, read_request, write_response
from lib.logging import build_script_logger


def create_layer_commands(payload: Dict, log_info: Callable[[Dict], None]) -> List[Dict]:
    """Build layer-routing commands for reparented items (forced re-apply)."""
    event = payload.get("event") or {}
    page = event.get("page") or {}
    page_id = page.get("id")
    items = event.get("items") or []
    return build_layer_commands_for_items(
        page_id,
        items,
        log_info,
        "reparent",
        force_reassign_layer=True,
    )


def main() -> int:
    """Log event payload and return forced layer-routing commands."""
    try:
        req = read_request()
        payload = req.get("payload") or {}
        logger = build_script_logger(payload)
        event = payload.get("event") if isinstance(payload.get("event"), dict) else {}
        logger.info(
            {
                "handler": "reparent",
                "reparentScriptFired": True,
                "event": event,
            }
        )
        items = event.get("items") if isinstance(event.get("items"), list) else []
        commands = create_layer_commands(payload, logger.info)
        return write_response(
            status="success",
            message="reparent processed",
            payload={"handler": "reparent", "count": len(items), "layerCommandsCount": len(commands)},
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
