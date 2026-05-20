"""Helpers to resolve mirror stencil title from conf/stencils/config.yaml."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional


def _config_path() -> Path:
    return Path(__file__).resolve().parents[4] / "conf" / "stencils" / "config.yaml"


def _parse_simple_yaml(lines: List[str]) -> Dict[str, Any]:
    result: Dict[str, Any] = {"schemas": {}}
    current_schema: Optional[str] = None

    for raw in lines:
        line = raw.rstrip("\n")
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line.strip() == "schemas:":
            continue
        if line.startswith("  ") and not line.startswith("    ") and line.strip().endswith(":"):
            current_schema = line.strip()[:-1]
            result["schemas"][current_schema] = {}
            continue
        if current_schema is None:
            continue
        if line.startswith("    mirror:"):
            value = line.split(":", 1)[1].strip()
            result["schemas"][current_schema]["mirror"] = value.strip().strip("\"'")
            continue

    return result


def load_stencil_mirror_config() -> Dict[str, Any]:
    path = _config_path()
    if not path.exists():
        return {"schemas": {}}
    text = path.read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore

        parsed = yaml.safe_load(text) or {}
        return parsed if isinstance(parsed, dict) else {"schemas": {}}
    except Exception:
        return _parse_simple_yaml(text.splitlines())


def resolve_mirror_title(schema: str, config: Dict[str, Any]) -> str:
    key = str(schema or "").strip()
    if not key:
        return ""
    schemas = config.get("schemas") if isinstance(config, dict) else {}
    if not isinstance(schemas, dict):
        return ""
    entry = schemas.get(key)
    if not isinstance(entry, dict):
        return ""
    value = entry.get("mirror")
    return str(value or "").strip()

