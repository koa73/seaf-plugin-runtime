"""Export run report aggregation and structured logging (INFO / DEBUG)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from lib.logging import ScriptLogger

HANDLER = "main_menu.export"


@dataclass
class ExportReport:
    """Aggregated export diagnostics for log output."""

    diagram_objects_total: int = 0
    eligible: List[Dict[str, Any]] = field(default_factory=list)
    skipped_input: List[Dict[str, Any]] = field(default_factory=list)
    skipped_ignored: List[Dict[str, Any]] = field(default_factory=list)
    skipped_duplicate: List[Dict[str, Any]] = field(default_factory=list)
    skipped_schema: List[Dict[str, Any]] = field(default_factory=list)
    unique_export_object_count: int = 0
    validation_errors: List[Dict[str, Any]] = field(default_factory=list)
    exported: List[Dict[str, Any]] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    written_files: List[str] = field(default_factory=list)
    schemas_exported: List[str] = field(default_factory=list)
    schemas_skipped: List[str] = field(default_factory=list)

    @property
    def eligible_count(self) -> int:
        return len(self.eligible)

    @property
    def exported_count(self) -> int:
        if self.unique_export_object_count > 0:
            return self.unique_export_object_count
        return len(self.exported)

    @property
    def skipped_input_count(self) -> int:
        return len(self.skipped_input)

    @property
    def skipped_ignored_count(self) -> int:
        return len(self.skipped_ignored)

    @property
    def skipped_duplicate_count(self) -> int:
        return len(self.skipped_duplicate)

    @property
    def skipped_schema_count(self) -> int:
        return len(self.skipped_schema)

    @property
    def validation_error_count(self) -> int:
        return len(self.validation_errors)


def _validation_summary(report: ExportReport) -> List[Dict[str, Any]]:
    """Compact per-schema OID error counts for INFO log."""
    buckets: Dict[str, Dict[str, int]] = {}
    for item in report.validation_errors:
        schema = str(item.get("schema") or "")
        oid = str(item.get("oid") or "")
        if schema not in buckets:
            buckets[schema] = {}
        buckets[schema][oid] = buckets[schema].get(oid, 0) + 1
    out: List[Dict[str, Any]] = []
    for schema in sorted(buckets.keys()):
        for oid, count in sorted(buckets[schema].items()):
            out.append({"schema": schema, "oid": oid, "errorCount": count})
    return out


def _mask_sensitive_attrs(attrs: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(attrs, dict):
        return {}
    masked: Dict[str, Any] = {}
    for key, value in attrs.items():
        key_s = str(key)
        if key_s == "auth_type" and value:
            masked[key_s] = "***"
        else:
            masked[key_s] = value
    return masked


def log_export_report(logger: ScriptLogger, report: ExportReport) -> None:
    """Write summary (INFO) and detail (DEBUG) export report to seaf-plugin.log."""
    summary: Dict[str, Any] = {
        "handler": HANDLER,
        "reportLevel": "summary",
        "diagramObjectsTotal": report.diagram_objects_total,
        "eligibleCount": report.eligible_count,
        "exportedCount": report.exported_count,
        "skippedInputCount": report.skipped_input_count,
        "exportErrorCount": report.skipped_input_count,
        "skippedIgnoredCount": report.skipped_ignored_count,
        "duplicateOidCount": report.skipped_duplicate_count,
        "skippedSchemaCount": report.skipped_schema_count,
        "validationErrorCount": report.validation_error_count,
        "schemasExported": list(report.schemas_exported),
        "schemasSkipped": list(report.schemas_skipped),
        "writtenFiles": list(report.written_files),
        "warnings": list(report.warnings),
    }
    if report.validation_error_count > 0:
        summary["validationSummary"] = _validation_summary(report)
    logger.info(summary)

    detail: Dict[str, Any] = {
        "handler": HANDLER,
        "reportLevel": "detail",
        "eligible": list(report.eligible),
        "exported": list(report.exported),
        "skippedInput": list(report.skipped_input),
        "skippedIgnored": list(report.skipped_ignored),
        "skippedDuplicate": list(report.skipped_duplicate),
        "skippedSchema": list(report.skipped_schema),
        "validationErrors": list(report.validation_errors),
    }
    if report.exported:
        detail["exportedAttrsSample"] = [
            {
                "schema": item.get("schema"),
                "oid": item.get("oid"),
                "attrs": _mask_sensitive_attrs(item.get("attrs")),
            }
            for item in report.exported[:50]
        ]
    logger.debug(detail)
