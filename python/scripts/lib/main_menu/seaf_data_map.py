"""Shared helpers for SEAF schema/OID maps used by import/export."""

from __future__ import annotations

import json
from typing import Any, Dict, Tuple

from lib.events import apply_title_label_sync
from lib.main_menu.export_helpers import EXPORT_EXCLUDED


def _norm_field(data: Dict[str, Any], key: str) -> str:
    raw = data.get(key) if isinstance(data, dict) else None
    if raw is None:
        return ""
    return str(raw).strip()


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


def build_import_patch(
    schema: str,
    yaml_attrs: Dict[str, Any],
    data_before: Dict[str, Any],
) -> Tuple[Dict[str, Any], bool]:
    """
    Build merge patch from YAML attrs and align title/label like modify events.

    Returns (patch, title_label_sync_applied).
    """
    patch = sanitize_import_patch(yaml_attrs)
    if not patch:
        return {}, False

    before = data_before if isinstance(data_before, dict) else {}
    data_after = dict(before)
    for key, value in patch.items():
        data_after[key] = value

    aligned = dict(data_after)
    synced = apply_title_label_sync(schema, before, aligned)

    out: Dict[str, Any] = {}
    for key, value in aligned.items():
        name = str(key).strip()
        if not name or name in {"OID", "schema"}:
            continue
        if _norm_field(aligned, name) != _norm_field(before, name):
            out[name] = denormalize_for_stencil(value)
    return out, synced


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

