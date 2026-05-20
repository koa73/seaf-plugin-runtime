"""Helpers to read and validate diagram page metadata."""

from __future__ import annotations

from typing import Any, Dict, List, Optional


def normalize_page_name(name: Any) -> str:
    """Normalize user-provided page name."""
    return str(name or "").strip()


def list_pages(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return normalized page list from payload.pages."""
    pages = payload.get("pages")
    if not isinstance(pages, list):
        return []
    out: List[Dict[str, Any]] = []
    for page in pages:
        if not isinstance(page, dict):
            continue
        out.append(
            {
                "id": str(page.get("id") or "").strip(),
                "name": str(page.get("name") or "").strip(),
                "isCurrent": page.get("isCurrent") is True,
            }
        )
    return out


def find_page_by_id(pages: List[Dict[str, Any]], page_id: str) -> Optional[Dict[str, Any]]:
    """Find page metadata by id."""
    target_id = str(page_id or "").strip()
    if not target_id:
        return None
    for page in pages:
        if str(page.get("id") or "").strip() == target_id:
            return page
    return None


def find_page_by_name(pages: List[Dict[str, Any]], name: str) -> Optional[Dict[str, Any]]:
    """Find existing page by exact normalized name."""
    target = normalize_page_name(name)
    if not target:
        return None
    for page in pages:
        if str(page.get("name") or "").strip() == target:
            return page
    return None

