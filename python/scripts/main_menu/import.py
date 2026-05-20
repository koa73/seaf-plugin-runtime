#!/usr/bin/env python3
"""P41 Import: read SEAF YAML and update stencil data by schema+OID."""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from lib.config.env_config import build_env_config
from lib.io import (
    build_error_policy_payload,
    emit_progress,
    get_payload,
    read_request,
    write_response,
)
from lib.logging import build_script_logger
from lib.main_menu.export_helpers import is_seaf_export_schema
from lib.main_menu.import_helpers import resolve_input_targets
from lib.main_menu.import_report import ImportReport, log_import_report
from lib.main_menu.import_yaml_loader import build_import_map_from_sources
from lib.main_menu.seaf_data_map import build_import_patch

HANDLER = "main_menu.import"


def _error_response(logger, report: ImportReport, message: str, reason: str) -> int:
    report.errors.append(message)
    log_import_report(logger, report)
    logger.error(message)
    return write_response(
        status="error",
        message=message,
        payload=build_error_policy_payload(
            {"handler": HANDLER, "reason": reason},
            user_visible=True,
        ),
        commands=[{"name": "showMessage", "args": {"level": "error", "text": message}}],
        errors=[message],
    )


def _build_diagram_index(schema_objects: List[Dict[str, Any]]) -> Dict[Tuple[str, str], List[Dict[str, Any]]]:
    out: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    for item in schema_objects:
        if not isinstance(item, dict):
            continue
        schema = str(item.get("schema") or "").strip()
        oid = str(item.get("oid") or item.get("OID") or "").strip()
        object_id = str(item.get("objectId") or item.get("id") or "").strip()
        if not schema or not oid or not object_id:
            continue
        if not is_seaf_export_schema(schema):
            continue
        cell_data = item.get("data") if isinstance(item.get("data"), dict) else {}
        out.setdefault((schema, oid), []).append(
            {
                "pageId": item.get("pageId"),
                "pageName": item.get("pageName") or "",
                "objectId": object_id,
                "schema": schema,
                "oid": oid,
                "data": dict(cell_data),
            }
        )
    return out


def _append_unmatched(report: ImportReport, schema: str, oid: str) -> None:
    bucket = report.unmatched_in_diagram.setdefault(schema, [])
    if oid not in bucket:
        bucket.append(oid)


def _build_updates(
    import_map: Dict[str, Dict[str, Dict[str, Any]]],
    diagram_index: Dict[Tuple[str, str], List[Dict[str, Any]]],
    report: ImportReport,
) -> List[Dict[str, Any]]:
    updates: List[Dict[str, Any]] = []
    for schema in sorted(import_map.keys()):
        oid_map = import_map.get(schema) if isinstance(import_map.get(schema), dict) else {}
        for oid in sorted(oid_map.keys()):
            key = (schema, oid)
            matches = diagram_index.get(key, [])
            if not matches:
                _append_unmatched(report, schema, oid)
                continue
            yaml_attrs = oid_map.get(oid) if isinstance(oid_map.get(oid), dict) else {}
            data_before = matches[0].get("data") if isinstance(matches[0].get("data"), dict) else {}
            patch, title_label_synced = build_import_patch(schema, yaml_attrs, data_before)
            if not patch:
                continue
            match_ids = [row.get("objectId") for row in matches if row.get("objectId")]
            report.matched.extend(matches)
            if title_label_synced:
                report.title_label_synced.append({"schema": schema, "oid": oid})
            report.updates.append(
                {
                    "schema": schema,
                    "oid": oid,
                    "objectIds": match_ids,
                    "patchKeys": sorted(patch.keys()),
                    "titleLabelSync": title_label_synced,
                }
            )
            updates.append(
                {
                    "schema": schema,
                    "oid": oid,
                    "patch": patch,
                }
            )
    return updates


def main() -> int:
    request = read_request()
    payload = get_payload(request)
    logger = build_script_logger(payload)
    env = build_env_config(request)
    report = ImportReport()

    emit_progress(5, "scan_input", "Resolving input path")
    try:
        targets = resolve_input_targets(env)
    except ValueError as exc:
        return _error_response(logger, report, str(exc), "input_path_invalid")
    report.files_discovered = list(targets.yaml_files)

    emit_progress(30, "read_yaml", "Loading YAML files")
    import_map, load_stats = build_import_map_from_sources(targets.yaml_files, env=env)
    report.files_read = list(load_stats.files_read)
    report.loaded = list(load_stats.loaded)
    report.skipped_duplicate = list(load_stats.skipped_duplicate)
    report.skipped_schema = list(load_stats.skipped_schema)
    report.files_invalid = list(load_stats.files_invalid)
    report.warnings.extend(load_stats.warnings)

    if not import_map:
        return _error_response(
            logger,
            report,
            "Не найдено данных SEAF в формате Export (schema->OID->attrs).",
            "input_data_invalid",
        )

    emit_progress(65, "match_diagram", "Matching schema+OID on diagram")
    schema_objects = payload.get("schemaObjects")
    if not isinstance(schema_objects, list):
        schema_objects = []
    diagram_index = _build_diagram_index(schema_objects)
    updates = _build_updates(import_map, diagram_index, report)

    emit_progress(90, "prepare_updates", "Preparing update batch")
    commands: List[Dict[str, Any]] = []
    if updates:
        commands.append(
            {
                "name": "applySeafImportBatch",
                "args": {
                    "updates": updates,
                    "suppressStencilEvents": True,
                },
            }
        )

    emit_progress(100, "done", "Import mapping prepared")
    log_import_report(logger, report)

    return write_response(
        status="success",
        message=f"Import prepared: {len(updates)} object(s) to update",
        payload={
            "handler": HANDLER,
            "loadedFromFilesCount": report.loaded_from_files_count,
            "loadedObjectCount": report.loaded_object_count,
            "matchedOnDiagramCount": report.matched_on_diagram_count,
            "updatesPreparedCount": len(updates),
            "unmatchedInDiagram": report.unmatched_in_diagram,
            "warnings": report.warnings,
        },
        commands=commands,
        errors=[],
    )


if __name__ == "__main__":
    raise SystemExit(main())
