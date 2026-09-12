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


if __name__ == "__main__":
    unittest.main()
