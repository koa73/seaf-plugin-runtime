#!/usr/bin/env python3
"""Tools -> Edit Data: apply bulk-edited rows to diagram cells."""

from __future__ import annotations

import json
from typing import Any, Dict, List

from lib.io import get_arguments, get_payload, read_request, write_response
from lib.logging import build_script_logger
from lib.diagram.page_service import list_pages
from lib.main_menu.edit_data_helpers import build_edit_data_apply_commands

HANDLER = "main_menu.edit_data_apply"


def _read_string(args: Dict[str, Any], env: Dict[str, Any], key: str) -> str:
    raw = args.get(key, env.get(key, ""))
    return str(raw or "").strip()


def _parse_edited_rows(raw: Any) -> List[Dict[str, Any]]:
    if isinstance(raw, list):
        return [row for row in raw if isinstance(row, dict)]
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return []
        if isinstance(parsed, list):
            return [row for row in parsed if isinstance(row, dict)]
    return []


def main() -> int:
    request = read_request()
    payload = get_payload(request)
    args = get_arguments(request)
    env = payload.get("env") if isinstance(payload.get("env"), dict) else {}
    logger = build_script_logger(payload)

    schema = _read_string(args, env, "stencilSchema")
    edited_rows = _parse_edited_rows(args.get("editedRows", env.get("editedRows")))
    schema_objects = payload.get("schemaObjects")
    if not isinstance(schema_objects, list):
        schema_objects = []

    if not schema:
        logger.error("stencilSchema is required")
        return write_response(
            status="error",
            message="Не указана schema для применения изменений",
            payload={"handler": HANDLER, "reason": "stencil_schema_missing"},
        )

    if not edited_rows:
        return write_response(
            status="error",
            message="Нет данных для сохранения",
            payload={"handler": HANDLER, "reason": "edited_rows_empty"},
        )

    pages = list_pages(payload)
    commands, stats = build_edit_data_apply_commands(schema, edited_rows, schema_objects, pages)

    if not commands:
        return write_response(
            status="error",
            message="Изменения не применены: нет допустимых обновлений",
            payload={"handler": HANDLER, "reason": "no_updates", "stats": stats},
        )

    logger.debug({"handler": HANDLER, "schema": schema, "stats": stats, "commandsCount": len(commands)})

    prepared = int(stats.get("rowsPrepared") or 0)
    return write_response(
        status="success",
        message=f"Применено изменений: {prepared} объект(ов)",
        payload={"handler": HANDLER, "schema": schema, "stats": stats},
        commands=commands,
    )


if __name__ == "__main__":
    raise SystemExit(main())
