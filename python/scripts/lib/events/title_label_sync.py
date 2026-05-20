"""Align stencil `title` and `label` after modify (shared by data_mirror and wildcard handler)."""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional

from lib.config.stencil_layers import load_stencil_layer_config

_LOG_TRUNC = 120


def _norm_field(data: Dict[str, Any], key: str) -> str:
    raw = data.get(key) if isinstance(data, dict) else None
    if raw is None:
        return ""
    return str(raw).strip()


def _truncate(value: str, limit: int = _LOG_TRUNC) -> str:
    if len(value) <= limit:
        return value
    return value[: limit - 3] + "..."


def sync_title_label_enabled_for_schema(schema: str) -> bool:
    """Return False only when `sync_title_with_label: false` is set for this schema in stencils/config."""
    sch = str(schema or "").strip()
    if not sch.startswith("seaf.company.ta."):
        return False
    cfg = load_stencil_layer_config()
    entry = (cfg.get("schemas") or {}).get(sch) or {}
    raw = entry.get("sync_title_with_label")
    if raw is False:
        return False
    return True


def apply_title_label_sync(
    schema: str,
    data_before: Dict[str, Any],
    data_after: Dict[str, Any],
    *,
    log_debug: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> bool:
    """
    Mutate `data_after` so `title` and `label` stay in sync for one modify transaction.

    Policy when both fields change in the same transaction: **title wins** (label is set to the new title).

    Returns True if `data_after` was updated.
    """
    log = log_debug or (lambda _p: None)

    if not isinstance(data_after, dict):
        log(
            {
                "action": "title_label_sync_skip",
                "reason": "invalid_data_after",
                "schema": schema,
            }
        )
        return False

    if not sync_title_label_enabled_for_schema(schema):
        log(
            {
                "action": "title_label_sync_skip",
                "reason": "disabled_or_schema",
                "schema": schema,
            }
        )
        return False

    db = data_before if isinstance(data_before, dict) else {}
    tb, lb = _norm_field(db, "title"), _norm_field(db, "label")
    ta, la = _norm_field(data_after, "title"), _norm_field(data_after, "label")

    title_changed = ta != tb
    label_changed = la != lb

    if not title_changed and not label_changed:
        log(
            {
                "action": "title_label_sync_skip",
                "reason": "no_title_label_change",
                "schema": schema,
            }
        )
        return False

    if title_changed and not label_changed:
        source_field = "title"
        data_after["title"] = ta
        data_after["label"] = ta
    elif label_changed and not title_changed:
        source_field = "label"
        data_after["title"] = la
        data_after["label"] = la
    else:
        source_field = "both"
        data_after["title"] = ta
        data_after["label"] = ta

    patch_preview = {
        "title_len": len(str(data_after.get("title") or "")),
        "label_len": len(str(data_after.get("label") or "")),
    }
    rt = _norm_field(data_after, "title")
    rl = _norm_field(data_after, "label")
    log(
        {
            "action": "title_label_sync_apply",
            "schema": schema,
            "source_field": source_field,
            "title_before": _truncate(tb),
            "label_before": _truncate(lb),
            "txn_title": _truncate(ta),
            "txn_label": _truncate(la),
            "resolved_title": _truncate(rt),
            "resolved_label": _truncate(rl),
            "patch_preview": patch_preview,
        }
    )
    return True
