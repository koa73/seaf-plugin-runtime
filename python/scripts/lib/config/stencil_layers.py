"""Helpers to resolve stencil layer names from conf/stencils/config.yaml."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def _config_path() -> Path:
    """Return absolute path to stencil layer config file."""
    return Path(__file__).resolve().parents[4] / "conf" / "stencils" / "config.yaml"


def _parse_simple_yaml(lines: List[str]) -> Dict[str, Any]:
    """Parse a minimal subset of YAML used in stencil layer config."""
    result: Dict[str, Any] = {"schemas": {}}
    current_schema: Optional[str] = None
    in_layer_list = False

    for raw in lines:
        line = raw.rstrip("\n")
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line.strip() == "schemas:":
            continue
        if line.startswith("  ") and not line.startswith("    ") and line.strip().endswith(":"):
            current_schema = line.strip()[:-1]
            result["schemas"][current_schema] = {}
            in_layer_list = False
            continue
        if current_schema is None:
            continue
        if line.startswith("    layer:"):
            value = line.split(":", 1)[1].strip()
            if not value:
                result["schemas"][current_schema]["layer"] = []
                in_layer_list = True
            else:
                result["schemas"][current_schema]["layer"] = value.strip().strip("\"'")
                in_layer_list = False
            continue
        if in_layer_list and line.startswith("      - "):
            value = line[len("      - ") :].strip().strip("\"'")
            result["schemas"][current_schema]["layer"].append(value)
    return result


def load_stencil_layer_config() -> Dict[str, Any]:
    """Load config.yaml as dict without requiring external deps."""
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


def resolve_layer_name(schema: str, config: Dict[str, Any]) -> Tuple[Optional[str], bool]:
    """Resolve layer name by schema, return (layer_name_or_none, has_multiple)."""
    schemas = config.get("schemas") or {}
    entry = schemas.get(schema) or {}
    raw = entry.get("layer")
    if isinstance(raw, str):
        value = raw.strip()
        return (value if value else None, False)
    if isinstance(raw, list):
        values = [str(v or "").strip() for v in raw]
        non_empty = [v for v in values if v]
        if not non_empty:
            return (None, True)
        return (non_empty[0], len(non_empty) > 1)
    return (None, False)
