#!/usr/bin/env python3
import json
import sys
import time


def main() -> int:
    raw = sys.stdin.read()
    req = json.loads(raw) if raw.strip() else {}
    payload = req.get("payload") or {}
    args = payload.get("arguments") or {}
    duration = int(args.get("simulateDurationSec", 2))
    time.sleep(max(0, duration))

    response = {
        "status": "success",
        "message": "Background task completed",
        "payload": {"durationSec": duration},
        "commands": [
            {
                "name": "showMessage",
                "args": {"level": "info", "text": "Async background task finished"},
            },
            {"name": "refreshGraph", "args": {}},
        ],
        "errors": [],
    }
    sys.stdout.write(json.dumps(response))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
