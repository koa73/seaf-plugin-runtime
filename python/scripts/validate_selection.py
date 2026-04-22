#!/usr/bin/env python3
from lib.io import get_payload, read_request, write_response


def main() -> int:
    req = read_request()
    payload = get_payload(req)
    selection = payload.get("selection") or []

    if not selection:
        return write_response(
            status="error",
            message="No selected objects found",
            payload={},
            commands=[
                {
                    "name": "showMessage",
                    "args": {"level": "error", "text": "Select at least one object"},
                }
            ],
            errors=["selection_is_empty"],
            exit_code=0,
        )

    selected_ids = [item.get("id") for item in selection if item.get("id")]
    return write_response(
        status="success",
        message=f"Validated {len(selected_ids)} selected object(s)",
        payload={
            "selectedIds": selected_ids,
        },
        commands=[
            {
                "name": "selectCells",
                "args": {"cellIds": selected_ids},
            },
            {
                "name": "showMessage",
                "args": {"level": "info", "text": "Selection validated"},
            },
        ],
        errors=[],
    )


if __name__ == "__main__":
    raise SystemExit(main())
