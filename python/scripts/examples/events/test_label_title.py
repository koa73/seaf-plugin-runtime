#!/usr/bin/env python3
import unittest

from events.label_title import build_commands


class LabelTitleHandlerTests(unittest.TestCase):
    def test_emits_bulk_with_suppress_when_label_needs_sync(self) -> None:
        payload = {
            "event": {
                "page": {"id": "page-1"},
                "items": [
                    {
                        "objectId": "obj-1",
                        "schema": "seaf.company.ta.services.dc_azs",
                        "dataBefore": {"title": "a", "label": "a"},
                        "dataAfter": {"title": "b", "label": "a"},
                    }
                ],
            }
        }
        commands = build_commands(payload, lambda _r: None, None)
        self.assertEqual(len(commands), 1)
        cmd = commands[0]
        self.assertEqual(cmd["name"], "updateStencilDataBulk")
        self.assertTrue(cmd["args"].get("suppressStencilEvents"))
        self.assertEqual(cmd["args"]["pageId"], "page-1")
        updates = cmd["args"]["updates"]
        self.assertEqual(len(updates), 1)
        self.assertEqual(updates[0]["objectId"], "obj-1")
        self.assertEqual(updates[0]["mode"], "merge")
        self.assertEqual(updates[0]["data"], {"label": "b"})

    def test_no_commands_when_no_page_id(self) -> None:
        payload = {"event": {"items": []}}
        commands = build_commands(payload, lambda _r: None, None)
        self.assertEqual(commands, [])

    def test_no_commands_when_already_aligned(self) -> None:
        payload = {
            "event": {
                "page": {"id": "p"},
                "items": [
                    {
                        "objectId": "o",
                        "schema": "seaf.company.ta.services.dc_azs",
                        "dataBefore": {"title": "x", "label": "x"},
                        "dataAfter": {"title": "x", "label": "x"},
                    }
                ],
            }
        }
        self.assertEqual(build_commands(payload, lambda _r: None, None), [])


if __name__ == "__main__":
    unittest.main()
