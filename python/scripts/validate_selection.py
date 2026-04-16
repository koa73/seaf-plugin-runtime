#!/usr/bin/env python3
import json
import sys


def main() -> int:
    raw = sys.stdin.read()
    req = json.loads(raw) if raw.strip() else {}
    payload = req.get("payload") or {}
    selection = payload.get("selection") or []

    if not selection:
        response = {
            "status": "error",
            "message": "No selected objects found",
            "payload": {},
            "commands": [
                {
                    "name": "showMessage",
                    "args": {"level": "error", "text": "Select at least one object"},
                }
            ],
            "errors": ["selection_is_empty"],
        }
        sys.stdout.write(json.dumps(response))
        return 0

    selected_ids = [item.get("id") for item in selection if item.get("id")]
    response = {
        "status": "success",
        "message": f"Validated {len(selected_ids)} selected object(s)",
        "payload": {
            "selectedIds": selected_ids,
        },
        "commands": [
            {
                "name": "selectCells",
                "args": {"cellIds": selected_ids},
            },
            {
                "name": "showMessage",
                "args": {"level": "info", "text": "Selection validated"},
            },
        ],
        "errors": [],
    }
    sys.stdout.write(json.dumps(response))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
