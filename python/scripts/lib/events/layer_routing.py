"""Shared layer-routing helpers for event and context handlers."""

from __future__ import annotations

from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from lib.config import load_stencil_layer_config, resolve_layer_name
from .all_add_helpers import build_move_objects_to_layer_command


def _item_current_layer_name(item: Dict[str, Any]) -> str:
    """Layer display name from event item (set by renderer); empty if unknown."""
    if not isinstance(item, dict):
        return ""
    return str(item.get("currentLayerName") or "").strip()


def build_layer_commands_for_items(
    page_id: Any,
    items: Iterable[Dict[str, Any]],
    log_info: Callable[[Dict[str, Any]], None],
    handler: str,
    force_reassign_layer: bool = False,
) -> List[Dict[str, Any]]:
    """Build move-to-layer commands by grouping object ids per resolved layer."""
    layer_config = load_stencil_layer_config()
    grouped: Dict[str, List[str]] = {}
    for item in items:
        object_id = str(item.get("objectId") or item.get("id") or "").strip()
        if not object_id:
            continue
        schema = str(item.get("schema") or "").strip()
        if not schema:
            data = item.get("data") or {}
            if isinstance(data, dict):
                schema = str(data.get("schema") or "").strip()
        if not schema:
            log_info({"handler": handler, "action": "layer_skip_schema_missing", "objectId": object_id})
            continue
        layer_name, has_multiple = resolve_layer_name(schema, layer_config)
        if has_multiple:
            log_info(
                {
                    "handler": handler,
                    "action": "layer_config_multiple_values",
                    "schema": schema,
                    "selectedLayer": layer_name,
                }
            )
        if not layer_name:
            log_info(
                {
                    "handler": handler,
                    "action": "layer_skip_missing_mapping",
                    "schema": schema,
                    "objectId": object_id,
                }
            )
            continue
        current = _item_current_layer_name(item)
        if (not force_reassign_layer) and current and current == layer_name:
            log_info(
                {
                    "handler": handler,
                    "action": "layer_skip_already_on_layer",
                    "objectId": object_id,
                    "schema": schema,
                    "layerName": layer_name,
                }
            )
            continue
        if force_reassign_layer and current and current == layer_name:
            log_info(
                {
                    "handler": handler,
                    "action": "layer_reassign_forced",
                    "objectId": object_id,
                    "schema": schema,
                    "layerName": layer_name,
                }
            )
        grouped.setdefault(layer_name, []).append(object_id)

    suppress_move_events = handler == "reparent"
    commands: List[Dict[str, Any]] = []
    for layer_name, object_ids in grouped.items():
        if not object_ids:
            continue
        commands.append(
            build_move_objects_to_layer_command(
                page_id,
                layer_name,
                object_ids,
                suppress_stencil_events=suppress_move_events,
                target_mode="schemaCell",
            )
        )
    return commands


def resolve_layer_for_schema(schema: str) -> Tuple[Optional[str], bool]:
    """Resolve a single layer name for schema from runtime stencil config."""
    key = str(schema or "").strip()
    if not key:
        return (None, False)
    layer_name, has_multiple = resolve_layer_name(key, load_stencil_layer_config())
    return (layer_name, has_multiple)

