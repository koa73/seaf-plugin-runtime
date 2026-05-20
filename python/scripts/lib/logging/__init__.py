"""Structured logging helpers for runtime Python scripts."""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from typing import Any, Dict


def _resolve_plugin_log_level(payload: Dict[str, Any]) -> str:
    """Resolve normalized plugin log level from payload env/arguments."""
    env = payload.get("env") or {}
    args = payload.get("arguments") or {}
    return str(env.get("pluginLogLevel", args.get("pluginLogLevel", "none")) or "none").strip().lower()


@dataclass(frozen=True)
class ScriptLogger:
    """Logger with runtime-configured SEAF_INFO visibility."""

    info_enabled: bool
    debug_enabled: bool

    def info(self, payload: Dict[str, Any]) -> None:
        """Write structured informational event when info level is enabled."""
        if not self.info_enabled:
            return
        print(f"SEAF_INFO {json.dumps(payload, ensure_ascii=False)}", file=sys.stderr)

    def debug(self, payload: Dict[str, Any]) -> None:
        """Write SEAF_INFO only when pluginLogLevel is debug or trace (verbose diagnostics)."""
        if not self.debug_enabled:
            return
        print(f"SEAF_INFO {json.dumps(payload, ensure_ascii=False)}", file=sys.stderr)

    def error(self, message: str) -> None:
        """Write error message in SEAF_ERROR format."""
        print(f"SEAF_ERROR {message}", file=sys.stderr)


def build_script_logger(payload: Dict[str, Any]) -> ScriptLogger:
    """Create script logger based on payload-provided plugin log level."""
    level = _resolve_plugin_log_level(payload)
    return ScriptLogger(
        info_enabled=level in {"info", "debug", "trace"},
        debug_enabled=level in {"debug", "trace"},
    )
