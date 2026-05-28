#!/usr/bin/env python3
"""Bind selected stencils with parents from current selection."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Tuple

from lib.events import build_update_stencil_data_bulk_command
from lib.io import build_error_policy_payload, get_payload, read_request, write_response
from lib.logging import build_script_logger


def _config_path() -> Path:
    return Path(__file__).resolve().parents[3] / "conf" / "stencils" / "config.yaml"


def _load_parent_rules() -> Dict[str, Dict[str, str]]:
    path = _config_path()
    if not path.exists():
        return {}

    text = path.read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore

        parsed = yaml.safe_load(text) or {}
        schemas = parsed.get("schemas") if isinstance(parsed, dict) else {}
        if not isinstance(schemas, dict):
            return {}
        out: Dict[str, Dict[str, str]] = {}
        for schema, entry in schemas.items():
            if not isinstance(schema, str) or not isinstance(entry, dict):
                continue
            parent = entry.get("parent")
            if not isinstance(parent, dict):
                continue
            parent_schema = str(parent.get("schema") or "").strip()
            parent_field = str(parent.get("field") or "").strip()
            if parent_schema and parent_field:
                out[schema.strip()] = {"schema": parent_schema, "field": parent_field}
        return out
    except Exception:
        return {}


def _extract_selected_stencils(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    selection = payload.get("selection")
    if not isinstance(selection, list):
        return []
    out = []
    seen_ids: set[str] = set()
    for item in selection:
        if not isinstance(item, dict):
            continue
        data = item.get("data") if isinstance(item.get("data"), dict) else {}
        object_id = str(item.get("objectId") or item.get("id") or "").strip()
        schema = str(data.get("schema") or "").strip()
        oid = str(data.get("OID") or "").strip()
        if not object_id or object_id in seen_ids:
            continue
        seen_ids.add(object_id)
        out.append(
            {
                "objectId": object_id,
                "schema": schema,
                "oid": oid,
                "data": data,
            }
        )
    return out


def _build_link_updates(
    selected: List[Dict[str, Any]],
    parent_rules: Dict[str, Dict[str, str]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    updates: List[Dict[str, Any]] = []
    collisions: List[Dict[str, Any]] = []
    missing: List[Dict[str, Any]] = []
    skipped_no_rule: List[Dict[str, Any]] = []

    for child in selected:
        child_schema = child["schema"]
        child_id = child["objectId"]
        if not child_schema or child_schema not in parent_rules:
            skipped_no_rule.append({"objectId": child_id, "schema": child_schema})
            continue

        rule = parent_rules[child_schema]
        parent_schema = rule["schema"]
        parent_field = rule["field"]

        candidates = [
            candidate
            for candidate in selected
            if candidate["objectId"] != child_id
            and candidate["schema"] == parent_schema
            and candidate["oid"]
        ]

        if len(candidates) == 1:
            updates.append(
                {
                    "objectId": child_id,
                    "mode": "merge",
                    "data": {parent_field: candidates[0]["oid"]},
                }
            )
            continue

        if len(candidates) == 0:
            missing.append(
                {
                    "objectId": child_id,
                    "schema": child_schema,
                    "expectedParentSchema": parent_schema,
                    "field": parent_field,
                }
            )
            continue

        collisions.append(
            {
                "objectId": child_id,
                "schema": child_schema,
                "expectedParentSchema": parent_schema,
                "field": parent_field,
                "candidateParentObjectIds": [x["objectId"] for x in candidates],
                "candidateParentOids": [x["oid"] for x in candidates],
            }
        )

    return updates, collisions, missing, skipped_no_rule


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
        parent_rules = _load_parent_rules()

        updates, collisions, missing, skipped_no_rule = _build_link_updates(selected, parent_rules)
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
