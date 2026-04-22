#!/usr/bin/env python3
from lib.io import get_payload, read_request, write_response


def main() -> int:
    request = read_request()
    payload = get_payload(request)

    return write_response(
        status="success",
        message="Document reload flow completed",
        payload={
            "receivedCommandId": request.get("commandId"),
            "selectionCount": len(payload.get("selection") or []),
        },
        commands=[
            {
                "name": "showMessage",
                "args": {
                    "level": "info",
                    "text": "Python script finished successfully",
                },
            },
            {"name": "reloadDocument", "args": {}},
        ],
        errors=[],
    )


if __name__ == "__main__":
    raise SystemExit(main())
