"""Acquisition failures must not publish unverified source data. No network/data dependency."""
import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("connectome", Path(__file__).resolve().parents[1] / "scripts/connectome.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AcquisitionTests(unittest.TestCase):
    def test_only_verified_data_is_published_and_reused(self):
        data = b"synthetic verification bytes"
        lock = {"files": {"sample": {"url": "https://example.invalid/data", "bytes": len(data),
                                     "sha256": hashlib.sha256(data).hexdigest()}}}
        with tempfile.TemporaryDirectory() as name, patch.object(module, "LOCK", lock):
            directory = Path(name)
            for response in [b"short", b"x" * len(data), data + b"oversized"]:
                with patch.object(module.urllib.request, "urlopen", return_value=io.BytesIO(response)):
                    with self.assertRaises(ValueError):
                        module.acquire(directory)
                self.assertEqual(list(directory.iterdir()), [])
            with patch.object(module.urllib.request, "urlopen", side_effect=TimeoutError):
                with self.assertRaises(TimeoutError):
                    module.acquire(directory)
            self.assertEqual(list(directory.iterdir()), [])
            with patch.object(module.urllib.request, "urlopen", return_value=io.BytesIO(data)):
                module.acquire(directory)
            with patch.object(module.urllib.request, "urlopen", side_effect=AssertionError("must reuse verified data")):
                module.acquire(directory)
            self.assertEqual((directory / "sample.feather").read_bytes(), data)
            (directory / "sample.feather").write_bytes(b"existing incompatible file")
            with self.assertRaises(ValueError):
                module.acquire(directory)
            self.assertEqual((directory / "sample.feather").read_bytes(), b"existing incompatible file")


class ProfileTests(unittest.TestCase):
    def tearDown(self):
        module.select_profile("male-cns:v1.0")

    def test_explicit_profiles_select_separate_locks_and_reject_unknown(self):
        module.select_profile("banc:v888")
        self.assertEqual(module.LOCK["dataset"], "banc:v888")
        self.assertEqual(module.GRAPH_LOCK_PATH.name, "banc-v888.graph.lock.json")
        with self.assertRaises(KeyError):
            module.select_profile("../../unknown")
        module.select_profile("male-cns:v1.0")
        self.assertEqual(module.LOCK["dataset"], "male-cns:v1.0")
        self.assertEqual(module.GRAPH_LOCK_PATH.name, "graph.lock.json")

    def test_banc_selection_keeps_unclassified_cells_but_excludes_non_neurons(self):
        base = {"banc_888_id": "9007199254740993", "root_888": "9007199254740993",
                "proofread": "TRUE", "roughly_proofread": "FALSE", "super_class": None}
        rows = [base]
        for i, changes in enumerate([{"super_class": "glia"}, {"super_class": "trachea"},
            {"super_class": "not_a_neuron"}, {"proofread": "FALSE"},
            {"proofread": "FALSE", "roughly_proofread": "TRUE"}], start=1):
            identity = str(9007199254740993 + i)
            rows.append({**base, **changes, "banc_888_id": identity, "root_888": identity})
        retained, counts = module.select_banc_annotations(rows)
        self.assertEqual([row["banc_888_id"] for row in retained], [rows[0]["banc_888_id"], rows[-1]["banc_888_id"]])
        self.assertEqual(counts, {"retainedProofread": 1, "retainedRoughlyProofread": 1,
                                  "excludedNonNeuron": 3, "excludedUnproofread": 1})
        for changes in [{"root_888": "9007199254740992"}, {"banc_888_id": 9007199254740993},
                        {"banc_888_id": "09007199254740993"}, {"proofread": True}]:
            with self.assertRaises(ValueError):
                module.select_banc_annotations([{**base, **changes}])
        with self.assertRaises(ValueError):
            module.select_banc_annotations([base, base])


if __name__ == "__main__":
    unittest.main()
