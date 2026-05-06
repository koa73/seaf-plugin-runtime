#!/usr/bin/env python3
import json
import sys
from typing import Dict, List

from lib.io import read_request, write_response


def _emit_info(payload: dict) -> None:
    print(f"SEAF_INFO {json.dumps(payload, ensure_ascii=False)}", file=sys.stderr)


def _emit_error(message: str) -> None:
    print(f"SEAF_ERROR {message}", file=sys.stderr)


def _log_items(handler: str, event: dict, items: list) -> None:
    page = event.get("page") or {}
    for item in items:
        geometry = item.get("geometry") or {}
        data = item.get("data") or {}
        object_id = item.get("objectId") or item.get("id")
        debug_row = {
            "handler": handler,
            "objectId": object_id,
            "pageId": page.get("id"),
            "pageName": page.get("name"),
            "geometry": {
                "x": geometry.get("x"),
                "y": geometry.get("y"),
                "width": geometry.get("width"),
                "height": geometry.get("height"),
            },
            "data": data,
        }
        _emit_info(debug_row)


def _schema_code(schema: str) -> str:
    raw = str(schema or "").strip()
    if not raw:
        return "unknown"
    parts = [p.strip() for p in raw.split(".") if p and p.strip()]
    if len(parts) < 2:
        return "unknown"
    return f"{parts[-2]}.{parts[-1]}"


def _extract_sequence(oid_value: str, expected_prefix: str) -> int:
    text = str(oid_value or "").strip()
    if not text or not expected_prefix:
        return -1
    if not text.startswith(expected_prefix):
        return -1
    suffix = text[len(expected_prefix):]
    if not suffix.isdigit():
        return -1
    try:
        return int(suffix)
    except ValueError:
        return -1


def _build_conflict_table_rows(conflicts: List[Dict]) -> str:
    if not conflicts:
        return ""
    header = "| cellId | OID | schema | conflictWithCellId | conflictWithSchema |\n|---|---|---|---|---|"
    rows = [header]
    for row in conflicts:
        rows.append(
            "| {cellId} | {OID} | {schema} | {conflictWithCellId} | {conflictWithSchema} |".format(
                cellId=str(row.get("cellId", "")),
                OID=str(row.get("OID", "")),
                schema=str(row.get("schema", "")),
                conflictWithCellId=str(row.get("conflictWithCellId", "")),
                conflictWithSchema=str(row.get("conflictWithSchema", "")),
            )
        )
    return "\n".join(rows)


def _next_oid(
    company_prefix: str,
    schema: str,
    known_oids: Dict[str, Dict],
    reserved_oids: Dict[str, bool],
) -> str:
    schema_code = _schema_code(schema)
    base = f"{company_prefix}.{schema_code}."
    max_seq = 0
    for existing_oid in known_oids.keys():
        seq = _extract_sequence(existing_oid, base)
        if seq > max_seq:
            max_seq = seq
    next_seq = max_seq + 1
    while True:
        candidate = f"{base}{next_seq}"
        if candidate not in known_oids and candidate not in reserved_oids:
            reserved_oids[candidate] = True
            return candidate
        next_seq += 1


def _collect_import_conflicts(items: List[Dict], known_oids: Dict[str, Dict]) -> List[Dict]:
    conflicts: List[Dict] = []
    for item in items:
        data = item.get("data") or {}
        object_id = item.get("objectId") or item.get("id")
        oid = str(data.get("OID", "")).strip()
        if not oid:
            continue
        existing = known_oids.get(oid) or {}
        existing_ids = existing.get("objectIds") or []
        for existing_id in existing_ids:
            if existing_id == object_id:
                continue
            conflicts.append(
                {
                    "cellId": object_id,
                    "OID": oid,
                    "schema": item.get("schema") or "",
                    "conflictWithCellId": existing_id,
                    "conflictWithSchema": "",
                }
            )
    return conflicts


def main() -> int:
    try:
        req = read_request()
        payload = req.get("payload") or {}
        event = payload.get("event") or {}
        items = event.get("items") or []
        _log_items("all_add", event, items)
        commands = []
        page = event.get("page") or {}
        index = event.get("index") or {}
        by_oid = index.get("byOid") or {}
        company_prefix = str((payload.get("arguments") or {}).get("companyPrefix") or "").strip()
        if not company_prefix:
            env = payload.get("env") or {}
            company_prefix = str(env.get("companyPrefix") or "").strip()
        if not company_prefix:
            company_prefix = "company"

        conflicts = _collect_import_conflicts(items, by_oid)
        if conflicts:
            conflict_message = (
                "Обнаружены коллизии OID при добавлении/импорте. "
                "Автоматическая дедупликация не выполняется. "
                "Требуется ручной разбор.\n\n"
                + _build_conflict_table_rows(conflicts)
            )
            commands.append(
                {
                    "name": "showMessage",
                    "args": {
                        "level": "info",
                        "text": conflict_message,
                    },
                }
            )

        reserved: Dict[str, bool] = {}
        bulk_updates: List[Dict] = []
        for item in items:
            object_id = item.get("objectId") or item.get("id")
            if not object_id:
                continue
            schema = item.get("schema") or ""
            next_oid = _next_oid(company_prefix, schema, by_oid, reserved)
            _emit_info({"handler": "all_add", "action": "assign_oid", "objectId": object_id, "OID": next_oid})
            bulk_updates.append(
                {
                    "objectId": object_id,
                    "mode": "merge",
                    "data": {"OID": next_oid},
                }
            )

        if bulk_updates:
            commands.append(
                {
                    "name": "updateStencilDataBulk",
                    "args": {
                        "pageId": page.get("id"),
                        "updates": bulk_updates,
                    },
                }
            )
            commands.append(
                {
                    "name": "ensureLayer",
                    "args": {
                        "pageId": page.get("id"),
                        "layerName": "SEAF_AUTO_LAYER",
                        "makeVisible": True,
                    },
                }
            )
        return write_response(
            status="success",
            message=f"all_add processed: {len(items)}",
            payload={"handler": "all_add", "count": len(items), "note": "uiCommandResults are attached by renderer after command execution"},
            commands=commands,
        )
    except Exception as exc:
        _emit_error(f"all_add failed: {exc}")
        return write_response(status="error", message=f"all_add failed: {exc}", payload={"handler": "all_add"})


if __name__ == "__main__":
    raise SystemExit(main())
