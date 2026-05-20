#!/usr/bin/env python3
import unittest
from unittest.mock import patch as mock_patch

from lib.main_menu.seaf_data_map import build_import_patch


class ImportTitleLabelSyncTests(unittest.TestCase):
    def test_title_change_syncs_label(self) -> None:
        before = {
            "OID": "company.services.dcs.1",
            "schema": "seaf.company.ta.services.dcs",
            "title": "Old",
            "label": "Old",
        }
        yaml_attrs = {"title": "New DC", "vendor": "V1"}
        patch, synced = build_import_patch("seaf.company.ta.services.dcs", yaml_attrs, before)
        self.assertTrue(synced)
        self.assertEqual(patch["title"], "New DC")
        self.assertEqual(patch["label"], "New DC")
        self.assertEqual(patch["vendor"], "V1")

    def test_title_unchanged_no_extra_label(self) -> None:
        before = {"title": "Same", "label": "Same", "vendor": "V0"}
        yaml_attrs = {"vendor": "V1"}
        patch, synced = build_import_patch("seaf.company.ta.services.dcs", yaml_attrs, before)
        self.assertFalse(synced)
        self.assertEqual(patch, {"vendor": "V1"})
        self.assertNotIn("label", patch)
        self.assertNotIn("title", patch)

    def test_non_ta_schema_no_label_sync(self) -> None:
        before = {"title": "a", "label": "a"}
        yaml_attrs = {"title": "b"}
        patch, synced = build_import_patch("seaf.other.schema", yaml_attrs, before)
        self.assertFalse(synced)
        self.assertEqual(patch["title"], "b")
        self.assertNotIn("label", patch)

    def test_disabled_by_config(self) -> None:
        fake_cfg = {"schemas": {"seaf.company.ta.services.dc_azs": {"sync_title_with_label": False}}}
        with mock_patch("lib.events.title_label_sync.load_stencil_layer_config", return_value=fake_cfg):
            before = {"title": "a", "label": "a"}
            yaml_attrs = {"title": "b"}
            result, synced = build_import_patch("seaf.company.ta.services.dc_azs", yaml_attrs, before)
            self.assertFalse(synced)
            self.assertEqual(result["title"], "b")
            self.assertNotIn("label", result)


if __name__ == "__main__":
    unittest.main()
