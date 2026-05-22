"""Helpers for Tools -> Edit Data bulk apply."""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from lib.diagram.linked_page_sync import build_linked_page_sync_commands
from lib.main_menu.diagram_index import build_diagram_index_by_object_id
from lib.main_menu.seaf_data_map import build_import_patch


def build_edit_data_apply_commands(
    schema: str,
    edited_rows: List[Dict[str, Any]],
    schema_objects: List[Dict[str, Any]],
    pages: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Build UI commands to persist bulk-edited rows.

    Uses updateStencilDataBulk per page (objectId-specific), plus linked-page sync
    commands where applicable.
    """
    schema_key = str(schema or "").strip()
    by_object_id = build_diagram_index_by_object_id(schema_objects)
    updates_by_page: Dict[str, List[Dict[str, Any]]] = {}
    page_sync_commands: List[Dict[str, Any]] = []
    sync_seen: set[Tuple[str, str, str]] = set()
    stats: Dict[str, Any] = {
        "rowsReceived": len(edited_rows),
        "rowsPrepared": 0,
        "rowsSkipped": 0,
        "pagesTouched": 0,
        "titleLabelSynced": [],
    }

    for raw_row in edited_rows:
        if not isinstance(raw_row, dict):
            stats["rowsSkipped"] += 1
            continue
        object_id = str(raw_row.get("objectId") or "").strip()
        row_schema = str(raw_row.get("schema") or schema_key).strip()
        if not object_id or row_schema != schema_key:
            stats["rowsSkipped"] += 1
            continue

        match = by_object_id.get(object_id)
        if match is None:
            stats["rowsSkipped"] += 1
            continue

        attrs = raw_row.get("data") if isinstance(raw_row.get("data"), dict) else {}
        data_before = match.get("data") if isinstance(match.get("data"), dict) else {}
        patch, title_label_synced = build_import_patch(row_schema, attrs, data_before)
        if not patch:
            stats["rowsSkipped"] += 1
            continue

        page_id = str(match.get("pageId") or "").strip()
        if not page_id:
            stats["rowsSkipped"] += 1
            continue

        updates_by_page.setdefault(page_id, []).append(
            {
                "objectId": object_id,
                "data": patch,
                "mode": "merge",
            }
        )
        stats["rowsPrepared"] += 1
        if title_label_synced:
            stats["titleLabelSynced"].append({"schema": row_schema, "oid": match.get("oid", ""), "objectId": object_id})

        aligned_after = dict(data_before)
        aligned_after.update(patch)
        sync_cmds = build_linked_page_sync_commands(
            schema=row_schema,
            data_before=data_before,
            data_after=aligned_after,
            object_id=object_id,
            linked_page_id=str(match.get("linkedPageId") or "").strip(),
            pages=pages,
            seen_keys=sync_seen,
        )
        if sync_cmds:
            page_sync_commands.extend(sync_cmds)

    commands: List[Dict[str, Any]] = []
    for page_id, page_updates in updates_by_page.items():
        if not page_updates:
            continue
        commands.append(
            {
                "name": "updateStencilDataBulk",
                "args": {
                    "pageId": page_id,
                    "updates": page_updates,
                    "suppressStencilEvents": True,
                },
            }
        )
    stats["pagesTouched"] = len(updates_by_page)
    commands.extend(page_sync_commands)
    return commands, stats
