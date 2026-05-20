#!/usr/bin/env python3
import io
import sys
import unittest
from unittest.mock import patch

from lib.events.title_label_sync import apply_title_label_sync, sync_title_label_enabled_for_schema
from lib.logging import build_script_logger


class TitleLabelSyncTests(unittest.TestCase):
    def test_title_only_copies_to_label(self) -> None:
        before = {"title": "a", "label": "a"}
        after = {"title": "b", "label": "a"}
        self.assertTrue(apply_title_label_sync("seaf.company.ta.services.dc_azs", before, after))
        self.assertEqual(after["title"], "b")
        self.assertEqual(after["label"], "b")

    def test_label_only_copies_to_title(self) -> None:
        before = {"title": "a", "label": "a"}
        after = {"title": "a", "label": "z"}
        self.assertTrue(apply_title_label_sync("seaf.company.ta.services.dc_azs", before, after))
        self.assertEqual(after["title"], "z")
        self.assertEqual(after["label"], "z")

    def test_both_changed_title_wins(self) -> None:
        before = {"title": "a", "label": "a"}
        after = {"title": "T", "label": "L"}
        self.assertTrue(apply_title_label_sync("seaf.company.ta.services.dc_azs", before, after))
        self.assertEqual(after["title"], "T")
        self.assertEqual(after["label"], "T")

    def test_no_title_label_change_returns_false(self) -> None:
        before = {"title": "x", "label": "y"}
        after = {"title": "x", "label": "y", "address": "addr"}
        self.assertFalse(apply_title_label_sync("seaf.company.ta.services.dc_azs", before, after))
        self.assertEqual(after["address"], "addr")

    def test_non_ta_schema_returns_false_without_mutation(self) -> None:
        after = {"title": "n", "label": "o"}
        self.assertFalse(apply_title_label_sync("seaf.other.schema", {}, after))
        self.assertEqual(after["title"], "n")

    def test_disabled_by_config_returns_false(self) -> None:
        fake_cfg = {"schemas": {"seaf.company.ta.services.dc_azs": {"sync_title_with_label": False}}}
        with patch("lib.events.title_label_sync.load_stencil_layer_config", return_value=fake_cfg):
            before = {"title": "a", "label": "a"}
            after = {"title": "b", "label": "a"}
            self.assertFalse(apply_title_label_sync("seaf.company.ta.services.dc_azs", before, after))
            self.assertEqual(after["title"], "b")
            self.assertEqual(after["label"], "a")

    def test_script_logger_debug_no_emit_on_info(self) -> None:
        payload: dict = {"env": {"pluginLogLevel": "info"}}
        logger = build_script_logger(payload)
        stderr = io.StringIO()
        with patch.object(sys, "stderr", stderr):
            logger.debug({"probe": 1})
        self.assertEqual(stderr.getvalue(), "")

    def test_script_logger_debug_emits_on_debug(self) -> None:
        payload: dict = {"env": {"pluginLogLevel": "debug"}}
        logger = build_script_logger(payload)
        stderr = io.StringIO()
        with patch.object(sys, "stderr", stderr):
            logger.debug({"probe": 1})
        self.assertIn("SEAF_INFO", stderr.getvalue())
        self.assertIn("probe", stderr.getvalue())

    def test_sync_title_label_enabled_for_schema_respects_false(self) -> None:
        fake_cfg = {"schemas": {"seaf.company.ta.services.x": {"sync_title_with_label": False}}}
        with patch("lib.events.title_label_sync.load_stencil_layer_config", return_value=fake_cfg):
            self.assertFalse(sync_title_label_enabled_for_schema("seaf.company.ta.services.x"))


if __name__ == "__main__":
    unittest.main()
