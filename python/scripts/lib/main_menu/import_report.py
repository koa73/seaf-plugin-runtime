"""Import run report aggregation and structured logging (INFO / DEBUG)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List

from lib.logging import ScriptLogger

HANDLER = "main_menu.import"


@dataclass
class ImportReport:
    """Aggregated diagnostics for import pipeline."""

    files_discovered: List[str] = field(default_factory=list)
    files_read: List[str] = field(default_factory=list)
    loaded: List[Dict[str, Any]] = field(default_factory=list)
    matched: List[Dict[str, Any]] = field(default_factory=list)
    updates: List[Dict[str, Any]] = field(default_factory=list)
    unmatched_in_diagram: Dict[str, List[str]] = field(default_factory=dict)
    skipped_duplicate: List[Dict[str, Any]] = field(default_factory=list)
    skipped_schema: List[Dict[str, Any]] = field(default_factory=list)
    files_invalid: List[Dict[str, Any]] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    ui_result: Dict[str, Any] = field(default_factory=dict)
    title_label_synced: List[Dict[str, Any]] = field(default_factory=list)
    linked_page_synced: List[Dict[str, Any]] = field(default_factory=list)

    @property
    def loaded_from_files_count(self) -> int:
        return len(self.files_read)

    @property
    def loaded_object_count(self) -> int:
        return len(self.loaded)

    @property
    def matched_on_diagram_count(self) -> int:
        return len(self.updates)

    @property
    def updated_count(self) -> int:
        unique_updated = self.ui_result.get("uniqueOidUpdated")
        if isinstance(unique_updated, int):
            return unique_updated
        return len(self.updates)


def _sample(items: List[Dict[str, Any]], limit: int = 50) -> List[Dict[str, Any]]:
    if len(items) <= limit:
        return list(items)
    return list(items[:limit])


def log_import_report(logger: ScriptLogger, report: ImportReport) -> None:
    """Write summary (INFO) and detail (DEBUG) report."""
    summary: Dict[str, Any] = {
        "handler": HANDLER,
        "reportLevel": "summary",
        "loadedFromFilesCount": report.loaded_from_files_count,
        "loadedObjectCount": report.loaded_object_count,
        "matchedOnDiagramCount": report.matched_on_diagram_count,
        "updatedCount": report.updated_count,
        "preparedUpdateCount": len(report.updates),
        "unmatchedInDiagram": report.unmatched_in_diagram,
        "invalidFileCount": len(report.files_invalid),
        "skippedSchemaCount": len(report.skipped_schema),
        "duplicateOidCount": len(report.skipped_duplicate),
        "titleLabelSyncCount": len(report.title_label_synced),
        "linkedPageSyncCount": len(report.linked_page_synced),
        "warnings": list(report.warnings),
        "errors": list(report.errors),
    }
    logger.info(summary)

    detail = {
        "handler": HANDLER,
        "reportLevel": "detail",
        "filesDiscoveredCount": len(report.files_discovered),
        "filesReadCount": len(report.files_read),
        "filesInvalidCount": len(report.files_invalid),
        "loadedCount": len(report.loaded),
        "matchedCount": len(report.matched),
        "updatesCount": len(report.updates),
        "unmatchedInDiagram": report.unmatched_in_diagram,
        "skippedDuplicateCount": len(report.skipped_duplicate),
        "skippedSchemaCount": len(report.skipped_schema),
        "filesInvalidSample": _sample(report.files_invalid, 20),
        "loadedSample": _sample(report.loaded, 50),
        "updatesSample": _sample(report.updates, 50),
        "skippedDuplicateSample": _sample(report.skipped_duplicate, 20),
        "skippedSchemaSample": _sample(report.skipped_schema, 20),
        "titleLabelSyncCount": len(report.title_label_synced),
        "titleLabelSyncSample": _sample(report.title_label_synced, 20),
        "linkedPageSyncCount": len(report.linked_page_synced),
        "linkedPageSyncSample": _sample(report.linked_page_synced, 20),
        "uiResult": dict(report.ui_result),
    }
    logger.debug(detail)

