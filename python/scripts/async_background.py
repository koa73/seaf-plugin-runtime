#!/usr/bin/env python3
import json
import sys
import time


def main() -> int:
    raw = sys.stdin.read()
    req = json.loads(raw) if raw.strip() else {}
    payload = req.get("payload") or {}
    args = payload.get("arguments") or {}
    duration = max(1, int(args.get("simulateDurationSec", 2)))
    for step in range(duration):
        progress = int(((step + 1) * 100) / duration)
        phase = f"step {step + 1} of {duration}"
        # Progress events are emitted to stderr, so stdout stays valid JSON.
        sys.stderr.write(
            "SEAF_PROGRESS " + json.dumps({"progress": progress, "phase": phase}) + "\n"
        )
        sys.stderr.flush()
        time.sleep(1)

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
