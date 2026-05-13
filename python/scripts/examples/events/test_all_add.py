#!/usr/bin/env python3
import unittest
from unittest.mock import patch

from events.all_add import build_commands, create_oid
from lib.config import resolve_layer_name
from lib.oid import build_oid_updates_for_empty_oid_items, collect_import_conflicts, next_oid, schema_code


class AllAddOidTests(unittest.TestCase):
    def test_schema_code_extracts_last_two_segments(self):
        self.assertEqual(schema_code("seaf.company.ta.services.dc_azs"), "services.dc_azs")

    def test_schema_code_fallback_unknown(self):
        self.assertEqual(schema_code(""), "unknown")
        self.assertEqual(schema_code("seaf"), "unknown")

    def test_next_oid_uses_max_sequence(self):
        known = {
            "corp.services.dc_azs.1": {"objectIds": ["a"]},
            "corp.services.dc_azs.7": {"objectIds": ["b"]},
            "corp.services.other.12": {"objectIds": ["c"]},
        }
        reserved = {}
        oid = next_oid("corp", "seaf.company.ta.services.dc_azs", known, reserved)
        self.assertEqual(oid, "corp.services.dc_azs.8")

    def test_collect_import_conflicts_reports_existing_oid(self):
        items = [
            {
                "id": "new-1",
                "objectId": "new-1",
                "schema": "seaf.company.ta.services.dc_azs",
                "data": {"OID": "corp.services.dc_azs.3"},
            }
        ]
        known = {"corp.services.dc_azs.3": {"objectIds": ["old-1"]}}
        conflicts = collect_import_conflicts(items, known)
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0]["cellId"], "new-1")
        self.assertEqual(conflicts[0]["conflictWithCellId"], "old-1")

    def test_create_oid_skips_assignment_when_oid_nonempty(self):
        """Reparent / synthetic second `add` must not bump OID."""
        payload = {
            "arguments": {"companyPrefix": "corp"},
            "event": {
                "page": {"id": "p1"},
                "index": {"byOid": {}, "objectPage": {}},
                "items": [
                    {
                        "id": "x1",
                        "objectId": "x1",
                        "schema": "seaf.company.ta.services.dc_azs",
                        "data": {"OID": "corp.services.dc_azs.1", "schema": "seaf.company.ta.services.dc_azs"},
                    }
                ],
            },
        }
        cmds, updates = create_oid(payload, lambda _r: None)
        self.assertEqual(updates, [])
        self.assertEqual(cmds, [])

    def test_build_oid_updates_for_empty_oid_assigns_when_oid_key_missing(self):
        updates, assigned = build_oid_updates_for_empty_oid_items(
            [
                {
                    "objectId": "n2",
                    "schema": "seaf.company.ta.services.dc_azs",
                    "data": {},
                }
            ],
            "corp",
            {},
        )
        self.assertEqual(len(assigned), 1)
        self.assertEqual(assigned[0]["OID"], "corp.services.dc_azs.1")
        self.assertEqual(len(updates), 1)

    def test_orchestrator_builds_bulk_command(self):
        payload = {
            "arguments": {"companyPrefix": "corp"},
            "event": {
                "page": {"id": "p1"},
                "index": {"byOid": {"corp.services.dc_azs.2": {"objectIds": ["old"]}}},
                "items": [
                    {"id": "n1", "objectId": "n1", "schema": "seaf.company.ta.services.dc_azs", "data": {}}
                ],
            },
        }
        commands = build_commands(payload)
        command_names = [c.get("name") for c in commands]
        self.assertIn("updateStencilDataBulk", command_names)
        self.assertIn("moveObjectsToLayer", command_names)

    def test_all_add_build_commands_empty_when_event_type_is_reparent(self):
        payload = {
            "arguments": {"companyPrefix": "corp"},
            "event": {
                "eventType": "reparent",
                "page": {"id": "p1"},
                "index": {"byOid": {}},
                "items": [
                    {
                        "objectId": "x1",
                        "schema": "seaf.company.ta.services.dc_azs",
                        "data": {"OID": ""},
                    }
                ],
            },
        }
        commands = build_commands(payload)
        self.assertEqual(commands, [])

    @patch("lib.events.layer_routing.load_stencil_layer_config")
    def test_orchestrator_uses_layer_from_config(self, mocked_load_config):
        mocked_load_config.return_value = {"schemas": {"seaf.company.ta.services.dc_azs": {"layer": "Layer A"}}}
        payload = {
            "arguments": {"companyPrefix": "corp"},
            "event": {
                "page": {"id": "p1"},
                "index": {"byOid": {}},
                "items": [
                    {
                        "id": "n1",
                        "objectId": "n1",
                        "schema": "seaf.company.ta.services.dc_azs",
                        "data": {},
                    }
                ],
            },
        }
        commands = build_commands(payload)
        move = next((c for c in commands if c.get("name") == "moveObjectsToLayer"), None)
        self.assertIsNotNone(move)
        self.assertEqual(move["args"]["layerName"], "Layer A")
        self.assertEqual(move["args"].get("targetMode"), "schemaCell")

    @patch("lib.events.layer_routing.load_stencil_layer_config")
    def test_orchestrator_skips_move_when_current_layer_matches_target(self, mocked_load_config):
        mocked_load_config.return_value = {"schemas": {"seaf.company.ta.services.dc_azs": {"layer": "Layer A"}}}
        payload = {
            "arguments": {"companyPrefix": "corp"},
            "event": {
                "page": {"id": "p1"},
                "index": {"byOid": {}},
                "items": [
                    {
                        "id": "n1",
                        "objectId": "n1",
                        "schema": "seaf.company.ta.services.dc_azs",
                        "data": {},
                        "currentLayerName": "Layer A",
                    }
                ],
            },
        }
        commands = build_commands(payload)
        self.assertNotIn("moveObjectsToLayer", [c.get("name") for c in commands])

    @patch("lib.events.layer_routing.load_stencil_layer_config")
    def test_orchestrator_move_only_objects_not_yet_on_target_layer(self, mocked_load_config):
        mocked_load_config.return_value = {"schemas": {"seaf.company.ta.services.dc_azs": {"layer": "Layer A"}}}
        payload = {
            "arguments": {"companyPrefix": "corp"},
            "event": {
                "page": {"id": "p1"},
                "index": {"byOid": {}},
                "items": [
                    {
                        "id": "on",
                        "objectId": "on",
                        "schema": "seaf.company.ta.services.dc_azs",
                        "data": {},
                        "currentLayerName": "Layer A",
                    },
                    {
                        "id": "off",
                        "objectId": "off",
                        "schema": "seaf.company.ta.services.dc_azs",
                        "data": {},
                        "currentLayerName": "Default",
                    },
                ],
            },
        }
        commands = build_commands(payload)
        move = next((c for c in commands if c.get("name") == "moveObjectsToLayer"), None)
        self.assertIsNotNone(move)
        self.assertEqual(move["args"]["objectIds"], ["off"])
        self.assertEqual(move["args"].get("targetMode"), "schemaCell")

    @patch("lib.events.layer_routing.load_stencil_layer_config")
    def test_orchestrator_skips_layer_when_config_value_empty(self, mocked_load_config):
        mocked_load_config.return_value = {"schemas": {"seaf.company.ta.services.dc_azs": {"layer": ""}}}
        payload = {
            "arguments": {"companyPrefix": "corp"},
            "event": {
                "page": {"id": "p1"},
                "index": {"byOid": {}},
                "items": [
                    {
                        "id": "n1",
                        "objectId": "n1",
                        "schema": "seaf.company.ta.services.dc_azs",
                        "data": {},
                    }
                ],
            },
        }
        commands = build_commands(payload)
        command_names = [c.get("name") for c in commands]
        self.assertNotIn("moveObjectsToLayer", command_names)

    @patch("lib.events.layer_routing.load_stencil_layer_config")
    def test_orchestrator_uses_first_non_empty_from_layer_list(self, mocked_load_config):
        mocked_load_config.return_value = {"schemas": {"seaf.company.ta.services.dc_azs": {"layer": ["", "Layer B", "Layer C"]}}}
        payload = {
            "arguments": {"companyPrefix": "corp"},
            "event": {
                "page": {"id": "p1"},
                "index": {"byOid": {}},
                "items": [
                    {
                        "id": "n1",
                        "objectId": "n1",
                        "schema": "seaf.company.ta.services.dc_azs",
                        "data": {},
                    }
                ],
            },
        }
        commands = build_commands(payload)
        move = next((c for c in commands if c.get("name") == "moveObjectsToLayer"), None)
        self.assertIsNotNone(move)
        self.assertEqual(move["args"]["layerName"], "Layer B")
        self.assertEqual(move["args"].get("targetMode"), "schemaCell")

    @patch("lib.events.layer_routing.load_stencil_layer_config")
    def test_orchestrator_skips_layer_when_schema_absent_in_config(self, mocked_load_config):
        mocked_load_config.return_value = {"schemas": {"other.schema": {"layer": "Layer Z"}}}
        payload = {
            "arguments": {"companyPrefix": "corp"},
            "event": {
                "page": {"id": "p1"},
                "index": {"byOid": {}},
                "items": [
                    {
                        "id": "n1",
                        "objectId": "n1",
                        "schema": "seaf.company.ta.services.dc_azs",
                        "data": {},
                    }
                ],
            },
        }
        commands = build_commands(payload)
        command_names = [c.get("name") for c in commands]
        self.assertNotIn("moveObjectsToLayer", command_names)

    @patch("lib.events.layer_routing.load_stencil_layer_config")
    def test_orchestrator_skips_layer_when_item_schema_missing(self, mocked_load_config):
        mocked_load_config.return_value = {"schemas": {"seaf.company.ta.services.dc_azs": {"layer": "Layer A"}}}
        payload = {
            "arguments": {"companyPrefix": "corp"},
            "event": {
                "page": {"id": "p1"},
                "index": {"byOid": {}},
                "items": [
                    {
                        "id": "n1",
                        "objectId": "n1",
                        "data": {},
                    }
                ],
            },
        }
        commands = build_commands(payload)
        command_names = [c.get("name") for c in commands]
        self.assertNotIn("moveObjectsToLayer", command_names)

    def test_resolve_layer_name_from_scalar_value(self):
        config = {"schemas": {"schema.a": {"layer": "Layer A"}}}
        layer, has_multiple = resolve_layer_name("schema.a", config)
        self.assertEqual(layer, "Layer A")
        self.assertFalse(has_multiple)

    def test_resolve_layer_name_from_list_value(self):
        config = {"schemas": {"schema.a": {"layer": ["", "Layer A", "Layer B"]}}}
        layer, has_multiple = resolve_layer_name("schema.a", config)
        self.assertEqual(layer, "Layer A")
        self.assertTrue(has_multiple)


if __name__ == "__main__":
    unittest.main()
