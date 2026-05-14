#!/usr/bin/env python3
"""Wildcard modify: keep stencil `title` and `label` in sync (P41 ta.services)."""

from __future__ import annotations

from typing import Any, Callable, Dict, List

from lib.events import apply_title_label_sync, build_update_stencil_data_bulk_command, log_event_items
from lib.io import build_error_policy_payload, read_request, write_response
from lib.logging import build_script_logger


def _norm_field(data: Dict[str, Any], key: str) -> str:
    raw = data.get(key) if isinstance(data, dict) else None
    if raw is None:
        return ""
    return str(raw).strip()


def build_commands(
    payload: Dict[str, Any],
    log_info: Callable[[Dict[str, Any]], None],
    log_debug: Callable[[Dict[str, Any]], None] | None = None,
) -> List[Dict[str, Any]]:
    event = payload.get("event") or {}
    page = event.get("page") or {}
    page_id = page.get("id")
    items = event.get("items") or []
    updates: List[Dict[str, Any]] = []

    if not page_id:
        log_info({"handler": "label_title", "action": "skip_no_page_id"})
        return []

    for item in items:
        if not isinstance(item, dict):
            continue
        schema = str(item.get("schema") or "").strip()
        object_id = str(item.get("objectId") or item.get("id") or "").strip()
        data_after = item.get("dataAfter") if isinstance(item.get("dataAfter"), dict) else {}
        data_before = item.get("dataBefore") if isinstance(item.get("dataBefore"), dict) else {}
        if not object_id:
            log_info({"handler": "label_title", "action": "skip_no_object_id", "schema": schema})
            continue

        aligned = dict(data_after)
        apply_title_label_sync(schema, data_before, aligned, log_debug=log_debug)

        patch: Dict[str, Any] = {}
        for key in ("title", "label"):
            if _norm_field(aligned, key) != _norm_field(data_after, key):
                patch[key] = aligned.get(key)

        if patch:
            updates.append({"objectId": object_id, "mode": "merge", "data": patch})

    if not updates:
        return []
    return [build_update_stencil_data_bulk_command(page_id, updates, suppress_stencil_events=True)]


def main() -> int:
    try:
        req = read_request()
        payload = req.get("payload") or {}
        logger = build_script_logger(payload)
        event = payload.get("event") or {}
        items = event.get("items") or []
        log_event_items("label_title", event, items, logger.info)
        commands = build_commands(payload, logger.info, logger.debug)
        return write_response(
            status="success",
            message="",
            payload={
                "handler": "label_title",
                "commandCount": len(commands),
            },
            commands=commands,
        )
    except Exception as exc:
        logger = build_script_logger({})
        logger.error(f"label_title failed: {exc}")
        return write_response(
            status="error",
            message=f"label_title failed: {exc}",
            payload=build_error_policy_payload({"handler": "label_title"}, user_visible=False),
        )


if __name__ == "__main__":
    raise SystemExit(main())
