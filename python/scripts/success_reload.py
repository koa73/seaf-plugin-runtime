#!/usr/bin/env python3
import json
import sys


def main() -> int:
    raw = sys.stdin.read()
    payload = json.loads(raw) if raw.strip() else {}

    response = {
        "status": "success",
        "message": "Document reload flow completed",
        "payload": {
            "receivedCommandId": payload.get("commandId"),
            "selectionCount": len((payload.get("payload") or {}).get("selection") or []),
        },
        "commands": [
            {
                "name": "showMessage",
                "args": {
                    "level": "info",
                    "text": "Python script finished successfully",
                },
            },
            {"name": "reloadDocument", "args": {}},
        ],
        "errors": [],
    }

    sys.stdout.write(json.dumps(response))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
