"""Explicit offline-data acquisition and sparse import; never starts a simulation."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import time
import urllib.request

LOCK_PATH = Path(__file__).resolve().parents[1] / "connectome/malecns-v1.lock.json"
LOCK = json.loads(LOCK_PATH.read_text())
SIGN = {"acetylcholine": 1, "gaba": -1, "glutamate": -1}


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def verify_sources(directory):
    for name, expected in LOCK["files"].items():
        path = directory / f"{name}.feather"
        if path.stat().st_size != expected["bytes"] or digest(path) != expected["sha256"]:
            raise ValueError(f"Incompatible source: {name}; remove it and acquire again")


def acquire(directory):
    directory.mkdir(parents=True, exist_ok=True)
    for name, expected in LOCK["files"].items():
        path = directory / f"{name}.feather"
        if path.exists():
            if path.stat().st_size != expected["bytes"] or digest(path) != expected["sha256"]:
                raise ValueError(f"Refusing to overwrite incompatible source: {name}")
            continue
        # A partial download can never be mistaken for a verified source file.
        with tempfile.NamedTemporaryFile(prefix=f".{name}-", suffix=".partial", dir=directory, delete=False) as scratch:
            temporary = Path(scratch.name)
        try:
            with urllib.request.urlopen(expected["url"], timeout=60) as response, temporary.open("wb") as out:
                remaining = expected["bytes"]
                while block := response.read(min(1024 * 1024, remaining + 1)):
                    remaining -= len(block)
                    if remaining < 0:
                        raise ValueError(f"Source exceeds pinned size: {name}")
                    out.write(block)
            if temporary.stat().st_size != expected["bytes"] or digest(temporary) != expected["sha256"]:
                raise ValueError(f"Source hash/size mismatch: {name}")
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    verify_sources(directory)


def import_graph(directory, destination):
    import numpy as np
    import pyarrow as pa
    import pyarrow.feather as feather

    if destination.exists():
        raise ValueError("Output already exists; use a new directory to preserve prior provenance")
    start = time.perf_counter()
    verify_sources(directory)
    annotations = feather.read_table(directory / "annotations.feather").to_pylist()
    retained = sorted((row for row in annotations if row["status"] == "Traced"), key=lambda row: row["bodyId"])
    ids = np.array([row["bodyId"] for row in retained], dtype=np.int64)
    if not len(ids) or len(set(ids)) != len(ids) or np.any(ids <= 0):
        raise ValueError("Invalid/duplicate retained neuron IDs")
    source_counts = {"annotations": len(annotations)}
    categories = dict(Counter(row["status"] or "null" for row in annotations))
    populations = dict(Counter(row["superclass"] or "null" for row in retained))
    del annotations

    nt = feather.read_table(directory / "transmitters.feather", columns=["body", "consensus_nt"])
    source_counts["transmitters"] = nt.num_rows
    retained_set = set(int(value) for value in ids)
    transmitter = {}
    for batch in nt.to_batches():
        for body, value in zip(batch.column(0).to_pylist(), batch.column(1).to_pylist()):
            if body in retained_set:
                if body in transmitter:
                    raise ValueError("Duplicate neurotransmitter body ID")
                transmitter[body] = value or "unknown"
    signs = np.array([SIGN.get(transmitter.get(int(body), "unknown"), 0) for body in ids], dtype="i1")
    nt_counts = dict(Counter(transmitter.get(int(body), "unknown") for body in ids))
    del nt, transmitter, retained_set, retained

    edge_sources, edge_targets, edge_contacts = [], [], []
    counts = Counter()
    # Read one Arrow batch at a time: never materialize the full segment graph.
    with pa.memory_map(str(directory / "weights.feather"), "r") as mapped:
        reader = pa.ipc.open_file(mapped)
        if reader.schema.names != ["body_pre", "body_post", "weight"]:
            raise ValueError("Unexpected connectivity schema")
        for index in range(reader.num_record_batches):
            batch = reader.get_batch(index)
            pre, post, contacts = [batch.column(i).to_numpy() for i in range(3)]
            if np.any(contacts <= 0) or np.any(contacts > np.iinfo(np.uint32).max):
                raise ValueError("Invalid synaptic-contact count")
            sources, targets = np.searchsorted(ids, pre), np.searchsorted(ids, post)
            pre_kept = (sources < len(ids)) & (ids[np.minimum(sources, len(ids) - 1)] == pre)
            post_kept = (targets < len(ids)) & (ids[np.minimum(targets, len(ids) - 1)] == post)
            keep = pre_kept & post_kept
            counts["sourceEdgeRows"] += len(pre)
            counts["sourceContacts"] += int(contacts.sum())
            for label, selection in [("retained", keep), ("preExcluded", ~pre_kept & post_kept),
                                     ("postExcluded", pre_kept & ~post_kept), ("bothExcluded", ~pre_kept & ~post_kept)]:
                counts[f"{label}EdgeRows"] += int(selection.sum())
                counts[f"{label}Contacts"] += int(contacts[selection].sum())
            counts["selfEdgeRows"] += int((keep & (pre == post)).sum())
            counts["selfContacts"] += int(contacts[keep & (pre == post)].sum())
            counts["singleContactEdgeRows"] += int((keep & (contacts == 1)).sum())
            edge_sources.append(sources[keep].astype("<u4"))
            edge_targets.append(targets[keep].astype("<u4"))
            edge_contacts.append(contacts[keep].astype("<u4"))

    sources, targets, contacts = [np.concatenate(parts) for parts in (edge_sources, edge_targets, edge_contacts)]
    del edge_sources, edge_targets, edge_contacts
    if len(sources) >= 2**32:
        raise ValueError("Graph exceeds version-1 uint32 capacity")
    # Source then target ordering is canonical, independent of Arrow batch sizes.
    order = np.lexsort((targets, sources))
    sources, targets, contacts = sources[order], targets[order], contacts[order]
    del order
    if np.any((sources[1:] == sources[:-1]) & (targets[1:] == targets[:-1])):
        raise ValueError("Duplicate directed edge rows; explicit aggregation policy required")
    offsets = np.zeros(len(ids) + 1, dtype="<u4")
    offsets[1:] = np.cumsum(np.bincount(sources, minlength=len(ids)))
    counts["silentTransmitterEdgeRows"] = int((signs[sources] == 0).sum())
    del sources
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".connectome-", dir=destination.parent))
    try:
        (stage / "ids.json").write_text(json.dumps([str(int(body)) for body in ids], separators=(",", ":")) + "\n")
        for name, values in [("offsets.u32", offsets), ("targets.u32", targets), ("contacts.u32", contacts), ("signs.i8", signs)]:
            values.tofile(stage / name)
        manifest = {
            "schemaVersion": 1, "dataset": LOCK["dataset"], "selection": LOCK["selection"],
            "sourceLockSha256": digest(LOCK_PATH), "neuronCount": len(ids), "edgeCount": len(targets),
            "contactCount": counts["retainedContacts"], "sourceCounts": source_counts,
            "annotationStatusCounts": categories, "retainedSuperclassCounts": populations,
            "transmitterCounts": nt_counts, "graphCounts": dict(counts),
            "files": {path.name: {"bytes": path.stat().st_size, "sha256": digest(path)} for path in sorted(stage.iterdir())},
        }
        (stage / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
        graph_lock = json.loads((LOCK_PATH.parent / "graph.lock.json").read_text())
        if digest(stage / "manifest.json") != graph_lock["manifestSha256"]:
            raise ValueError("Derived graph differs from pinned counts/hashes; output not published")
        stage.rename(destination)
        print(json.dumps({"status": "imported", "importWallSeconds": time.perf_counter() - start, **manifest}, indent=2))
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["acquire", "verify", "import"])
    parser.add_argument("--sources", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.command == "acquire":
        acquire(args.sources)
    elif args.command == "verify":
        verify_sources(args.sources)
        print(json.dumps({"status": "verified", "dataset": LOCK["dataset"], "files": LOCK["files"]}, indent=2))
    else:
        if args.output is None:
            parser.error("import requires --output")
        import_graph(args.sources, args.output)


if __name__ == "__main__":
    main()
