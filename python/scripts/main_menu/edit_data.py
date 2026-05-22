#!/usr/bin/env python3
"""Tools → Edit Data: persist selected stencil schema group for future extensions."""

from __future__ import annotations

import json
from typing import Any, Dict

from lib.io import get_arguments, get_payload, read_request, write_response
from lib.logging import build_script_logger

HANDLER = "main_menu.edit_data"

# Module-level selection for follow-up script logic in the same Python process.
SELECTED_STENCIL_ENTRY: Dict[str, Any] = {}


def _read_string(args: Dict[str, Any], env: Dict[str, Any], key: str) -> str:
    raw = args.get(key, env.get(key, ""))
    return str(raw or "").strip()


def _parse_stencil_config(raw: str) -> Dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def main() -> int:
    request = read_request()
    payload = get_payload(request)
    args = get_arguments(request)
    env = payload.get("env") if isinstance(payload.get("env"), dict) else {}
    logger = build_script_logger(payload)

    schema = _read_string(args, env, "stencilSchema")
    layer = _read_string(args, env, "stencilSchemaLayer")
    config = _parse_stencil_config(_read_string(args, env, "stencilSchemaConfig"))

    if not schema:
        logger.error("stencilSchema is required")
        return write_response(
            status="error",
            message="Не выбрана группа стенсилов",
            payload={"handler": HANDLER, "reason": "stencil_schema_missing"},
        )

    global SELECTED_STENCIL_ENTRY
    SELECTED_STENCIL_ENTRY = {"schema": schema, **config}
    if layer and "layer" not in SELECTED_STENCIL_ENTRY:
        SELECTED_STENCIL_ENTRY["layer"] = layer

    logger.debug(
        {
            "handler": HANDLER,
            "schema": schema,
            "layer": SELECTED_STENCIL_ENTRY.get("layer", layer),
            "entry": SELECTED_STENCIL_ENTRY,
        }
    )

    display_layer = str(SELECTED_STENCIL_ENTRY.get("layer") or layer or schema)
    return write_response(
        status="success",
        message=f"Выбрана группа: {display_layer}",
        payload={
            "handler": HANDLER,
            "schema": schema,
            "layer": display_layer,
            "entry": SELECTED_STENCIL_ENTRY,
        },
    )


if __name__ == "__main__":
    raise SystemExit(main())
