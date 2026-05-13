from typing import Dict, List, Tuple


def schema_code(schema: str) -> str:
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


def next_oid(
    company_prefix: str,
    schema: str,
    known_oids: Dict[str, Dict],
    reserved_oids: Dict[str, bool],
) -> str:
    base = f"{company_prefix}.{schema_code(schema)}."
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


def build_oid_updates(
    items: List[Dict],
    company_prefix: str,
    known_oids: Dict[str, Dict],
) -> Tuple[List[Dict], List[Dict]]:
    reserved: Dict[str, bool] = {}
    updates: List[Dict] = []
    assigned: List[Dict] = []
    for item in items:
        object_id = item.get("objectId") or item.get("id")
        if not object_id:
            continue
        schema = item.get("schema") or ""
        oid = next_oid(company_prefix, schema, known_oids, reserved)
        updates.append(
            {
                "objectId": object_id,
                "mode": "merge",
                "data": {"OID": oid},
            }
        )
        assigned.append({"objectId": object_id, "OID": oid})
    return updates, assigned


def build_oid_updates_for_empty_oid_items(
    items: List[Dict],
    company_prefix: str,
    known_oids: Dict[str, Dict],
) -> Tuple[List[Dict], List[Dict]]:
    """Build OID updates only when OID is missing or blank (never overwrite non-empty).

    Used for stencil `add` so reparent/move-to-layer (second synthetic `add` with same cell)
    does not bump the sequence.
    """
    reserved: Dict[str, bool] = {}
    updates: List[Dict] = []
    assigned: List[Dict] = []
    for item in items:
        object_id = item.get("objectId") or item.get("id")
        if not object_id:
            continue
        data = item.get("data") if isinstance(item.get("data"), dict) else {}
        oid_raw = ""
        if "OID" in data:
            oid_raw = str(data.get("OID") or "").strip()
        if oid_raw:
            continue
        schema = item.get("schema") or ""
        oid = next_oid(company_prefix, schema, known_oids, reserved)
        updates.append(
            {
                "objectId": object_id,
                "mode": "merge",
                "data": {"OID": oid},
            }
        )
        assigned.append({"objectId": object_id, "OID": oid})
    return updates, assigned
