"""Helpers to build UI commands for page links."""

from __future__ import annotations

from typing import Any, Dict, Optional


def build_create_page_command(title: str, select_created: bool = True) -> Dict[str, Any]:
    """Build UI command that creates a page using draw.io page API."""
    return {
        "name": "createPage",
        "args": {
            "title": title,
            "selectCreated": select_created,
        },
    }


def build_link_to_page_command(object_id: str, title: str, page_id: Optional[str] = None) -> Dict[str, Any]:
    """Build UI command that links source stencil to page.

    Runtime resolves `targetPageId` from preceding `createPage` result when page_id is not provided.
    """
    target_page_id = str(page_id or "").strip()
    args: Dict[str, Any] = {
        "objectId": object_id,
    }
    if target_page_id:
        args["targetPageId"] = target_page_id
    else:
        # Keep title as diagnostic context only; runtime no longer resolves pageId from title.
        args["targetPageTitle"] = title
    return {
        "name": "setCellLinkToPage",
        "args": args,
    }

