"""I/O helpers for SEAF runtime scripts."""

from __future__ import annotations

import json
import sys
from typing import Any, Dict, List, Optional


def read_request() -> Dict[str, Any]:
    """Read JSON request from stdin, return empty dict for blank input."""
    raw = sys.stdin.read()
    if not raw or not raw.strip():
        return {}
    return json.loads(raw)


def get_payload(request: Dict[str, Any]) -> Dict[str, Any]:
    """Return nested payload object from root request."""
    payload = request.get("payload")
    return payload if isinstance(payload, dict) else {}


def get_arguments(request: Dict[str, Any]) -> Dict[str, Any]:
    """Return request.payload.arguments object."""
    payload = get_payload(request)
    args = payload.get("arguments")
    return args if isinstance(args, dict) else {}


def emit_progress(progress: int, phase: Optional[str] = None, message: Optional[str] = None) -> None:
    """Emit progress event to stderr in SEAF_PROGRESS format."""
    event: Dict[str, Any] = {"progress": int(max(0, min(100, progress)))}
    if phase:
        event["phase"] = phase
    if message:
        event["message"] = message
    sys.stderr.write("SEAF_PROGRESS " + json.dumps(event, ensure_ascii=False) + "\n")
    sys.stderr.flush()


def build_error_policy_payload(
    payload: Optional[Dict[str, Any]] = None,
    user_visible: bool = False,
) -> Dict[str, Any]:
    """Attach unified error visibility policy to payload."""
    base = payload if isinstance(payload, dict) else {}
    next_payload = dict(base)
    next_payload["errorPolicy"] = {"userVisible": user_visible is True}
    return next_payload


def write_response(
    status: str,
    message: str,
    payload: Optional[Dict[str, Any]] = None,
    commands: Optional[List[Dict[str, Any]]] = None,
    errors: Optional[List[str]] = None,
    exit_code: Optional[int] = None,
) -> int:
    """Write canonical response JSON to stdout and return exit code."""
    response = {
        "status": status,
        "message": message,
        "payload": payload if isinstance(payload, dict) else {},
        "commands": commands if isinstance(commands, list) else [],
        "errors": errors if isinstance(errors, list) else [],
    }
    sys.stdout.write(json.dumps(response, ensure_ascii=False))
    if exit_code is not None:
        return int(exit_code)
    return 0 if status == "success" else 1

