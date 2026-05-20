"""Tests for export YAML generator integration."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest

_SCRIPTS = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "scripts"))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from lib.main_menu.export_helpers import build_export_by_schema, is_seaf_export_schema  # noqa: E402
from lib.main_menu.export_yaml_generator import (  # noqa: E402
    normalize_instance_attrs,
    write_export_outputs_via_generator,
)


class TestExportYamlGenerator(unittest.TestCase):
    def test_normalize_stand_empty_list(self) -> None:
        self.assertEqual(normalize_instance_attrs({"stand": "[]"})["stand"], [])

    def test_directory_export_has_schema_wrapper(self) -> None:
        export_map = {
            "seaf.company.ta.services.dcs": {
                "company.services.dcs.1": {"title": "DC1", "vendor": "Test"},
            }
        }
        with tempfile.TemporaryDirectory() as tmp:
            result = write_export_outputs_via_generator(export_map, tmp)
            self.assertEqual(result.write_mode, "directory")
            self.assertEqual(len(result.written_files), 1)
            path = result.written_files[0]
            with open(path, encoding="utf-8") as handle:
                text = handle.read()
            self.assertIn("seaf.company.ta.services.dcs:", text)
            self.assertIn("company.services.dcs.1:", text)
            self.assertIn("title: DC1", text)

    def test_non_seaf_without_oid_is_ignored_not_error(self) -> None:
        items = [
            {
                "schema": "stencil(abc)",
                "oid": "",
                "objectId": "stencil-1",
                "data": {},
            },
            {
                "schema": "mxgraph.cisco_safe.security_icons.ngfw",
                "oid": "",
                "objectId": "ngfw-1",
                "data": {},
            },
        ]
        export_map, warnings, stats = build_export_by_schema(items, collect_stats=True)
        assert stats is not None
        self.assertEqual(export_map, {})
        self.assertEqual(warnings, [])
        self.assertEqual(len(stats.skipped_input), 0)
        self.assertEqual(len(stats.skipped_ignored), 2)

    def test_seaf_without_oid_is_export_error(self) -> None:
        items = [
            {
                "schema": "seaf.company.ta.services.dcs",
                "oid": "",
                "objectId": "c1",
                "data": {"title": "X"},
            },
        ]
        export_map, warnings, stats = build_export_by_schema(items, collect_stats=True)
        assert stats is not None
        self.assertEqual(export_map, {})
        self.assertEqual(len(warnings), 1)
        self.assertIn("SEAF object without OID", warnings[0])
        self.assertEqual(len(stats.skipped_input), 1)
        self.assertEqual(stats.skipped_input[0]["reason"], "missing_oid_seaf")

    def test_is_seaf_export_schema(self) -> None:
        self.assertTrue(is_seaf_export_schema("seaf.company.ta.services.dcs"))
        self.assertFalse(is_seaf_export_schema("stencil(x)"))
        self.assertFalse(is_seaf_export_schema("mxgraph.cisco_safe.security_icons.ngfw"))

    def test_duplicate_oid_not_counted_in_eligible(self) -> None:
        items = [
            {
                "schema": "seaf.company.ta.services.dc_offices",
                "oid": "company.services.dc_offices.1",
                "objectId": "cell-a",
                "pageName": "Страница-1",
                "data": {"title": "Office"},
            },
            {
                "schema": "seaf.company.ta.services.dc_offices",
                "oid": "company.services.dc_offices.1",
                "objectId": "cell-b",
                "pageName": "Головной офис",
                "data": {"title": "Office"},
            },
        ]
        export_map, warnings, stats = build_export_by_schema(items, collect_stats=True)
        assert stats is not None
        self.assertEqual(len(stats.eligible), 1)
        self.assertEqual(len(stats.skipped_duplicate), 1)
        self.assertEqual(
            len(export_map["seaf.company.ta.services.dc_offices"]),
            1,
        )

    def test_build_export_collects_stats(self) -> None:
        items = [
            {
                "schema": "seaf.company.ta.services.dcs",
                "oid": "company.services.dcs.1",
                "objectId": "c1",
                "pageName": "P1",
                "data": {"title": "A"},
            },
            {
                "schema": "seaf.company.ta.services.dcs",
                "oid": "",
                "objectId": "c2",
                "data": {"title": "B"},
            },
        ]
        export_map, warnings, stats = build_export_by_schema(items, collect_stats=True)
        self.assertIsNotNone(stats)
        assert stats is not None
        self.assertEqual(len(stats.eligible), 1)
        self.assertEqual(len(stats.skipped_input), 1)
        self.assertIn("company.services.dcs.1", export_map["seaf.company.ta.services.dcs"])


if __name__ == "__main__":
    unittest.main()
