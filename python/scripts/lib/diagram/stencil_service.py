"""Helpers to extract stencil metadata from command payload."""

from __future__ import annotations

from typing import Any, Dict, Optional


def get_primary_selection(payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Return first selected stencil object from payload.selection."""
    selection = payload.get("selection")
    if not isinstance(selection, list) or len(selection) == 0:
        return None
    first = selection[0]
    return first if isinstance(first, dict) else None


def get_context_object(payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Return context-menu source object snapshot from payload."""
    obj = payload.get("contextObject")
    return obj if isinstance(obj, dict) else None


def extract_stencil_title(selection_item: Optional[Dict[str, Any]]) -> str:
    """Return normalized title from selected stencil data."""
    if not isinstance(selection_item, dict):
        return ""
    data = selection_item.get("data")
    if not isinstance(data, dict):
        return ""
    title = data.get("title")
    return str(title or "").strip()


def extract_object_id(selection_item: Optional[Dict[str, Any]]) -> str:
    """Return objectId/cell id for selected stencil."""
    if not isinstance(selection_item, dict):
        return ""
    object_id = str(selection_item.get("objectId") or "").strip()
    if object_id:
        return object_id
    return str(selection_item.get("id") or "").strip()

