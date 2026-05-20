#!/usr/bin/env python3
import unittest

from lib.diagram.linked_page_sync import (
    build_linked_page_sync_commands,
    needs_linked_page_sync,
    page_title_from_data,
)


class LinkedPageSyncTests(unittest.TestCase):
    def test_page_title_prefers_title(self) -> None:
        self.assertEqual(page_title_from_data({"title": " DC-1 ", "label": "x"}), "DC-1")

    def test_needs_sync_when_title_changes(self) -> None:
        before = {"title": "Old", "label": "Old"}
        after = {"title": "New", "label": "New"}
        self.assertTrue(
            needs_linked_page_sync(
                "seaf.company.ta.services.dcs",
                before,
                after,
                "page-1",
            )
        )

    def test_skips_without_linked_page(self) -> None:
        before = {"title": "Old", "label": "Old"}
        after = {"title": "New", "label": "New"}
        self.assertFalse(needs_linked_page_sync("seaf.company.ta.services.dcs", before, after, ""))

    def test_build_commands_rename_and_link(self) -> None:
        pages = [{"id": "page-1", "name": "Old"}]
        before = {"title": "Old", "label": "Old"}
        after = {"title": "New DC", "label": "New DC"}
        cmds = build_linked_page_sync_commands(
            schema="seaf.company.ta.services.dcs",
            data_before=before,
            data_after=after,
            object_id="cell-1",
            linked_page_id="page-1",
            pages=pages,
        )
        self.assertEqual(len(cmds), 2)
        self.assertEqual(cmds[0]["name"], "renameLinkedPage")
        self.assertEqual(cmds[0]["args"]["targetPageId"], "page-1")
        self.assertEqual(cmds[0]["args"]["title"], "New DC")
        self.assertEqual(cmds[1]["name"], "setCellLinkToPage")

    def test_dedupe_same_target_in_batch(self) -> None:
        pages = [{"id": "page-1", "name": "Old"}]
        seen: set = set()
        before = {"title": "Old", "label": "Old"}
        after = {"title": "Same", "label": "Same"}
        first = build_linked_page_sync_commands(
            schema="seaf.company.ta.services.dcs",
            data_before=before,
            data_after=after,
            object_id="cell-1",
            linked_page_id="page-1",
            pages=pages,
            seen_keys=seen,
        )
        second = build_linked_page_sync_commands(
            schema="seaf.company.ta.services.dcs",
            data_before=before,
            data_after=after,
            object_id="cell-2",
            linked_page_id="page-1",
            pages=pages,
            seen_keys=seen,
        )
        self.assertEqual(len(first), 2)
        self.assertEqual(len(second), 0)

    def test_no_show_message_command_emitted(self) -> None:
        pages = [{"id": "page-1", "name": "Old"}]
        cmds = build_linked_page_sync_commands(
            schema="seaf.company.ta.services.dcs",
            data_before={"title": "Old", "label": "Old"},
            data_after={"title": "New", "label": "New"},
            object_id="cell-1",
            linked_page_id="page-1",
            pages=pages,
        )
        self.assertFalse(any(cmd.get("name") == "showMessage" for cmd in cmds))


if __name__ == "__main__":
    unittest.main()
