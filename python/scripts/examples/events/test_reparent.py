#!/usr/bin/env python3
"""Unit tests for stencil reparent handler (audit log only, no commands)."""

import unittest
from unittest.mock import MagicMock, patch

from events.reparent import build_reparent_audit_log_payload, main


class ReparentHandlerTests(unittest.TestCase):
    def test_build_reparent_audit_log_payload_includes_layer_and_ids(self):
        event = {
            "page": {"id": "p1", "name": "Page-1"},
            "items": [
                {
                    "objectId": "x1",
                    "schema": "seaf.company.ta.services.dc_offices",
                    "data": {"OID": "corp.services.dc_offices.5", "schema": "seaf.company.ta.services.dc_offices"},
                    "currentLayerName": "Офис",
                    "targetParentLayerName": "Зона доступности",
                    "newParentId": "cell-99",
                }
            ],
        }
        audit = build_reparent_audit_log_payload(event)
        self.assertEqual(audit.get("handler"), "reparent")
        self.assertEqual(audit.get("action"), "reparent_move_audit")
        self.assertEqual(audit.get("page", {}).get("id"), "p1")
        self.assertEqual(len(audit.get("items", [])), 1)
        row = audit["items"][0]
        self.assertEqual(row.get("objectId"), "x1")
        self.assertEqual(row.get("schema"), "seaf.company.ta.services.dc_offices")
        self.assertEqual(row.get("OID"), "corp.services.dc_offices.5")
        self.assertEqual(row.get("currentLayerName"), "Офис")
        self.assertEqual(row.get("targetParentLayerName"), "Зона доступности")
        self.assertEqual(row.get("newParentId"), "cell-99")

    def test_build_reparent_audit_log_payload_empty_items(self):
        audit = build_reparent_audit_log_payload({"page": {"id": "p0"}, "items": []})
        self.assertEqual(audit.get("items"), [])

    @patch("events.reparent.write_response")
    @patch("events.reparent.read_request")
    @patch("events.reparent.build_script_logger")
    def test_main_success_logs_audit_empty_commands(self, mock_logger_factory, mock_read, mock_write):
        mock_read.return_value = {
            "payload": {
                "env": {"pluginLogLevel": "info", "scriptLogLevel": "info"},
                "event": {
                    "eventType": "reparent",
                    "page": {"id": "p1"},
                    "items": [{"objectId": "a", "schema": "s", "currentLayerName": "L"}],
                },
            }
        }
        log = MagicMock()
        mock_logger_factory.return_value = log
        mock_write.return_value = 0
        main()
        log.info.assert_called_once()
        call_arg = log.info.call_args[0][0]
        self.assertEqual(call_arg.get("action"), "reparent_move_audit")
        mock_write.assert_called_once()
        kw = mock_write.call_args.kwargs
        self.assertEqual(kw.get("commands"), [])
        self.assertEqual(kw.get("status"), "success")
        self.assertEqual((kw.get("payload") or {}).get("count"), 1)

    @patch("events.reparent.write_response")
    @patch("events.reparent.read_request")
    @patch("events.reparent.build_script_logger")
    def test_main_wrong_event_type_error(self, mock_logger_factory, mock_read, mock_write):
        mock_read.return_value = {"payload": {"event": {"eventType": "add", "items": []}}}
        log = MagicMock()
        mock_logger_factory.return_value = log
        mock_write.return_value = 1
        main()
        log.error.assert_called()
        mock_write.assert_called_once()
        self.assertEqual(mock_write.call_args.kwargs.get("status"), "error")


if __name__ == "__main__":
    unittest.main()
