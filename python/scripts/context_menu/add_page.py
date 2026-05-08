#!/usr/bin/env python3
"""Create draw.io page from stencil title and link source object to it."""

from __future__ import annotations

from lib.config.stencil_mirror_library import resolve_mirror_schema_by_title
from lib.config.stencil_mirror import load_stencil_mirror_config, resolve_mirror_title
from lib.diagram.link_service import build_create_page_command, build_link_to_page_command
from lib.diagram.page_service import find_page_by_name, list_pages, normalize_page_name
from lib.diagram.stencil_service import (
    extract_object_id,
    extract_stencil_title,
    get_context_object,
    get_primary_selection,
)
from lib.events import resolve_company_prefix, resolve_layer_for_schema
from lib.io import get_payload, read_request, write_response


def main() -> int:
    request = read_request()
    payload = get_payload(request)
    context_object = get_context_object(payload)
    selection_item = get_primary_selection(payload)
    object_id = extract_object_id(context_object) or extract_object_id(selection_item)
    title = normalize_page_name(extract_stencil_title(context_object) or extract_stencil_title(selection_item))
    source_data = {}
    if isinstance(context_object, dict) and isinstance(context_object.get("data"), dict):
        source_data = dict(context_object.get("data"))
    elif isinstance(selection_item, dict) and isinstance(selection_item.get("data"), dict):
        source_data = dict(selection_item.get("data"))
    source_schema = str(source_data.get("schema") or "").strip()

    if not object_id:
        return write_response(
            status="error",
            message="Не удалось определить исходный стенсил для создания страницы",
            payload={},
            commands=[{"name": "showMessage", "args": {"level": "error", "text": "Источник команды не определен"}}],
            errors=["source_object_missing"],
            exit_code=0,
        )

    if not title:
        return write_response(
            status="error",
            message="Поле title пустое. Создание страницы отменено.",
            payload={"objectId": object_id},
            commands=[],
            errors=["title_is_empty"],
            exit_code=0,
        )

    pages = list_pages(payload)
    existing = find_page_by_name(pages, title)
    if existing is not None:
        return write_response(
            status="error",
            message=f"Страница '{title}' уже существует. Создание отменено.",
            payload={"objectId": object_id, "pageId": existing.get("id"), "pageName": title},
            commands=[],
            errors=["page_title_duplicate"],
            exit_code=0,
        )

    commands = [
        build_create_page_command(title=title, select_created=False),
        build_link_to_page_command(object_id=object_id, title=title),
    ]
    mirror_config = load_stencil_mirror_config()
    mirror_title = resolve_mirror_title(source_schema, mirror_config)
    if mirror_title:
        mirror_schema = resolve_mirror_schema_by_title(mirror_title)
        if not mirror_schema:
            return write_response(
                status="error",
                message=f"Не возможно добавить элемент {mirror_title} на страницу",
                payload={"objectId": object_id, "pageName": title, "mirrorTitle": mirror_title},
                commands=[],
                errors=["mirror_schema_not_found"],
                exit_code=0,
            )
        layer_name, _ = resolve_layer_for_schema(mirror_schema)
        if not layer_name:
            return write_response(
                status="error",
                message=f"Не возможно добавить элемент {mirror_title} на страницу",
                payload={
                    "objectId": object_id,
                    "pageName": title,
                    "mirrorTitle": mirror_title,
                    "mirrorSchema": mirror_schema,
                },
                commands=[],
                errors=["mirror_layer_not_found"],
                exit_code=0,
            )
        commands.extend(
            [
                {
                    "name": "insertStencilFromP41ByTitle",
                    "args": {
                        "pageIdFrom": "createPage",
                        "mirrorTitle": mirror_title,
                        "x": 200,
                        "y": 200,
                        "suppressStencilEvents": True,
                        "sourceObjectId": object_id,
                        "sourceSchema": source_schema,
                    },
                },
                {
                    "name": "updateStencilDataBulk",
                    "args": {
                        "pageIdFrom": "createPage",
                        "suppressStencilEvents": True,
                        "updates": [
                            {
                                "objectIdFrom": "insertStencilFromP41ByTitle",
                                "mode": "replace",
                                "data": source_data,
                            }
                        ],
                    },
                },
                {
                    "name": "moveObjectsToLayer",
                    "args": {
                        "pageIdFrom": "createPage",
                        "objectIdsFrom": "insertStencilFromP41ByTitle",
                        "suppressStencilEvents": True,
                        "layerName": layer_name,
                        "makeVisible": True,
                    },
                },
            ]
        )
    commands.append(
        {
            "name": "assignEmptyOidOnPage",
            "args": {
                "pageIdFrom": "createPage",
                "companyPrefix": resolve_company_prefix(payload),
                "suppressStencilEvents": True,
            },
        }
    )
    return write_response(
        status="success",
        message=f"Страница '{title}' создана и ссылка установлена",
        payload={"objectId": object_id, "pageName": title, "mirrorTitle": mirror_title or None},
        commands=commands,
        errors=[],
    )


if __name__ == "__main__":
    raise SystemExit(main())

