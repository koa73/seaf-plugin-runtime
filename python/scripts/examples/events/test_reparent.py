#!/usr/bin/env python3
"""Unit tests for stencil reparent handler (layer tree only, no OID)."""

import unittest
from unittest.mock import patch

from events.reparent import build_commands


class ReparentHandlerTests(unittest.TestCase):
    @patch("lib.events.layer_routing.load_stencil_layer_config")
    def test_reparent_emits_move_layer_under_layer_no_oid_bulk(self, mocked_load_config):
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
                        "targetParentLayerName": "AZS",
                    }
                ],
            },
        }
        commands = build_commands(payload, lambda _r: None)
        names = [c.get("name") for c in commands]
        self.assertIn("moveLayerUnderLayer", names)
        self.assertNotIn("moveObjectsToLayer", names)
        self.assertNotIn("updateStencilDataBulk", names)
        cmd = next(c for c in commands if c.get("name") == "moveLayerUnderLayer")
        self.assertTrue(cmd["args"].get("suppressStencilEvents"))
        self.assertEqual(cmd["args"].get("childLayerName"), "Офис")
        self.assertEqual(cmd["args"].get("parentLayerName"), "AZS")
        self.assertEqual(cmd["args"].get("pageId"), "p1")

    @patch("lib.events.layer_routing.load_stencil_layer_config")
    def test_reparent_skips_when_target_parent_missing(self, mocked_load_config):
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

    @patch("lib.events.layer_routing.load_stencil_layer_config")
    def test_reparent_dedupes_same_semantic_and_parent_pair(self, mocked_load_config):
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
                        "targetParentLayerName": "AZS",
                    },
                    {
                        "objectId": "x2",
                        "schema": "seaf.company.ta.services.dc_offices",
                        "targetParentLayerName": "AZS",
                    },
                ],
            },
        }
        commands = build_commands(payload, lambda _r: None)
        self.assertEqual(len(commands), 1)
        self.assertEqual(commands[0].get("name"), "moveLayerUnderLayer")


if __name__ == "__main__":
    unittest.main()
