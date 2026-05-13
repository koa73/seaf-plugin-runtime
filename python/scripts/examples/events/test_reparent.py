#!/usr/bin/env python3
"""Unit tests for stencil reparent handler (log only, no commands)."""

import unittest
from unittest.mock import MagicMock, patch

from events.reparent import main


class ReparentHandlerTests(unittest.TestCase):
    @patch("events.reparent.write_response")
    @patch("events.reparent.read_request")
    @patch("events.reparent.build_script_logger")
    def test_main_logs_raw_event_and_empty_commands(self, mock_logger_factory, mock_read, mock_write):
        ev = {
            "eventType": "reparent",
            "page": {"id": "p1"},
            "items": [{"objectId": "a", "currentLayerName": "Офис"}],
        }
        mock_read.return_value = {"payload": {"env": {"pluginLogLevel": "info"}, "event": ev}}
        log = MagicMock()
        mock_logger_factory.return_value = log
        mock_write.return_value = 0
        main()
        log.info.assert_called_once()
        arg = log.info.call_args[0][0]
        self.assertTrue(arg.get("reparentScriptFired"))
        self.assertEqual(arg.get("event"), ev)
        kw = mock_write.call_args.kwargs
        self.assertEqual(kw.get("commands"), [])
        self.assertEqual(kw.get("status"), "success")
        self.assertEqual((kw.get("payload") or {}).get("count"), 1)

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
