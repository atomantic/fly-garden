"""Original offline anatomical-point importer. Reads annotations only; never runs a model."""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import shutil
import struct
import tempfile
import time

from connectome import select_banc_annotations

ROOT = Path(__file__).resolve().parents[1]
PROFILES = {
    "male-cns:v1.0": {"sourceLock": "malecns-v1.lock.json", "graphLock": "graph.lock.json", "coordinateField": "somaLocation", "pointKind": "soma", "sourceUnits": "8nm voxels", "scaleToMicrometers": [0.008, 0.008, 0.008],
        "coordinateEvidence": ["https://male-cns.janelia.org/download/", "https://github.com/natverse/malecns/blob/daf8e2a9849cc77695b14bb6b9d4c02456cd3b3c/R/xyz.R", "https://natverse.org/malecns/reference/mcns_soma_side.html"],
        "columns": ["bodyId", "status", "somaLocation", "somaNeuromere", "superclass", "type", "class"]},
    "banc:v888": {"sourceLock": "banc-v888.lock.json", "graphLock": "banc-v888.graph.lock.json", "coordinateField": "root_position_nm", "pointKind": "root-representative", "sourceUnits": "nm", "scaleToMicrometers": [0.001, 0.001, 0.001],
        "coordinateEvidence": ["https://dataverse.harvard.edu/api/datasets/:persistentId/versions/3.0?persistentId=doi:10.7910/DVN/7WTH1N", "https://dataverse.harvard.edu/api/access/datafile/14033740"],
        "columns": ["banc_888_id", "root_888", "proofread", "roughly_proofread", "root_position_nm", "region", "super_class", "cell_type"]},
}
GROUPS = ["visual-system", "central-brain", "ventral-nerve-cord", "interregional", "unknown"]
NODE_COLUMNS = ["id", "rawId", "type", "superclass", "region", "positionStatus"]
FILES = ["positions.f32", "valid.u8", "groups.u8", "nodes.json"]
MAX_NODES = 250000
MAX_METADATA_BYTES = 64 * 1024 * 1024


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def encoded(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()


def parse_position(value, dataset):
    """Missing/malformed positions stay missing, with an explicit reason and zero mask."""
    if value is None or value == "":
        return None, "missing"
    if dataset == "banc:v888":
        if not isinstance(value, str):
            return None, "invalid-coordinate"
        try:
            value = [float(part.strip()) for part in value.split(",")]
        except ValueError:
            return None, "invalid-coordinate"
    if not isinstance(value, list) or len(value) != 3 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 or v > 1e9 for v in value):
        return None, "invalid-coordinate"
    scale = PROFILES[dataset]["scaleToMicrometers"]
    return [value[i] * scale[i] for i in range(3)], PROFILES[dataset]["pointKind"]


def category(dataset, superclass, region):
    interregional = {"ascending_neuron", "descending_neuron", "efferent_ascending", "efferent_descending", "sensory_ascending", "sensory_ascending_tbc", "sensory_descending", "ascending", "descending", "ascending_visceral_circulatory"}
    if superclass in interregional:
        return 3
    if dataset == "male-cns:v1.0":
        if superclass and (superclass.startswith("ol_") or superclass.startswith("visual_")):
            return 0
        if superclass and superclass.startswith("cb_"):
            return 1
        if superclass and superclass.startswith("vnc_"):
            return 2
    else:
        if region == "optic_lobe":
            return 0
        if region == "central_brain":
            return 1
        if region == "ventral_nerve_cord":
            return 2
    return 4


def label(value):
    if value is None:
        return ""
    if not isinstance(value, str) or len(value) > 1024:
        raise ValueError("Invalid annotation label")
    return value


def prepare_rows(rows, dataset):
    if dataset not in PROFILES or not isinstance(rows, list) or len(rows) > MAX_NODES:
        raise ValueError("Invalid atlas population or profile")
    if dataset == "male-cns:v1.0":
        retained = [row for row in rows if row["status"] == "Traced"]
        for row in rows:
            if type(row["bodyId"]) is not int or not 0 < row["bodyId"] < 2**63:
                raise ValueError("Invalid exact MaleCNS ID")
        if len({row["bodyId"] for row in rows}) != len(rows):
            raise ValueError("Duplicate MaleCNS ID")
        raw_id = lambda row: str(row["bodyId"])
    else:
        retained, _ = select_banc_annotations(rows)
        raw_id = lambda row: row["banc_888_id"]
    retained.sort(key=lambda row: int(raw_id(row)))
    nodes, positions, valid, groups = [], bytearray(), bytearray(), bytearray()
    bounds = {name: None for name in ["whole", "brain", "cord", *GROUPS]}
    counts, missing = Counter(), Counter()
    for row in retained:
        identity = raw_id(row)
        superclass = label(row.get("superclass" if dataset == "male-cns:v1.0" else "super_class"))
        region = label(row.get("somaNeuromere" if dataset == "male-cns:v1.0" else "region"))
        cell_type = label(row.get("type" if dataset == "male-cns:v1.0" else "cell_type"))
        group = category(dataset, superclass, region)
        point, status = parse_position(row[PROFILES[dataset]["coordinateField"]], dataset)
        nodes.append([f"{dataset}/{identity}", identity, cell_type, superclass, region, status])
        groups.append(group)
        valid.append(1 if point is not None else 0)
        counts[GROUPS[group]] += 1
        if point is None:
            missing[status] += 1
            positions.extend(struct.pack("<fff", 0, 0, 0))
            continue
        # Round once to the exact Float32 representation used by the renderer and bounds.
        packed = struct.pack("<fff", *point)
        positions.extend(packed)
        point = struct.unpack("<fff", packed)
        presets = ["whole", GROUPS[group]]
        if group in (0, 1) or (dataset == "banc:v888" and region in ("optic_lobe", "central_brain")):
            presets.append("brain")
        if group == 2 or (dataset == "banc:v888" and region == "ventral_nerve_cord"):
            presets.append("cord")
        for name in presets:
            box = bounds[name]
            if box is None:
                bounds[name] = {"min": list(point), "max": list(point)}
            else:
                for axis in range(3):
                    box["min"][axis] = min(box["min"][axis], point[axis])
                    box["max"][axis] = max(box["max"][axis], point[axis])
    data = {"positions.f32": bytes(positions), "valid.u8": bytes(valid), "groups.u8": bytes(groups), "nodes.json": encoded(nodes)}
    if len(data["nodes.json"]) > MAX_METADATA_BYTES:
        raise ValueError("Atlas metadata byte limit exceeded")
    return data, {"sourceRows": len(rows), "retained": len(nodes), "positioned": sum(valid), "missing": len(nodes) - sum(valid), "groups": {name: counts[name] for name in GROUPS}, "missingReasons": dict(missing)}, bounds


def import_atlas(dataset, annotations, destination):
    import pyarrow.feather as feather
    if dataset not in PROFILES:
        raise ValueError("Unsupported atlas profile")
    profile = PROFILES[dataset]
    source_lock_path = ROOT / "connectome" / profile["sourceLock"]
    source_lock = json.loads(source_lock_path.read_text())
    expected = source_lock["files"]["annotations"]
    annotations, destination = Path(annotations), Path(destination)
    if destination.exists():
        raise ValueError("Atlas output already exists; preserve its lineage and choose a new directory")
    if annotations.stat().st_size != expected["bytes"] or digest(annotations) != expected["sha256"]:
        raise ValueError("Atlas source hash/size does not match pinned annotations")
    start = time.perf_counter()
    rows = feather.read_table(annotations, columns=profile["columns"]).to_pylist()
    data, counts, bounds = prepare_rows(rows, dataset)
    graph_lock = json.loads((ROOT / "connectome" / profile["graphLock"]).read_text())
    ids = [row[1] for row in json.loads(data["nodes.json"])]
    # Exact ordered IDs must agree with the existing graph importer lock.
    graph_ids = encoded(ids) + b"\n"
    if counts["retained"] != graph_lock["manifest"]["neuronCount"] or hashlib.sha256(graph_ids).hexdigest() != graph_lock["manifest"]["files"]["ids.json"]["sha256"]:
        raise ValueError("Atlas IDs do not match the declared retained graph")
    manifest = {"schemaVersion": 1, "kind": "anatomical-point-atlas", "dataset": dataset,
        "pointKind": profile["pointKind"], "source": {"url": expected["url"], "bytes": expected["bytes"], "sha256": expected["sha256"], "sourceLockSha256": digest(source_lock_path),
            "license": source_lock["license"], "licenseUrl": source_lock["licenseUrl"], "attribution": source_lock["attribution"], "selection": source_lock["selection"]},
        "graphManifestSha256": graph_lock["manifestSha256"], "coordinates": {"field": profile["coordinateField"], "sourceUnits": profile["sourceUnits"], "units": "micrometers",
            "scale": profile["scaleToMicrometers"], "translation": [0, 0, 0], "axisOrder": ["x", "y", "z"], "frame": f"{dataset}:native-EM",
            "orientation": "Native source X/Y/Z axes preserved; anatomical direction labels not independently established. No reflection, cross-specimen registration or inferred coordinates.", "evidence": profile["coordinateEvidence"]},
        "nodeColumns": NODE_COLUMNS, "groups": GROUPS, "counts": counts, "bounds": bounds,
        "missingEncoding": "valid.u8=0 means absent; associated zero position bytes are storage padding and must never be displayed as a neuron",
        "disclosure": "Anatomical point locations only. Straight connection lines are not neurite morphology. No activity, learning, motor control or complete peripheral coverage is established.",
        "files": {name: {"bytes": len(value), "sha256": hashlib.sha256(value).hexdigest()} for name, value in data.items()}}
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".atlas-", dir=destination.parent))
    try:
        for name, value in data.items():
            (staging / name).write_bytes(value)
        (staging / "manifest.json").write_bytes(encoded(manifest))
        staging.rename(destination)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return {"manifestSha256": digest(destination / "manifest.json"), "manifest": manifest, "importSeconds": time.perf_counter() - start}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", choices=PROFILES, required=True)
    parser.add_argument("--annotations", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(import_atlas(args.dataset, args.annotations, args.output), indent=2))
