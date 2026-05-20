"""Sync linked diagram page name and graph link when stencil title/label changes."""

from __future__ import annotations

from typing import Any, Dict, List, Set, Tuple

from lib.diagram.link_service import build_link_to_page_command, build_rename_linked_page_command
from lib.diagram.page_service import find_page_by_id, normalize_page_name

LINK_PAGE_SCHEMAS = frozenset(
    {
        "seaf.company.ta.services.dcs",
        "seaf.company.ta.services.dc_offices",
    }
)


def _norm_field(data: Dict[str, Any], key: str) -> str:
    raw = data.get(key) if isinstance(data, dict) else None
    if raw is None:
        return ""
    return str(raw).strip()


def page_title_from_data(data: Dict[str, Any]) -> str:
    """Resolve page title from stencil data (title preferred, else label)."""
    if not isinstance(data, dict):
        return ""
    title = normalize_page_name(data.get("title"))
    if title:
        return title
    return normalize_page_name(data.get("label"))


def title_or_label_changed(data_before: Dict[str, Any], data_after: Dict[str, Any]) -> bool:
    before = data_before if isinstance(data_before, dict) else {}
    after = data_after if isinstance(data_after, dict) else {}
    return _norm_field(before, "title") != _norm_field(after, "title") or _norm_field(before, "label") != _norm_field(
        after, "label"
    )


def needs_linked_page_sync(
    schema: str,
    data_before: Dict[str, Any],
    data_after: Dict[str, Any],
    linked_page_id: str,
) -> bool:
    sch = str(schema or "").strip()
    page_id = str(linked_page_id or "").strip()
    if sch not in LINK_PAGE_SCHEMAS or not page_id:
        return False
    if not title_or_label_changed(data_before, data_after):
        return False
    return bool(page_title_from_data(data_after))


def _sync_command_key(command: Dict[str, Any]) -> Tuple[str, str, str]:
    args = command.get("args") if isinstance(command.get("args"), dict) else {}
    return (
        str(command.get("name") or ""),
        str(args.get("targetPageId") or "").strip(),
        str(args.get("title") or "").strip(),
    )


def build_linked_page_sync_commands(
    *,
    schema: str,
    data_before: Dict[str, Any],
    data_after: Dict[str, Any],
    object_id: str,
    linked_page_id: str,
    pages: List[Dict[str, Any]],
    seen_keys: Set[Tuple[str, str, str]] | None = None,
) -> List[Dict[str, Any]]:
    """
    Build rename/link UI commands when a linked page exists and title/label changed.

    No showMessage — duplicate UX is mxUtils.confirm in renameLinkedPage only.
    """
    if not needs_linked_page_sync(schema, data_before, data_after, linked_page_id):
        return []

    page_id = str(linked_page_id or "").strip()
    if find_page_by_id(pages, page_id) is None:
        return []

    title = page_title_from_data(data_after)
    if not title:
        return []

    oid = str(object_id or "").strip()
    out: List[Dict[str, Any]] = []
    dedupe = seen_keys if seen_keys is not None else set()

    rename_cmd = build_rename_linked_page_command(
        page_id=page_id,
        title=title,
        object_id=oid,
        confirm_on_duplicate=True,
    )
    rename_key = _sync_command_key(rename_cmd)
    if rename_key not in dedupe:
        dedupe.add(rename_key)
        out.append(rename_cmd)

    if oid:
        link_cmd = build_link_to_page_command(object_id=oid, title=title, page_id=page_id)
        link_key = _sync_command_key(link_cmd)
        if link_key not in dedupe:
            dedupe.add(link_key)
            out.append(link_cmd)

    return out
