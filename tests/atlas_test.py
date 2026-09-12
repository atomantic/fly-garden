import importlib.util
import math
from pathlib import Path
import struct
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import atlas


def male(identity=1, point=None, superclass="cb_intrinsic"):
    return {"bodyId": identity, "status": "Traced", "somaLocation": point, "somaNeuromere": None, "superclass": superclass, "type": "example", "class": "example"}


def banc(identity="9007199254740993", point=None):
    return {"banc_888_id": identity, "root_888": identity, "proofread": "TRUE", "roughly_proofread": "FALSE", "root_position_nm": point, "region": "ventral_nerve_cord", "super_class": "ventral_nerve_cord_intrinsic", "cell_type": None}


class AtlasTests(unittest.TestCase):
    def test_native_unit_conversion_and_missing_entries(self):
        data, counts, bounds = atlas.prepare_rows([male(2), male(1, [1000, 2000, 3000])], "male-cns:v1.0")
        self.assertEqual(struct.unpack("<ffffff", data["positions.f32"]), (8., 16., 24., 0., 0., 0.))
        self.assertEqual(data["valid.u8"], bytes([1, 0]))
        self.assertEqual(counts["missing"], 1)
        self.assertEqual(bounds["whole"], {"min": [8., 16., 24.], "max": [8., 16., 24.]})
        self.assertIn(b'male-cns:v1.0/2', data["nodes.json"])

    def test_banc_keeps_exact_large_ids_and_root_point_kind(self):
        data, counts, bounds = atlas.prepare_rows([banc(point="1000, 2000, 3000")], "banc:v888")
        self.assertEqual(struct.unpack("<fff", data["positions.f32"]), (1., 2., 3.))
        self.assertIn(b'banc:v888/9007199254740993', data["nodes.json"])
        self.assertIn(b'root-representative', data["nodes.json"])
        self.assertEqual(counts["groups"]["ventral-nerve-cord"], 1)

    def test_invalid_points_are_masked_and_reported_not_invented(self):
        bad = [[1, 2], [1, 2, math.nan], [1, 2, math.inf], [-1, 2, 3], [True, 2, 3], "1,2,3"]
        for point in bad:
            data, counts, _ = atlas.prepare_rows([male(point=point)], "male-cns:v1.0")
            self.assertEqual(data["valid.u8"], b'\0')
            self.assertEqual(counts["missingReasons"], {"invalid-coordinate": 1})
        self.assertEqual(atlas.parse_position("1, nope, 3", "banc:v888"), (None, "invalid-coordinate"))

    def test_no_cross_specimen_mapping_and_duplicate_id_rejection(self):
        bad = banc(); bad["root_888"] = "123"
        with self.assertRaisesRegex(ValueError, "mapping"):
            atlas.prepare_rows([bad], "banc:v888")
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            atlas.prepare_rows([male(), male()], "male-cns:v1.0")
        with self.assertRaisesRegex(ValueError, "profile"):
            atlas.prepare_rows([], "flywire")

    def test_retention_and_groups_do_not_drop_missing_or_unclassified(self):
        excluded = male(4); excluded["status"] = "Glia"
        data, counts, bounds = atlas.prepare_rows([male(1, [1, 2, 3], None), male(2, [3, 2, 1], "descending_neuron"), male(3, None, "ol_intrinsic"), excluded], "male-cns:v1.0")
        self.assertEqual(counts["retained"], 3)
        self.assertEqual(list(data["groups.u8"]), [4, 3, 0])
        self.assertIsNone(bounds["visual-system"])
        self.assertEqual(counts["groups"]["unknown"], 1)

    def test_changed_sources_fail_before_writing_output(self):
        try:
            import pyarrow
        except ImportError:
            self.skipTest("Pinned PyArrow importer environment is not installed")
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "annotations.feather"
            source.write_bytes(b"corrupt")
            destination = Path(directory) / "atlas"
            with self.assertRaisesRegex(ValueError, "hash/size"):
                atlas.import_atlas("male-cns:v1.0", source, destination)
            self.assertFalse(destination.exists())


if __name__ == "__main__":
    unittest.main()
