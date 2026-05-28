#!/usr/bin/env python3
"""Bind selected stencils with parents from current selection."""

from __future__ import annotations

from typing import Any, Dict, List

from lib.diagram.parent_linking import (
    build_parent_link_updates,
    extract_stencil_items_from_payload,
    load_parent_rules,
)
from lib.events import build_update_stencil_data_bulk_command
from lib.io import build_error_policy_payload, get_payload, read_request, write_response
from lib.logging import build_script_logger


def _extract_selected_stencils(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    return extract_stencil_items_from_payload(payload, key="selection")


def _collision_text(row: Dict[str, Any]) -> str:
    candidates = row.get("candidateParentOids") or []
    normalized = sorted({str(x).strip() for x in candidates if str(x).strip()})
    rendered = ", ".join(normalized)
    return f"Коллизия, найдено более одного кандидата : <{rendered}>"


def main() -> int:
    try:
        request = read_request()
        payload = get_payload(request)
        logger = build_script_logger(payload)
        selected = _extract_selected_stencils(payload)
        parent_rules = load_parent_rules()

        updates, collisions, missing, skipped_no_rule = build_parent_link_updates(selected, parent_rules)
        current_page = payload.get("currentPage") if isinstance(payload.get("currentPage"), dict) else {}
        page_id = current_page.get("id")

        commands: List[Dict[str, Any]] = []
        if updates:
            commands.append(
                build_update_stencil_data_bulk_command(
                    page_id,
                    updates,
                    suppress_stencil_events=True,
                )
            )

        collision_messages_seen: set[str] = set()
        for row in collisions:
            text = _collision_text(row)
            if text in collision_messages_seen:
                continue
            collision_messages_seen.add(text)
            commands.append(
                {
                    "name": "showMessage",
                    "args": {
                        "level": "error",
                        "text": text,
                    },
                }
            )

        if not updates and missing:
            commands.append(
                {
                    "name": "showMessage",
                    "args": {
                        "level": "error",
                        "text": (
                            "Не найден кандидат на роль родителя для выбранных элементов. "
                            "Связи не установлены."
                        ),
                    },
                }
            )

        stats = {
            "handler": "link_with_parent",
            "processedCount": len(selected),
            "updatedCount": len(updates),
            "collisionCount": len(collisions),
            "missingParentCount": len(missing),
            "skippedNoRuleCount": len(skipped_no_rule),
        }
        logger.debug(stats)
        if collisions:
            logger.debug({"handler": "link_with_parent", "collisions": collisions})
        if missing:
            logger.debug({"handler": "link_with_parent", "missingParents": missing})

        if updates:
            return write_response(
                status="success",
                message=f"Связи с родителем установлены: {len(updates)}",
                payload={
                    **stats,
                    "collisions": collisions,
                    "missingParents": missing,
                },
                commands=commands,
                errors=[],
                exit_code=0,
            )

        return write_response(
            status="error",
            message="Связать с родителем: ни одна связь не установлена",
            payload=build_error_policy_payload(
                {
                    **stats,
                    "collisions": collisions,
                    "missingParents": missing,
                },
                user_visible=False,
            ),
            commands=commands,
            errors=["no_links_applied"],
            exit_code=0,
        )
    except Exception as exc:
        logger = build_script_logger({})
        logger.error(f"link_with_parent failed: {exc}")
        return write_response(
            status="error",
            message=f"link_with_parent failed: {exc}",
            payload=build_error_policy_payload({"handler": "link_with_parent"}, user_visible=False),
            errors=["handler_failed"],
            exit_code=0,
        )


if __name__ == "__main__":
    raise SystemExit(main())
