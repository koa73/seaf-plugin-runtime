#!/usr/bin/env python3
from lib.io import read_request, write_response


def main() -> int:
    req = read_request()
    payload = req.get("payload") or {}
    event = payload.get("event") or {}
    items = event.get("items") or []
    return write_response(
        status="success",
        message=f"specific_add processed: {len(items)}",
        payload={"handler": "specific_add", "count": len(items)},
    )


if __name__ == "__main__":
    raise SystemExit(main())
