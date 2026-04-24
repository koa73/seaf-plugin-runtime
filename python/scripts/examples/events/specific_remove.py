#!/usr/bin/env python3
import json
import sys

from lib.io import read_request, write_response


def _emit_info(payload: dict) -> None:
    print(f"SEAF_INFO {json.dumps(payload, ensure_ascii=False)}", file=sys.stderr)


def _emit_error(message: str) -> None:
    print(f"SEAF_ERROR {message}", file=sys.stderr)


def _log_items(handler: str, event: dict, items: list) -> None:
    page = event.get("page") or {}
    for item in items:
        geometry = item.get("geometry") or {}
        data = item.get("data") or {}
        object_id = item.get("objectId") or item.get("id")
        debug_row = {
            "handler": handler,
            "objectId": object_id,
            "pageId": page.get("id"),
            "pageName": page.get("name"),
            "geometry": {
                "x": geometry.get("x"),
                "y": geometry.get("y"),
                "width": geometry.get("width"),
                "height": geometry.get("height"),
            },
            "data": data,
        }
        _emit_info(debug_row)


def main() -> int:
    try:
        req = read_request()
        payload = req.get("payload") or {}
        event = payload.get("event") or {}
        items = event.get("items") or []
        _log_items("specific_remove", event, items)
        return write_response(
            status="success",
            message=f"specific_remove processed: {len(items)}",
            payload={"handler": "specific_remove", "count": len(items)},
        )
    except Exception as exc:
        _emit_error(f"specific_remove failed: {exc}")
        return write_response(status="error", message=f"specific_remove failed: {exc}", payload={"handler": "specific_remove"})


if __name__ == "__main__":
    raise SystemExit(main())
