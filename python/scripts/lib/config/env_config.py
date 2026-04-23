"""Helpers to read environment-style config from SEAF payload."""

from __future__ import annotations

from typing import Any, Dict


def build_env_config(request: Dict[str, Any]) -> Dict[str, Any]:
    """Return env configuration passed from desktop runtime.

    The runtime injects these values from `conf/env.yaml` into
    `REQUEST.payload.env` and mirrors them to `REQUEST.payload.arguments`.
    """
    payload = request.get("payload") or {}
    payload_env = payload.get("env") or {}
    payload_args = payload.get("arguments") or {}

    return {
        "companyPrefix": payload_env.get("companyPrefix", payload_args.get("companyPrefix", "")),
        "inputSeafFile": payload_env.get("inputSeafFile", payload_args.get("inputSeafFile", "")),
        "useSameOutputFile": payload_env.get("useSameOutputFile", payload_args.get("useSameOutputFile", True)),
        "outputSeafFile": payload_env.get("outputSeafFile", payload_args.get("outputSeafFile", "")),
        "pluginLogLevel": payload_env.get("pluginLogLevel", payload_args.get("pluginLogLevel", "none")),
    }

