"""Explicit pinned source, sparse graph and anatomical atlas preparation; no workers."""
import argparse
import contextlib
import io
import json
from pathlib import Path
import shutil
import sys

import atlas
import connectome

ROOT = Path(__file__).resolve().parents[1]
GRAPH_FILES = {"ids.json", "offsets.u32", "targets.u32", "contacts.u32", "signs.i8"}
ATLAS_FILES = {"nodes.json", "positions.f32", "valid.u8", "groups.u8"}


def verify_bundle(directory, expected_hash, dataset, filenames):
    """Authenticate metadata before using filenames, lengths or hashes from it."""
    directory = Path(directory)
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("Bundle must be a real directory")
    manifest = directory / "manifest.json"
    if manifest.is_symlink() or not manifest.is_file() or manifest.stat().st_size > 2 * 1024**2:
        raise ValueError("Missing or oversized manifest")
    if connectome.digest(manifest) != expected_hash:
        raise ValueError("Manifest differs from pinned provenance; refusing existing output")
    metadata = json.loads(manifest.read_text())
    if metadata["dataset"] != dataset or set(metadata["files"]) != filenames:
        raise ValueError("Incompatible bundle profile or files")
    for name, expected in metadata["files"].items():
        path = directory / name
        if (path.is_symlink() or not path.is_file() or not 0 < expected["bytes"] <= 512 * 1024**2
                or path.stat().st_size != expected["bytes"] or connectome.digest(path) != expected["sha256"]):
            raise ValueError(f"Invalid bundle asset: {name}; refusing to overwrite")
    return metadata


def prepare(dataset, sources, graph, atlas_output):
    connectome.select_profile(dataset)
    sources, graph, atlas_output = [Path(path).absolute() for path in (sources, graph, atlas_output)]
    # Independent stages may share a parent, never overlap each other's contents.
    paths = [p.resolve() for p in (sources, graph, atlas_output)]
    if any(a == b or a in b.parents or b in a.parents for i, a in enumerate(paths) for b in paths[i + 1:]):
        raise ValueError("Source, graph and atlas directories must not overlap")
    if any(p.is_symlink() for p in (sources, graph, atlas_output)):
        raise ValueError("Preparation directories must not be symlinks")
    source_lock = connectome.LOCK
    graph_lock = json.loads(connectome.GRAPH_LOCK_PATH.read_text())
    atlas_hash = json.loads((ROOT / "connectome/atlas.lock.json").read_text())["profiles"][dataset]["manifestSha256"]
    stages = {}
    # Refuse existing corrupt output before any network call or import.
    for label, path, expected_hash, names in [("graph", graph, graph_lock["manifestSha256"], GRAPH_FILES),
                                             ("atlas", atlas_output, atlas_hash, ATLAS_FILES)]:
        if path.exists():
            verify_bundle(path, expected_hash, dataset, names)
            stages[label] = "verified-existing"
    for name, expected in source_lock["files"].items():
        path = sources / f"{name}.feather"
        if path.is_symlink() or path.exists() and (not path.is_file() or path.stat().st_size != expected["bytes"] or connectome.digest(path) != expected["sha256"]):
            raise ValueError(f"Incompatible existing source: {name}; refusing overwrite")
    # Import dependencies are checked before potentially expensive acquisition.
    if len(stages) != 2:
        import numpy  # noqa: F401
        import pyarrow  # noqa: F401
    missing_source_bytes = sum(v["bytes"] for name, v in source_lock["files"].items() if not (sources / f"{name}.feather").exists())
    allocations = [(sources, missing_source_bytes),
                   (graph, 0 if "graph" in stages else sum(v["bytes"] for v in graph_lock["manifest"]["files"].values())),
                   (atlas_output, 0 if "atlas" in stages else 64 * 1024**2)]
    # Conservative per-filesystem check includes all stages, even on separate disks.
    required = sum(size for _, size in allocations) + 512 * 1024**2
    for path, size in allocations:
        if size:
            parent = path.parent
            while not parent.exists():
                parent = parent.parent
            if shutil.disk_usage(parent).free < required:
                raise ValueError(f"Insufficient disk headroom; need at least {required} free bytes for preparation")
    connectome.acquire(sources)
    stages["sources"] = "verified" if not missing_source_bytes else "acquired-and-verified"
    if "graph" not in stages:
        with contextlib.redirect_stdout(io.StringIO()):
            connectome.import_graph(sources, graph)
        stages["graph"] = "imported-and-verified"
    if "atlas" not in stages:
        atlas.import_atlas(dataset, sources / "annotations.feather", atlas_output)
        stages["atlas"] = "imported-and-verified"
    verify_bundle(graph, graph_lock["manifestSha256"], dataset, GRAPH_FILES)
    verify_bundle(atlas_output, atlas_hash, dataset, ATLAS_FILES)
    return {"schemaVersion": 1, "status": "prepared", "dataset": dataset, "stages": stages,
            "selection": source_lock["selection"], "neuronCount": graph_lock["manifest"]["neuronCount"],
            "edgeCount": graph_lock["manifest"]["edgeCount"], "sourceLockSha256": connectome.digest(connectome.LOCK_PATH),
            "graphManifestSha256": graph_lock["manifestSha256"], "atlasManifestSha256": atlas_hash,
            "license": source_lock["license"], "licenseUrl": source_lock["licenseUrl"], "attribution": source_lock["attribution"],
            "simulationStarted": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare", action="store_true", help="explicitly authorize pinned public data downloads and local imports")
    parser.add_argument("--dataset", choices=connectome.PROFILES, required=True)
    parser.add_argument("--sources", type=Path, required=True)
    parser.add_argument("--graph", type=Path, required=True)
    parser.add_argument("--atlas", type=Path, required=True)
    args = parser.parse_args()
    if not args.prepare:
        parser.error("--prepare is required; startup never acquires data")
    try:
        print(json.dumps(prepare(args.dataset, args.sources, args.graph, args.atlas), indent=2))
    except (ValueError, OSError, ImportError) as error:
        parser.exit(1, f"Preparation failed: {error}\n")


if __name__ == "__main__":
    main()
