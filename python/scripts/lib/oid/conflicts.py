from typing import Any, Dict, List


def normalize_known_oid_entry(entry: Any) -> List[str]:
    """Normalize known OID registry entry to list of object ids."""
    if isinstance(entry, list):
        return [str(row).strip() for row in entry if str(row).strip()]
    if isinstance(entry, dict):
        object_ids = entry.get("objectIds")
        if isinstance(object_ids, list):
            return [str(row).strip() for row in object_ids if str(row).strip()]
    return []


def collect_import_conflicts(items: List[Dict], known_oids: Dict[str, Any]) -> List[Dict]:
    conflicts: List[Dict] = []
    for item in items:
        data = item.get("data") or {}
        object_id = item.get("objectId") or item.get("id")
        oid = str(data.get("OID", "")).strip()
        if not oid:
            continue
        existing = known_oids.get(oid)
        existing_ids = normalize_known_oid_entry(existing)
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
