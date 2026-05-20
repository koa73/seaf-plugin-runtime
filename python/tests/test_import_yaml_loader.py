"""Tests for import YAML loader and helpers."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest

_SCRIPTS = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "scripts")
)
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

from lib.main_menu.import_helpers import resolve_input_targets  # noqa: E402
from lib.main_menu.import_yaml_loader import build_import_map_from_sources  # noqa: E402


class TestImportYamlLoader(unittest.TestCase):
    def test_resolve_directory_targets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, "sub"), exist_ok=True)
            with open(os.path.join(tmp, "a.yaml"), "w", encoding="utf-8") as handle:
                handle.write("x: 1\n")
            with open(os.path.join(tmp, "sub", "b.yml"), "w", encoding="utf-8") as handle:
                handle.write("x: 2\n")
            targets = resolve_input_targets({"inputSeafFile": tmp})
            self.assertTrue(targets.is_directory)
            self.assertEqual(len(targets.yaml_files), 2)

    def test_build_import_map(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p1 = os.path.join(tmp, "one.yaml")
            p2 = os.path.join(tmp, "two.yaml")
            with open(p1, "w", encoding="utf-8") as handle:
                handle.write(
                    "seaf.company.ta.services.dcs:\n"
                    "  company.services.dcs.1:\n"
                    "    title: DC1\n"
                )
            with open(p2, "w", encoding="utf-8") as handle:
                handle.write(
                    "seaf.company.ta.services.dcs:\n"
                    "  company.services.dcs.1:\n"
                    "    title: DC1\n"
                    "  company.services.dcs.2:\n"
                    "    title: DC2\n"
                )
            import_map, stats = build_import_map_from_sources([p1, p2], env={})
            self.assertIn("seaf.company.ta.services.dcs", import_map)
            bucket = import_map["seaf.company.ta.services.dcs"]
            self.assertEqual(len(bucket), 2)
            self.assertEqual(len(stats.skipped_duplicate), 1)
            self.assertEqual(bucket["company.services.dcs.2"]["title"], "DC2")


if __name__ == "__main__":
    unittest.main()

