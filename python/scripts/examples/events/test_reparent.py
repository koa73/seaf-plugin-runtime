#!/usr/bin/env python3
"""Unit tests for stencil reparent handler (no layer commands, no OID)."""

import unittest

from events.reparent import build_commands


class ReparentHandlerTests(unittest.TestCase):
    def test_reparent_emits_no_ui_layer_commands(self):
        payload = {
            "arguments": {"companyPrefix": "corp"},
            "event": {
                "eventType": "reparent",
                "page": {"id": "p1"},
                "items": [
                    {
                        "objectId": "x1",
                        "schema": "seaf.company.ta.services.dc_offices",
                        "data": {"OID": "corp.services.dc_offices.5", "schema": "seaf.company.ta.services.dc_offices"},
                        "currentLayerName": "Default",
                        "targetParentLayerName": "Зона доступности",
                    }
                ],
            },
        }
        commands = build_commands(payload, lambda _r: None)
        names = [c.get("name") for c in commands]
        self.assertEqual(names, [])
        self.assertNotIn("moveLayerUnderLayer", names)
        self.assertNotIn("moveObjectsToLayer", names)
        self.assertNotIn("updateStencilDataBulk", names)

    def test_reparent_empty_items_returns_empty_commands(self):
        payload = {
            "event": {"eventType": "reparent", "page": {"id": "p1"}, "items": []},
        }
        self.assertEqual(build_commands(payload, lambda _r: None), [])


if __name__ == "__main__":
    unittest.main()
