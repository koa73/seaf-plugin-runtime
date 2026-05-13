#!/usr/bin/env python3
"""Unit tests for stencil reparent handler (layer only, no OID)."""

import unittest
from unittest.mock import patch

from events.reparent import build_commands


class ReparentHandlerTests(unittest.TestCase):
    @patch("lib.events.layer_routing.load_stencil_layer_config")
    def test_reparent_emits_move_only_no_oid_bulk(self, mocked_load_config):
        mocked_load_config.return_value = {"schemas": {"seaf.company.ta.services.dc_offices": {"layer": "Офис"}}}
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
                    }
                ],
            },
        }
        commands = build_commands(payload, lambda _r: None)
        names = [c.get("name") for c in commands]
        self.assertIn("moveObjectsToLayer", names)
        self.assertNotIn("updateStencilDataBulk", names)
        move = next(c for c in commands if c.get("name") == "moveObjectsToLayer")
        self.assertTrue(move["args"].get("suppressStencilEvents"))

    @patch("lib.events.layer_routing.load_stencil_layer_config")
    def test_reparent_skips_move_when_already_on_layer(self, mocked_load_config):
        mocked_load_config.return_value = {"schemas": {"seaf.company.ta.services.dc_offices": {"layer": "Офис"}}}
        payload = {
            "arguments": {"companyPrefix": "corp"},
            "event": {
                "eventType": "reparent",
                "page": {"id": "p1"},
                "items": [
                    {
                        "objectId": "x1",
                        "schema": "seaf.company.ta.services.dc_offices",
                        "data": {"OID": "corp.services.dc_offices.5"},
                        "currentLayerName": "Офис",
                    }
                ],
            },
        }
        commands = build_commands(payload, lambda _r: None)
        self.assertEqual(commands, [])


if __name__ == "__main__":
    unittest.main()
