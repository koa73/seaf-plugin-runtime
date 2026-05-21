#!/usr/bin/env python3
"""Tools -> Net_Conf_Parser: launch vendored NetConf_Parser (interactive TTY)."""

from __future__ import annotations

import json
import os
import runpy
import sys
from pathlib import Path


def _runtime_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _inject_payload_env() -> None:
    payload_json = os.environ.get("SEAF_PAYLOAD_JSON", "")
    if not payload_json:
        return
    try:
        payload = json.loads(payload_json)
    except json.JSONDecodeError:
        return
    env = payload.get("env") if isinstance(payload.get("env"), dict) else {}
    script_env = payload.get("scriptEnv") if isinstance(payload.get("scriptEnv"), dict) else {}
    merged = {**env, **script_env}
    for key, value in merged.items():
        cleaned = "".join(ch if ch.isalnum() else "_" for ch in str(key))
        suffix = cleaned.strip("_").upper()
        if suffix:
            os.environ[f"SEAF_ENV_{suffix}"] = str(value)
        os.environ[str(key)] = str(value)


def main() -> int:
    root = _runtime_root()
    vendor = root / "vendor" / "netconf_parser"
    entry = vendor / "main_entry.py"
    if not entry.is_file():
        print(f"NetConf vendor entry not found: {entry}", file=sys.stderr)
        print("Run: seaf-plugin-runtime/scripts/vendor/sync-netconf-parser.sh", file=sys.stderr)
        return 1

    _inject_payload_env()
    sys.path.insert(0, str(vendor))
    runpy.run_path(str(entry), run_name="__main__")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
