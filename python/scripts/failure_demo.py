#!/usr/bin/env python3
import json
import sys


def main() -> int:
    _raw = sys.stdin.read()
    response = {
        "status": "error",
        "message": "Simulated script error for debugging",
        "payload": {},
        "commands": [
            {
                "name": "showMessage",
                "args": {"level": "error", "text": "Failure demo command returned error"},
            }
        ],
        "errors": ["simulated_error"],
    }
    sys.stdout.write(json.dumps(response))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
