#!/usr/bin/env python3
"""P41 Export: build {schema: {OID: data}} from diagram and write SEAF YAML via yaml_schema_generator."""

from __future__ import annotations

from typing import Any, Dict, List

from lib.config.env_config import build_env_config
from lib.io import (
    build_error_policy_payload,
    emit_progress,
    get_payload,
    read_request,
    write_response,
)
from lib.logging import build_script_logger
from lib.main_menu.export_helpers import (
    build_export_by_schema,
    count_unique_export_objects,
    resolve_output_path,
)
from lib.main_menu.export_report import ExportReport, log_export_report
from lib.main_menu.export_yaml_generator import write_export_outputs_via_generator

HANDLER = "main_menu.export"
OUTPUT_MISSING_MESSAGE = (
    "Не указан Output SEAF file или каталог. Задайте путь в SEAF → Edit Config."
)
OUTPUT_MISSING_POPUP = (
    "Не указан Output SEAF file или каталог. Откройте SEAF → Edit Config и укажите выходной путь."
)


def _output_missing_response(logger) -> int:
    logger.error(OUTPUT_MISSING_MESSAGE)
    return write_response(
        status="error",
        message=OUTPUT_MISSING_MESSAGE,
        payload=build_error_policy_payload(
            {"handler": HANDLER, "reason": "output_file_missing"},
            user_visible=True,
        ),
        commands=[
            {
                "name": "showMessage",
                "args": {"level": "error", "text": OUTPUT_MISSING_POPUP},
            }
        ],
        errors=["outputSeafFile is empty"],
    )


def _write_error_response(logger, message: str, reason: str) -> int:
    logger.error(message)
    return write_response(
        status="error",
        message=message,
        payload=build_error_policy_payload(
            {"handler": HANDLER, "reason": reason},
            user_visible=True,
        ),
        commands=[
            {
                "name": "showMessage",
                "args": {"level": "error", "text": message},
            }
        ],
        errors=[message],
    )


def main() -> int:
    request = read_request()
    payload = get_payload(request)
    logger = build_script_logger(payload)
    env = build_env_config(request)

    emit_progress(5, "resolve_output", "Checking output path")
    output_path = resolve_output_path(env)
    if not output_path:
        return _output_missing_response(logger)

    schema_objects = payload.get("schemaObjects")
    if not isinstance(schema_objects, list):
        schema_objects = []

    report = ExportReport(
        diagram_objects_total=len(schema_objects),
        warnings=[],
    )

    emit_progress(25, "build_map", "Building export map from diagram")
    export_map, warnings, stats = build_export_by_schema(schema_objects, collect_stats=True)
    report.warnings.extend(warnings)
    if stats is not None:
        report.eligible = list(stats.eligible)
        report.skipped_input = list(stats.skipped_input)
        report.skipped_ignored = list(stats.skipped_ignored)
        report.skipped_duplicate = list(stats.skipped_duplicate)

    report.unique_export_object_count = count_unique_export_objects(export_map)

    emit_progress(55, "write_yaml", "Writing YAML files")
    try:
        gen_result = write_export_outputs_via_generator(
            export_map,
            output_path,
            env=env,
            report=report,
        )
    except OSError as exc:
        message = f"Не удалось записать export в {output_path} ({exc})"
        return _write_error_response(logger, message, "output_file_write_failed")

    report.warnings.extend(gen_result.warnings)
    report.written_files = list(gen_result.written_files)
    report.schemas_exported = list(gen_result.schemas_exported)
    report.schemas_skipped = list(gen_result.schemas_skipped)
    report.validation_errors = list(gen_result.validation_errors)
    if not report.exported:
        report.exported = list(gen_result.exported)

    emit_progress(100, "done", "Export completed")
    log_export_report(logger, report)

    schema_count = len(gen_result.schemas_exported)
    object_count = report.exported_count
    logger.info(
        {
            "handler": HANDLER,
            "invoked": True,
            "commandId": request.get("commandId"),
            "source": payload.get("source"),
            "outputPath": output_path,
            "writeMode": gen_result.write_mode,
            "writtenFiles": gen_result.written_files,
            "schemaCount": schema_count,
            "objectCount": object_count,
            "skippedSchemaCount": len(gen_result.schemas_skipped),
            "validationErrorCount": len(gen_result.validation_errors),
            "warnings": report.warnings,
        }
    )

    if gen_result.write_mode == "directory":
        success_message = f"Export written: {len(gen_result.written_files)} YAML file(s) in {output_path}"
    else:
        success_message = f"Export written to {gen_result.written_files[0]}"

    if gen_result.schemas_skipped:
        success_message += f" ({len(gen_result.schemas_skipped)} schema(s) skipped, not in catalog)"

    return write_response(
        status="success",
        message=success_message,
        payload={
            "handler": HANDLER,
            "outputPath": output_path,
            "writeMode": gen_result.write_mode,
            "outputFiles": gen_result.written_files,
            "schemaCount": schema_count,
            "objectCount": object_count,
            "skippedSchemas": gen_result.schemas_skipped,
            "validationErrorCount": len(gen_result.validation_errors),
            "reportSummary": {
                "diagramObjectsTotal": report.diagram_objects_total,
                "eligibleCount": report.eligible_count,
                "exportedCount": report.exported_count,
                "skippedInputCount": report.skipped_input_count,
                "exportErrorCount": report.skipped_input_count,
                "skippedIgnoredCount": report.skipped_ignored_count,
                "duplicateOidCount": report.skipped_duplicate_count,
                "skippedSchemaCount": report.skipped_schema_count,
            },
            "warnings": report.warnings,
        },
        commands=[],
        errors=[],
    )


if __name__ == "__main__":
    raise SystemExit(main())
