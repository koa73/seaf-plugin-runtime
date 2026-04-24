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
        _log_items("all_add", event, items)
        commands = []
        if items:
            first_item = items[0] or {}
            object_id = first_item.get("objectId") or first_item.get("id")
            page = event.get("page") or {}
            current_data = first_item.get("data") or {}
            current_oid = str(current_data.get("OID", ""))
            next_oid = current_oid + "1"
            _emit_info({"handler": "all_add", "action": "update_oid", "objectId": object_id, "OID": next_oid})
            if object_id:
                commands.append(
                    {
                        "name": "updateStencilData",
                        "args": {
                            "pageId": page.get("id"),
                            "objectId": object_id,
                            "mode": "merge",
                            "data": {"OID": next_oid},
                        },
                    }
                )
            commands.append(
                {
                    "name": "ensureLayer",
                    "args": {
                        "pageId": page.get("id"),
                        "layerName": "SEAF_AUTO_LAYER",
                        "makeVisible": True,
                    },
                }
            )
        return write_response(
            status="success",
            message=f"all_add processed: {len(items)}",
            payload={"handler": "all_add", "count": len(items), "note": "uiCommandResults are attached by renderer after command execution"},
            commands=commands,
        )
    except Exception as exc:
        _emit_error(f"all_add failed: {exc}")
        return write_response(status="error", message=f"all_add failed: {exc}", payload={"handler": "all_add"})


if __name__ == "__main__":
    raise SystemExit(main())
