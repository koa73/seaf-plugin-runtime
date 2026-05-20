#!/usr/bin/env python3
import unittest

from lib.oid.conflicts import collect_import_conflicts, normalize_known_oid_entry


class OidConflictsContractTests(unittest.TestCase):
    def test_normalize_known_oid_entry_accepts_object_shape(self):
        entry = {"objectIds": ["id-1", "id-2"]}
        self.assertEqual(normalize_known_oid_entry(entry), ["id-1", "id-2"])

    def test_normalize_known_oid_entry_accepts_list_shape(self):
        entry = ["id-1", "id-2"]
        self.assertEqual(normalize_known_oid_entry(entry), ["id-1", "id-2"])

    def test_collect_import_conflicts_handles_object_shape(self):
        items = [{"objectId": "new-1", "schema": "schema.a", "data": {"OID": "corp.a.1"}}]
        known = {"corp.a.1": {"objectIds": ["existing-1"]}}
        conflicts = collect_import_conflicts(items, known)
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0]["conflictWithCellId"], "existing-1")

    def test_collect_import_conflicts_skips_when_other_cell_on_different_page(self):
        items = [{"objectId": "office-main", "schema": "seaf.company.ta.services.dc_offices", "data": {"OID": "corp.x.1"}}]
        known = {"corp.x.1": ["mirror-other"]}
        object_page = {"office-main": "page-main", "mirror-other": "page-mirror"}
        conflicts = collect_import_conflicts(
            items, known, object_page=object_page, event_page_id="page-main"
        )
        self.assertEqual(len(conflicts), 0)

    def test_collect_import_conflicts_same_page_still_reports(self):
        items = [{"objectId": "new-1", "schema": "schema.a", "data": {"OID": "corp.a.1"}}]
        known = {"corp.a.1": ["existing-1"]}
        object_page = {"new-1": "p1", "existing-1": "p1"}
        conflicts = collect_import_conflicts(
            items, known, object_page=object_page, event_page_id="p1"
        )
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0]["conflictWithCellId"], "existing-1")

    def test_collect_import_conflicts_handles_list_shape(self):
        items = [{"objectId": "new-1", "schema": "schema.a", "data": {"OID": "corp.a.1"}}]
        known = {"corp.a.1": ["existing-1"]}
        conflicts = collect_import_conflicts(items, known)
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0]["conflictWithCellId"], "existing-1")


if __name__ == "__main__":
    unittest.main()
