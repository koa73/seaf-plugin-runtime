#!/usr/bin/env python3
import json
import sys

from lib.io import read_request, write_response


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
            "dataBefore": item.get("dataBefore") or {},
            "dataAfter": item.get("dataAfter") or {},
        }
        print(json.dumps(debug_row, ensure_ascii=False), file=sys.stderr)


def main() -> int:
    req = read_request()
    payload = req.get("payload") or {}
    event = payload.get("event") or {}
    items = event.get("items") or []
    _log_items("specific_modify", event, items)
    return write_response(
        status="success",
        message=f"specific_modify processed: {len(items)}",
        payload={"handler": "specific_modify", "count": len(items)},
    )


if __name__ == "__main__":
    raise SystemExit(main())
