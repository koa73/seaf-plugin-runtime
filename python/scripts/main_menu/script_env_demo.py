#!/usr/bin/env python3
"""Demo command for optional scriptEnvEditor pre-run parameterization."""

from __future__ import annotations

import json

from lib.io import get_payload, read_request, write_response
from lib.logging import build_script_logger

HANDLER = "main_menu.script_env_demo"


def main() -> int:
    request = read_request()
    payload = get_payload(request)
    logger = build_script_logger(payload)
    env = payload.get("env") if isinstance(payload.get("env"), dict) else {}
    script_env = payload.get("scriptEnv") if isinstance(payload.get("scriptEnv"), dict) else {}
    logger.info(
        {
            "handler": HANDLER,
            "commandId": request.get("commandId"),
            "envKeys": sorted(env.keys()),
            "scriptEnvKeys": sorted(script_env.keys()),
        }
    )
    return write_response(
        status="success",
        message="script_env_demo ok",
        payload={
            "handler": HANDLER,
            "env": env,
            "scriptEnv": script_env,
            "envJson": json.dumps(env, ensure_ascii=False),
        },
        commands=[],
        errors=[],
    )


if __name__ == "__main__":
    raise SystemExit(main())
