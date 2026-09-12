import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location('prepare_connectome', SCRIPTS / 'prepare-connectome.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.sources, self.graph, self.atlas = [self.root / name for name in ['sources', 'graph', 'atlas']]
        self.sources.mkdir()
        source = self.sources / 'annotations.feather'
        source.write_bytes(b'tiny-not-arrow')
        self.dataset = 'male-cns:v1.0'
        self.source_lock = {'dataset': self.dataset, 'selection': 'tiny-test-only', 'license': 'CC-BY-4.0',
                            'licenseUrl': 'https://creativecommons.org/licenses/by/4.0/', 'attribution': 'test',
                            'files': {'annotations': {'bytes': source.stat().st_size, 'sha256': module.connectome.digest(source)}}}
        self.lock_path = self.root / 'source.json'
        self.lock_path.write_text(json.dumps(self.source_lock))
        self.graph_meta, self.graph_hash = self.bundle(self.graph, module.GRAPH_FILES)
        _, atlas_hash = self.bundle(self.atlas, module.ATLAS_FILES)
        self.graph_lock = self.root / 'graph.json'
        self.graph_lock.write_text(json.dumps({'manifestSha256': self.graph_hash, 'manifest': self.graph_meta}))
        (self.root / 'connectome').mkdir()
        (self.root / 'connectome/atlas.lock.json').write_text(json.dumps({'profiles': {self.dataset: {'manifestSha256': atlas_hash}}}))
        patches = [patch.object(module, 'ROOT', self.root), patch.object(module.connectome, 'select_profile'),
                   patch.object(module.connectome, 'LOCK', self.source_lock), patch.object(module.connectome, 'LOCK_PATH', self.lock_path),
                   patch.object(module.connectome, 'GRAPH_LOCK_PATH', self.graph_lock)]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def bundle(self, destination, filenames):
        destination.mkdir()
        files = {}
        for name in filenames:
            payload = name.encode()
            (destination / name).write_bytes(payload)
            files[name] = {'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}
        metadata = {'dataset': self.dataset, 'files': files, 'neuronCount': 2, 'edgeCount': 1}
        (destination / 'manifest.json').write_text(json.dumps(metadata, sort_keys=True))
        return metadata, module.connectome.digest(destination / 'manifest.json')

    def run_prepare(self):
        return module.prepare(self.dataset, self.sources, self.graph, self.atlas)

    def test_verified_resume_does_not_import_or_download(self):
        with patch.object(module.connectome, 'import_graph') as graph, patch.object(module.atlas, 'import_atlas') as atlas, patch('urllib.request.urlopen') as network:
            result = self.run_prepare()
        self.assertEqual(result['stages']['graph'], 'verified-existing')
        self.assertFalse(result['simulationStarted'])
        graph.assert_not_called()
        atlas.assert_not_called()
        network.assert_not_called()

    def test_corrupt_asset_refused_before_network_or_overwrite(self):
        asset = self.graph / 'contacts.u32'
        asset.write_bytes(b'bad')
        with patch.object(module.connectome, 'acquire') as acquire, self.assertRaises(ValueError):
            self.run_prepare()
        acquire.assert_not_called()
        self.assertEqual(asset.read_bytes(), b'bad')

    def test_manifest_provenance_and_cross_profile_are_checked(self):
        (self.atlas / 'manifest.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'provenance'):
            self.run_prepare()
        with self.assertRaisesRegex(ValueError, 'profile'):
            module.verify_bundle(self.graph, self.graph_hash, 'banc:v888', module.GRAPH_FILES)

    def test_invalid_source_preserves_valid_outputs(self):
        (self.sources / 'annotations.feather').write_bytes(b'wrong')
        with self.assertRaisesRegex(ValueError, 'source'):
            self.run_prepare()
        self.assertEqual(module.connectome.digest(self.graph / 'manifest.json'), self.graph_hash)

    def test_missing_atlas_resumes_after_failure_without_reimporting_graph(self):
        import shutil
        shutil.rmtree(self.atlas)
        with patch.dict(sys.modules, {'numpy': object(), 'pyarrow': object()}), patch.object(module.connectome, 'import_graph') as graph:
            with patch.object(module.atlas, 'import_atlas', side_effect=ValueError('interrupted')), self.assertRaisesRegex(ValueError, 'interrupted'):
                self.run_prepare()
            self.assertEqual(module.connectome.digest(self.graph / 'manifest.json'), self.graph_hash)
            with patch.object(module.atlas, 'import_atlas', side_effect=lambda *args: self.bundle(self.atlas, module.ATLAS_FILES)):
                self.assertEqual(self.run_prepare()['stages']['atlas'], 'imported-and-verified')
            graph.assert_not_called()

    def test_overlapping_outputs_rejected(self):
        with self.assertRaisesRegex(ValueError, 'overlap'):
            module.prepare(self.dataset, self.sources, self.sources / 'graph', self.atlas)

    def test_cli_requires_explicit_authorization_and_profile(self):
        result = subprocess.run([sys.executable, str(SCRIPTS / 'prepare-connectome.py'), '--dataset', self.dataset,
                                 '--sources', str(self.sources), '--graph', str(self.graph), '--atlas', str(self.atlas)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('--prepare is required', result.stderr)


if __name__ == '__main__':
    unittest.main()
