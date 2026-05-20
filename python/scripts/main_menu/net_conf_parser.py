#!/usr/bin/env python3
"""Main menu stub: Tools Net_Conf_Parser — logs invocation."""

from lib.io import get_payload, read_request, write_response
from lib.logging import build_script_logger

HANDLER = "main_menu.net_conf_parser"


def main() -> int:
    request = read_request()
    payload = get_payload(request)
    logger = build_script_logger(payload)
    logger.info(
        {
            "handler": HANDLER,
            "invoked": True,
            "commandId": request.get("commandId"),
            "source": payload.get("source"),
        }
    )
    return write_response(
        status="success",
        message="Net_Conf_Parser invoked (logged)",
        payload={"handler": HANDLER},
        commands=[],
        errors=[],
    )


if __name__ == "__main__":
    raise SystemExit(main())
