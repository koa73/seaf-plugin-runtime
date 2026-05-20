#!/usr/bin/env python3
import unittest

from events.data_mirror import build_commands
from lib.events import sanitize_patch_data


class DataMirrorTests(unittest.TestCase):
    def test_sanitize_patch_removes_locked_fields(self):
        patch = sanitize_patch_data({"OID": "x", "schema": "s", "title": "A", "address": "B"})
        self.assertEqual(patch, {"title": "A", "address": "B"})

    def test_build_commands_creates_atomic_command_for_target_schema(self):
        payload = {
            "event": {
                "items": [
                    {
                        "id": "obj-1",
                        "objectId": "obj-1",
                        "schema": "seaf.company.ta.services.dcs",
                        "dataBefore": {"OID": "x72ab", "schema": "seaf.company.ta.services.dcs", "title": "old"},
                        "dataAfter": {"OID": "x72ab", "schema": "seaf.company.ta.services.dcs", "title": "new"},
                    }
                ]
            }
        }
        commands = build_commands(payload, lambda _row: None)
        self.assertEqual(len(commands), 1)
        cmd = commands[0]
        self.assertEqual(cmd["name"], "mirrorDataByOidAtomic")
        self.assertEqual(cmd["args"]["schema"], "seaf.company.ta.services.dcs")
        self.assertEqual(cmd["args"]["oid"], "x72ab")
        self.assertEqual(cmd["args"]["patch"], {"title": "new", "label": "new"})
        self.assertTrue(cmd["args"]["suppressStencilEvents"])

    def test_build_commands_skips_non_target_schema(self):
        payload = {
            "event": {
                "items": [
                    {
                        "id": "obj-1",
                        "objectId": "obj-1",
                        "schema": "seaf.company.ta.services.dc_azs",
                        "dataAfter": {"OID": "x72ab", "title": "new"},
                    }
                ]
            }
        }
        commands = build_commands(payload, lambda _row: None)
        self.assertEqual(commands, [])

    def test_build_commands_skips_when_patch_only_locked_fields(self):
        payload = {
            "event": {
                "items": [
                    {
                        "id": "obj-1",
                        "objectId": "obj-1",
                        "schema": "seaf.company.ta.services.dc_offices",
                        "dataAfter": {"OID": "x72ab", "schema": "seaf.company.ta.services.dc_offices"},
                    }
                ]
            }
        }
        commands = build_commands(payload, lambda _row: None)
        self.assertEqual(commands, [])

    def test_build_commands_syncs_label_into_patch_when_only_label_changes(self) -> None:
        payload = {
            "event": {
                "items": [
                    {
                        "id": "obj-1",
                        "objectId": "obj-1",
                        "schema": "seaf.company.ta.services.dcs",
                        "dataBefore": {"OID": "x72ab", "schema": "seaf.company.ta.services.dcs", "title": "T", "label": "T"},
                        "dataAfter": {"OID": "x72ab", "schema": "seaf.company.ta.services.dcs", "title": "T", "label": "L2"},
                    }
                ]
            }
        }
        commands = build_commands(payload, lambda _row: None)
        self.assertEqual(len(commands), 1)
        self.assertEqual(commands[0]["args"]["patch"], {"title": "L2", "label": "L2"})


if __name__ == "__main__":
    unittest.main()
