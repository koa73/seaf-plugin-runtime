#!/usr/bin/env python3
import json
import sys
import time


def main() -> int:
    raw = sys.stdin.read()
    req = json.loads(raw) if raw.strip() else {}
    payload = req.get("payload") or {}
    args = payload.get("arguments") or {}
    sleep_sec = int(args.get("sleepSec", 120))
    time.sleep(max(0, sleep_sec))
    sys.stdout.write(json.dumps({"status": "success", "message": "Completed after sleep"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
