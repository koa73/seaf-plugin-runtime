#!/usr/bin/env python3
"""Sync network_connection list on connect/disconnect events."""

from __future__ import annotations

import json
from typing import Any, Dict, List

from lib.events import (
    build_move_objects_to_layer_command,
    build_update_stencil_data_bulk_command,
    log_event_items,
)
from lib.io import build_error_policy_payload, read_request, write_response
from lib.logging import build_script_logger
from lib.main_menu.seaf_data_map import denormalize_for_stencil


NETWORK_CONNECTION_LAYER_NAME = "Сетевые соединения"


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


def _collect_connect_edge_ids(items: List[Dict[str, Any]]) -> List[str]:
    edge_ids: List[str] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        operation = str(item.get("operation") or "").strip().lower()
        if operation != "connect":
            continue
        edge_id = str(item.get("edgeId") or "").strip()
        if not edge_id or edge_id in seen:
            continue
        seen.add(edge_id)
        edge_ids.append(edge_id)
    return edge_ids


def build_commands(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    event = payload.get("event") if isinstance(payload.get("event"), dict) else {}
    page = event.get("page") if isinstance(event.get("page"), dict) else {}
    page_id = page.get("id")
    items = event.get("items") if isinstance(event.get("items"), list) else []
    updates = _build_updates(items)
    edge_ids = _collect_connect_edge_ids(items)
    commands: List[Dict[str, Any]] = []
    if updates:
        commands.append(build_update_stencil_data_bulk_command(page_id, updates, suppress_stencil_events=True))
    if edge_ids:
        commands.append(
            build_move_objects_to_layer_command(
                page_id,
                NETWORK_CONNECTION_LAYER_NAME,
                edge_ids,
                suppress_stencil_events=True,
            )
        )
    return commands


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
