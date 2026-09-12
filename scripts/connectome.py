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
GRAPH_LOCK_PATH = LOCK_PATH.parent / "graph.lock.json"
PROFILES = {"male-cns:v1.0": ("malecns-v1.lock.json", "graph.lock.json"),
            "banc:v888": ("banc-v888.lock.json", "banc-v888.graph.lock.json")}
SIGN = {"acetylcholine": 1, "gaba": -1, "glutamate": -1}


def select_profile(dataset):
    global LOCK, LOCK_PATH, GRAPH_LOCK_PATH
    source, graph = PROFILES[dataset]
    LOCK_PATH = Path(__file__).resolve().parents[1] / "connectome" / source
    GRAPH_LOCK_PATH = LOCK_PATH.parent / graph
    LOCK = json.loads(LOCK_PATH.read_text())
    if LOCK["dataset"] != dataset or LOCK["schemaVersion"] != 1:
        raise ValueError("Incompatible source profile")


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
            with urllib.request.urlopen(urllib.request.Request(expected["url"], headers={"User-Agent": "FlyGarden-connectome/1.0"}), timeout=60) as response, temporary.open("wb") as out:
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

def exact_ids(values, np):
    # Reject floating IDs even when their rounded value looks like an integer.
    if any(not isinstance(value, (str, int, np.integer)) or
           not str(value).isascii() or not str(value).isdecimal() or str(value).startswith("0") or
           not 0 < int(value) < 2**63 for value in values):
        raise ValueError("Invalid exact neuron ID mapping")
    return np.array(values, dtype=np.int64)


def select_banc_annotations(annotations):
    retained, counts, seen = [], Counter(), set()
    for row in annotations:
        identity = row["banc_888_id"]
        if not isinstance(identity, str) or not identity.isascii() or not identity.isdecimal() or identity.startswith("0") or not 0 < int(identity) < 2**63:
            raise ValueError("Invalid BANC v888 neuron ID")
        if identity in seen:
            raise ValueError("Duplicate BANC v888 mapping")
        seen.add(identity)
        if row["proofread"] not in ("TRUE", "FALSE") or row["roughly_proofread"] not in ("TRUE", "FALSE"):
            raise ValueError("Unexpected BANC proofreading flags")
        if row["super_class"] in ("glia", "trachea", "not_a_neuron"):
            counts["excludedNonNeuron"] += 1
        elif row["proofread"] == "TRUE" or row["roughly_proofread"] == "TRUE":
            if row["root_888"] != identity:
                raise ValueError("Incompatible retained BANC v888 mapping")
            counts["retainedProofread" if row["proofread"] == "TRUE" else "retainedRoughlyProofread"] += 1
            retained.append(row)
        else:
            counts["excludedUnproofread"] += 1
    return retained, dict(counts)


def import_graph(directory, destination):
    import numpy as np
    import pyarrow as pa
    import pyarrow.feather as feather

    if destination.exists():
        raise ValueError("Output already exists; use a new directory to preserve prior provenance")
    start = time.perf_counter()
    verify_sources(directory)
    if LOCK["dataset"] == "banc:v888":
        annotations = feather.read_table(directory / "annotations.feather", columns=[
            "banc_888_id", "root_888", "proofread", "roughly_proofread", "super_class",
            "neurotransmitter_predicted"]).to_pylist()
        retained, categories = select_banc_annotations(annotations)
        id_key, class_key = "banc_888_id", "super_class"
        transmitter = {int(row[id_key]): row["neurotransmitter_predicted"] or "unknown" for row in retained}
        source_counts = {"annotations": len(annotations)}
    else:
        annotations = feather.read_table(directory / "annotations.feather").to_pylist()
        retained = [row for row in annotations if row["status"] == "Traced"]
        id_key, class_key = "bodyId", "superclass"
        categories = dict(Counter(row["status"] or "null" for row in annotations))
        nt = feather.read_table(directory / "transmitters.feather", columns=["body", "consensus_nt"])
        source_counts = {"annotations": len(annotations), "transmitters": nt.num_rows}
        retained_set = {int(row[id_key]) for row in retained}
        transmitter = {}
        for batch in nt.to_batches():
            for body, value in zip(batch.column(0).to_pylist(), batch.column(1).to_pylist()):
                if body in retained_set:
                    if body in transmitter:
                        raise ValueError("Duplicate neurotransmitter body ID")
                    transmitter[body] = value or "unknown"
        del nt, retained_set
    retained.sort(key=lambda row: int(row[id_key]))
    ids = np.array([int(row[id_key]) for row in retained], dtype=np.int64)
    if not len(ids) or len(set(ids)) != len(ids) or np.any(ids <= 0):
        raise ValueError("Invalid/duplicate retained neuron IDs")
    populations = dict(Counter(row[class_key] or "null" for row in retained))
    signs = np.array([SIGN.get(transmitter.get(int(body), "unknown"), 0) for body in ids], dtype="i1")
    nt_counts = dict(Counter(transmitter.get(int(body), "unknown") for body in ids))
    del annotations, transmitter, retained

    edge_sources, edge_targets, edge_contacts = [], [], []
    counts = Counter()
    # Read one Arrow batch at a time: never materialize the full segment graph.
    with pa.memory_map(str(directory / "weights.feather"), "r") as mapped:
        reader = pa.ipc.open_file(mapped)
        edge_columns = ["pre", "post", "count", "norm", "post_count", "pre_count"] if LOCK["dataset"] == "banc:v888" else ["body_pre", "body_post", "weight"]
        if reader.schema.names != edge_columns:
            raise ValueError("Unexpected connectivity schema")
        for index in range(reader.num_record_batches):
            batch = reader.get_batch(index)
            pre, post, contacts = [batch.column(i).to_numpy(zero_copy_only=False) for i in range(3)]
            # BANC IDs arrive as decimal strings, never round through float64.
            if LOCK["dataset"] == "banc:v888":
                pre, post = [exact_ids(values, np) for values in (pre, post)]
            if not np.issubdtype(contacts.dtype, np.integer):
                if not np.all(np.isfinite(contacts)) or np.any(contacts != np.floor(contacts)):
                    raise ValueError("Non-integral synaptic-contact count")
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
        graph_lock = json.loads(GRAPH_LOCK_PATH.read_text())
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
    parser.add_argument("--dataset", choices=PROFILES, default="male-cns:v1.0")
    parser.add_argument("--sources", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    select_profile(args.dataset)
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
