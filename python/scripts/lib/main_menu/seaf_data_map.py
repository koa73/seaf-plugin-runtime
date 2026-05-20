"""Shared helpers for SEAF schema/OID maps used by import/export."""

from __future__ import annotations

import json
from typing import Any, Dict

from lib.main_menu.export_helpers import EXPORT_EXCLUDED


def sanitize_import_patch(attrs: Dict[str, Any]) -> Dict[str, Any]:
    """Build merge patch for stencil data, excluding match keys only."""
    out: Dict[str, Any] = {}
    if not isinstance(attrs, dict):
        return out
    for key, value in attrs.items():
        name = str(key).strip()
        if not name or name in {"OID", "schema"}:
            continue
        out[name] = denormalize_for_stencil(value)
    return out


def denormalize_for_stencil(value: Any) -> Any:
    """Convert YAML-native structures to draw.io-friendly scalar strings."""
    if isinstance(value, list):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False)
    return value


def normalize_import_attrs(attrs: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize parsed YAML attrs before merge."""
    out: Dict[str, Any] = {}
    if not isinstance(attrs, dict):
        return out
    for key, value in attrs.items():
        name = str(key).strip()
        if not name or name in EXPORT_EXCLUDED:
            continue
        out[name] = value
    return out

