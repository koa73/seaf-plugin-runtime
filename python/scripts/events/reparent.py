#!/usr/bin/env python3
"""Stencil `reparent` handler: audit log only (no UI commands, no OID)."""

from typing import Any, Dict, List

from lib.io import build_error_policy_payload, read_request, write_response
from lib.logging import build_script_logger


def _compact_item_for_audit(item: Dict[str, Any]) -> Dict[str, Any]:
    """Pick stable fields for log: identity, layer after move, reparent metadata."""
    data = item.get("data") if isinstance(item.get("data"), dict) else {}
    oid = str(data.get("OID") or "").strip() if isinstance(data, dict) else ""
    schema = str(item.get("schema") or "").strip()
    if not schema and isinstance(data, dict):
        schema = str(data.get("schema") or "").strip()
    row: Dict[str, Any] = {
        "objectId": str(item.get("objectId") or item.get("id") or "").strip() or None,
        "schema": schema or None,
        "OID": oid or None,
        "currentLayerName": str(item.get("currentLayerName") or "").strip() or None,
    }
    for key in ("previousParentId", "newParentId", "previousLayerName", "targetParentLayerName"):
        val = item.get(key)
        if val is not None and str(val).strip() != "":
            row[key] = str(val).strip()
    return row


def build_reparent_audit_log_payload(event: Dict[str, Any]) -> Dict[str, Any]:
    """Build structured payload for SEAF_INFO (used by handler and unit tests)."""
    page = event.get("page") if isinstance(event.get("page"), dict) else {}
    raw_items = event.get("items") if isinstance(event.get("items"), list) else []
    items: List[Dict[str, Any]] = []
    for it in raw_items:
        if isinstance(it, dict):
            items.append(_compact_item_for_audit(it))
    return {
        "handler": "reparent",
        "action": "reparent_move_audit",
        "page": {
            "id": page.get("id"),
            "name": page.get("name"),
        },
        "items": items,
    }


def main() -> int:
    """Validate `eventType=reparent`, log moved objects and layer snapshot, return success with no commands."""
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
        audit = build_reparent_audit_log_payload(event)
        logger.info(audit)
        items = event.get("items") or []
        return write_response(
            status="success",
            message=f"reparent processed: {len(items)}",
            payload={
                "handler": "reparent",
                "count": len(items),
            },
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
