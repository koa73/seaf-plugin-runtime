#!/usr/bin/env python3
from lib.io import read_request, write_response


def main() -> int:
    _request = read_request()
    return write_response(
        status="error",
        message="Simulated script error for debugging",
        payload={},
        commands=[
            {
                "name": "showMessage",
                "args": {"level": "error", "text": "Failure demo command returned error"},
            }
        ],
        errors=["simulated_error"],
        exit_code=1,
    )


if __name__ == "__main__":
    raise SystemExit(main())
