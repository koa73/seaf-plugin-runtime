#!/usr/bin/env python3
"""reparent handler: write one audit log line with the event payload; no commands."""

from lib.io import build_error_policy_payload, read_request, write_response
from lib.logging import build_script_logger


def main() -> int:
    """Log that this script ran and attach `payload.event` as-is; return success with empty commands."""
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
        return write_response(
            status="success",
            message="reparent logged",
            payload={"handler": "reparent", "count": len(items)},
            commands=[],
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
