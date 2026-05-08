#!/usr/bin/env python3
"""Create draw.io page from stencil title and link source object to it."""

from __future__ import annotations

from lib.diagram.link_service import build_create_page_command, build_link_to_page_command
from lib.diagram.page_service import find_page_by_name, list_pages, normalize_page_name
from lib.diagram.stencil_service import (
    extract_object_id,
    extract_stencil_title,
    get_context_object,
    get_primary_selection,
)
from lib.io import get_payload, read_request, write_response


def main() -> int:
    request = read_request()
    payload = get_payload(request)
    context_object = get_context_object(payload)
    selection_item = get_primary_selection(payload)
    object_id = extract_object_id(context_object) or extract_object_id(selection_item)
    title = normalize_page_name(extract_stencil_title(context_object) or extract_stencil_title(selection_item))

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
    return write_response(
        status="success",
        message=f"Страница '{title}' создана и ссылка установлена",
        payload={"objectId": object_id, "pageName": title},
        commands=commands,
        errors=[],
    )


if __name__ == "__main__":
    raise SystemExit(main())

