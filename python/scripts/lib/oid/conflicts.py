from typing import Dict, List


def collect_import_conflicts(items: List[Dict], known_oids: Dict[str, Dict]) -> List[Dict]:
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


def build_conflict_table_rows(conflicts: List[Dict]) -> str:
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
