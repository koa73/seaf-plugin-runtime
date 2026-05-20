"""Lookup helpers for mirror stencil metadata in P41 library."""

from __future__ import annotations

import json
import re
from html import unescape
from pathlib import Path
from typing import Any, Dict, List


_SCHEMA_RE = re.compile(r'\bschema="([^"]+)"')


def _library_path() -> Path:
    return Path(__file__).resolve().parents[4] / "conf" / "stencils" / "Р41.xml"


def _extract_schema_from_xml(xml_value: str) -> str:
    text = unescape(str(xml_value or ""))
    if not text:
        return ""
    match = _SCHEMA_RE.search(text)
    if not match:
        return ""
    return str(match.group(1) or "").strip()


def resolve_mirror_schema_by_title(mirror_title: str) -> str:
    """Resolve schema by item title from conf/stencils/Р41.xml library."""
    title = str(mirror_title or "").strip()
    if not title:
        return ""
    path = _library_path()
    if not path.exists():
        return ""
    raw = path.read_text(encoding="utf-8")
    raw = raw.strip()
    if raw.startswith("<mxlibrary>") and raw.endswith("</mxlibrary>"):
        raw = raw[len("<mxlibrary>") : -len("</mxlibrary>")]
    entries: List[Dict[str, Any]]
    try:
        parsed = json.loads(raw)
        entries = parsed if isinstance(parsed, list) else []
    except Exception:
        entries = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        item_title = str(entry.get("title") or "").strip()
        if item_title != title:
            continue
        schema = _extract_schema_from_xml(str(entry.get("xml") or ""))
        if schema:
            return schema
    return ""

