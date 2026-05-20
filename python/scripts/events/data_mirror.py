#!/usr/bin/env python3
"""Mirror modified stencil data to objects with same schema+OID."""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Tuple

from lib.diagram.linked_page_sync import build_linked_page_sync_commands
from lib.diagram.page_service import list_pages
from lib.events import (
    apply_title_label_sync,
    build_data_mirror_atomic_command,
    format_data_mirror_error_details,
    log_event_items,
    sanitize_patch_data,
)
from lib.io import build_error_policy_payload, read_request, write_response
from lib.logging import build_script_logger

EXCLUDED_FIELDS = ("OID", "schema")
TARGET_SCHEMAS = {
    "seaf.company.ta.services.dcs",
    "seaf.company.ta.services.dc_offices",
}


def _extract_source_item(item: Dict[str, Any]) -> Tuple[str, str, Dict[str, Any], Dict[str, Any]]:
    schema = str(item.get("schema") or "").strip()
    data_after = item.get("dataAfter") if isinstance(item.get("dataAfter"), dict) else {}
    data_before = item.get("dataBefore") if isinstance(item.get("dataBefore"), dict) else {}
    oid = str((data_after.get("OID") if isinstance(data_after, dict) else "") or "").strip()
    if not oid:
        oid = str((data_before.get("OID") if isinstance(data_before, dict) else "") or "").strip()
    return schema, oid, data_after, data_before


def build_commands(
    payload: Dict[str, Any],
    log_info: Callable[[Dict[str, Any]], None],
    log_debug: Callable[[Dict[str, Any]], None] | None = None,
) -> List[Dict[str, Any]]:
    event = payload.get("event") or {}
    items = event.get("items") or []
    pages = list_pages(payload)
    commands: List[Dict[str, Any]] = []
    seen: set[Tuple[str, str]] = set()
    sync_seen: set[Tuple[str, str, str]] = set()

    for item in items:
        if not isinstance(item, dict):
            continue
        schema, oid, data_after, data_before = _extract_source_item(item)
        object_id = str(item.get("objectId") or item.get("id") or "").strip()
        if schema not in TARGET_SCHEMAS:
            log_info({"handler": "data_mirror", "action": "skip_schema", "schema": schema, "objectId": object_id})
            continue
        if not oid:
            log_info({"handler": "data_mirror", "action": "skip_oid_missing", "schema": schema, "objectId": object_id})
            continue
        data_after_for_patch = dict(data_after) if isinstance(data_after, dict) else {}
        apply_title_label_sync(
            schema,
            data_before,
            data_after_for_patch,
            log_debug=log_debug,
        )
        patch = sanitize_patch_data(data_after_for_patch, EXCLUDED_FIELDS)
        if not patch:
            log_info({"handler": "data_mirror", "action": "skip_empty_patch", "schema": schema, "OID": oid, "objectId": object_id})
            continue
        dedupe_key = (schema, oid)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        source_rollbacks: List[Dict[str, Any]] = []
        if object_id and isinstance(data_before, dict) and data_before:
            source_rollbacks.append(
                {
                    "objectId": object_id,
                    "schema": schema,
                    "oid": oid,
                    "dataBefore": data_before,
                }
            )
        commands.append(
            build_data_mirror_atomic_command(
                schema=schema,
                oid=oid,
                patch=patch,
                source_rollbacks=source_rollbacks,
                excluded_fields=EXCLUDED_FIELDS,
            )
        )
        linked_page_id = str(item.get("linkedPageId") or "").strip()
        if object_id and linked_page_id:
            commands.extend(
                build_linked_page_sync_commands(
                    schema=schema,
                    data_before=data_before,
                    data_after=data_after_for_patch,
                    object_id=object_id,
                    linked_page_id=linked_page_id,
                    pages=pages,
                    seen_keys=sync_seen,
                )
            )
    return commands


def _build_error_message(failures: List[Dict[str, Any]]) -> str:
    details = format_data_mirror_error_details(failures)
    if details:
        return "Синхронизация данных не выполнена:\n" + details
    return "Синхронизация данных не выполнена."


def main() -> int:
    try:
        req = read_request()
        payload = req.get("payload") or {}
        logger = build_script_logger(payload)
        event = payload.get("event") or {}
        items = event.get("items") or []
        log_event_items("data_mirror", event, items, logger.info)
        commands = build_commands(payload, logger.info, logger.debug)
        if not commands:
            return write_response(
                status="success",
                message="",
                payload={"handler": "data_mirror", "count": 0},
                commands=[],
            )
        return write_response(
            status="success",
            message="",
            payload={
                "handler": "data_mirror",
                "count": len(commands),
                "validation": {
                    "requiredUiResults": [command.get("name") for command in commands],
                    "onFailureMessage": "data_mirror_sync_failed",
                },
            },
            commands=commands,
        )
    except Exception as exc:
        logger = build_script_logger({})
        logger.error(f"data_mirror failed: {exc}")
        message = _build_error_message([{"pageName": "unknown_page", "oid": "unknown_oid", "reason": str(exc)}])
        return write_response(
            status="error",
            message=message,
            payload=build_error_policy_payload({"handler": "data_mirror"}, user_visible=True),
        )


if __name__ == "__main__":
    raise SystemExit(main())
