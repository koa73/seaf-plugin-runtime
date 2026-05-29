#!/usr/bin/env python3
"""Sync network_connection list on connect/disconnect events."""

from __future__ import annotations

import json
from typing import Any, Dict, List

from lib.events import build_update_stencil_data_bulk_command, log_event_items
from lib.io import build_error_policy_payload, read_request, write_response
from lib.logging import build_script_logger
from lib.main_menu.seaf_data_map import denormalize_for_stencil


def _parse_list_value(raw: Any) -> List[str]:
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()]
    if raw is None:
        return []
    text = str(raw).strip()
    if not text:
        return []
    if text == "[]":
        return []
    if text.startswith("[") and text.endswith("]"):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return [str(x).strip() for x in parsed if str(x).strip()]
        except Exception:
            try:
                parsed = json.loads(text.replace("'", '"'))
                if isinstance(parsed, list):
                    return [str(x).strip() for x in parsed if str(x).strip()]
            except Exception:
                return []
    return []


def _build_updates(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    updates: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        operation = str(item.get("operation") or "").strip().lower()
        if operation not in ("connect", "disconnect"):
            continue
        receiver_id = str(item.get("receiverObjectId") or item.get("objectId") or "").strip()
        if not receiver_id:
            continue
        network_oid = str(item.get("networkOid") or "").strip()
        if not network_oid:
            continue
        receiver_data = item.get("receiverData") if isinstance(item.get("receiverData"), dict) else {}
        if "network_connection" not in receiver_data:
            continue
        current = _parse_list_value(receiver_data.get("network_connection"))
        if operation == "connect":
            next_values = sorted(set(current + [network_oid]))
        else:
            next_values = [value for value in current if value != network_oid]
        if next_values == current:
            continue
        key = receiver_id + "|" + operation + "|" + network_oid + "|" + ",".join(next_values)
        if key in seen:
            continue
        seen.add(key)
        updates.append(
            {
                "objectId": receiver_id,
                "mode": "merge",
                "data": {
                    "network_connection": denormalize_for_stencil(next_values),
                },
            }
        )
    return updates


def build_commands(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    event = payload.get("event") if isinstance(payload.get("event"), dict) else {}
    page = event.get("page") if isinstance(event.get("page"), dict) else {}
    page_id = page.get("id")
    items = event.get("items") if isinstance(event.get("items"), list) else []
    updates = _build_updates(items)
    if not updates:
        return []
    return [build_update_stencil_data_bulk_command(page_id, updates, suppress_stencil_events=True)]


def main() -> int:
    try:
        req = read_request()
        payload = req.get("payload") if isinstance(req.get("payload"), dict) else {}
        logger = build_script_logger(payload)
        event = payload.get("event") if isinstance(payload.get("event"), dict) else {}
        items = event.get("items") if isinstance(event.get("items"), list) else []
        log_event_items("network_connection_sync", event, items, logger.info)
        commands = build_commands(payload)
        return write_response(
            status="success",
            message="",
            payload={
                "handler": "network_connection_sync",
                "commandCount": len(commands),
            },
            commands=commands,
        )
    except Exception as exc:
        logger = build_script_logger({})
        logger.error(f"network_connection_sync failed: {exc}")
        return write_response(
            status="error",
            message=f"network_connection_sync failed: {exc}",
            payload=build_error_policy_payload({"handler": "network_connection_sync"}, user_visible=False),
        )


if __name__ == "__main__":
    raise SystemExit(main())
