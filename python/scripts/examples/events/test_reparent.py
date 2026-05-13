#!/usr/bin/env python3
"""Unit tests for stencil reparent handler."""

import unittest
from unittest.mock import MagicMock, patch

from events.reparent import main


class ReparentHandlerTests(unittest.TestCase):
    @patch("events.reparent.build_layer_commands_for_items")
    @patch("events.reparent.write_response")
    @patch("events.reparent.read_request")
    @patch("events.reparent.build_script_logger")
    def test_main_logs_raw_event_and_builds_layer_commands(
        self,
        mock_logger_factory,
        mock_read,
        mock_write,
        mock_build_layers,
    ):
        ev = {
            "eventType": "reparent",
            "page": {"id": "p1"},
            "items": [{"objectId": "a", "currentLayerName": "Офис"}],
        }
        mock_read.return_value = {"payload": {"env": {"pluginLogLevel": "info"}, "event": ev}}
        log = MagicMock()
        mock_logger_factory.return_value = log
        mock_build_layers.return_value = [
            {"name": "moveObjectsToLayer", "args": {"pageId": "p1", "layerName": "Офисы", "objectIds": ["a"]}}
        ]
        mock_write.return_value = 0
        main()
        log.info.assert_called_once()
        arg = log.info.call_args[0][0]
        self.assertTrue(arg.get("reparentScriptFired"))
        self.assertEqual(arg.get("event"), ev)
        kw = mock_write.call_args.kwargs
        self.assertEqual(len(kw.get("commands") or []), 1)
        self.assertEqual(kw.get("status"), "success")
        self.assertEqual((kw.get("payload") or {}).get("count"), 1)
        self.assertEqual((kw.get("payload") or {}).get("layerCommandsCount"), 1)
        self.assertEqual(kw.get("message"), "reparent processed")
        mock_build_layers.assert_called_once()
        args, kwargs = mock_build_layers.call_args
        self.assertEqual(args[0], "p1")
        self.assertEqual(args[1], ev["items"])
        self.assertEqual(args[3], "reparent")
        self.assertTrue(kwargs.get("force_reassign_layer"))

    @patch("events.reparent.build_layer_commands_for_items")
    @patch("events.reparent.write_response")
    @patch("events.reparent.read_request")
    @patch("events.reparent.build_script_logger")
    def test_main_forces_layer_reassign_even_when_current_layer_matches_target(
        self,
        mock_logger_factory,
        mock_read,
        mock_write,
        mock_build_layers,
    ):
        ev = {
            "eventType": "reparent",
            "page": {"id": "p1"},
            "items": [{"objectId": "a", "schema": "seaf.company.ta.services.dc_offices", "currentLayerName": "Офисы"}],
        }
        mock_read.return_value = {"payload": {"event": ev}}
        log = MagicMock()
        mock_logger_factory.return_value = log
        mock_build_layers.return_value = [
            {"name": "moveObjectsToLayer", "args": {"pageId": "p1", "layerName": "Офисы", "objectIds": ["a"]}}
        ]
        mock_write.return_value = 0
        main()
        args, kwargs = mock_build_layers.call_args
        self.assertEqual(args[3], "reparent")
        self.assertTrue(kwargs.get("force_reassign_layer"))
        self.assertEqual((mock_write.call_args.kwargs.get("commands") or [])[0]["name"], "moveObjectsToLayer")

    @patch("events.reparent.write_response")
    @patch("events.reparent.read_request")
    @patch("events.reparent.build_script_logger")
    def test_main_empty_event_still_success(self, mock_logger_factory, mock_read, mock_write):
        mock_read.return_value = {"payload": {"event": {}}}
        log = MagicMock()
        mock_logger_factory.return_value = log
        mock_write.return_value = 0
        main()
        log.info.assert_called_once()
        self.assertEqual(log.info.call_args[0][0].get("event"), {})
        self.assertEqual(mock_write.call_args.kwargs.get("payload", {}).get("count"), 0)


if __name__ == "__main__":
    unittest.main()
