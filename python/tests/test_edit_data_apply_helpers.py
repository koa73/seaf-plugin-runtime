#!/usr/bin/env python3
"""Unit tests for bulk Edit Data apply helpers."""

from __future__ import annotations

import unittest

from lib.main_menu.edit_data_helpers import build_edit_data_apply_commands


class EditDataApplyHelpersTest(unittest.TestCase):
    def test_build_commands_skips_locked_keys_in_patch(self) -> None:
        schema = "seaf.company.ta.services.dc_azs"
        schema_objects = [
            {
                "pageId": "p1",
                "pageName": "Page1",
                "objectId": "cell-1",
                "schema": schema,
                "oid": "OID-1",
                "data": {"OID": "OID-1", "schema": schema, "title": "Old"},
                "linkedPageId": "",
            }
        ]
        edited_rows = [
            {
                "objectId": "cell-1",
                "schema": schema,
                "oid": "OID-1",
                "data": {
                    "OID": "OID-HACK",
                    "schema": "other.schema",
                    "title": "New",
                },
            }
        ]
        commands, stats = build_edit_data_apply_commands(
            schema, edited_rows, schema_objects, pages=[{"id": "p1", "name": "Page1"}]
        )
        self.assertEqual(stats["rowsPrepared"], 1)
        self.assertGreaterEqual(len(commands), 1)
        bulk = commands[0]
        self.assertEqual(bulk["name"], "updateStencilDataBulk")
        updates = bulk["args"]["updates"]
        self.assertEqual(len(updates), 1)
        patch = updates[0]["data"]
        self.assertEqual(patch.get("title"), "New")
        self.assertNotIn("OID", patch)
        self.assertNotIn("schema", patch)


if __name__ == "__main__":
    unittest.main()
