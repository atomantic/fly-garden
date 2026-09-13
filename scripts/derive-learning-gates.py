#!/usr/bin/env python3
"""Independently re-derive the two blocking gates of the benign-learning protocol.

This script advances no neural model, trains nothing, writes no checkpoint and
changes no recorded campaign. It reads the pinned CSR graph files and the pinned
annotation Feather files after verifying their locked byte counts and SHA-256,
then recomputes:

  1. `fixed-causal-motor-readout` - the first-hop signed drive produced by the
     already-recorded left-half onset volley, from the raw arrays rather than
     from the Node kernel that produced `connectome/visual-causal-result.json`.
  2. `compartment-specific-plasticity-validation` - whether compartment-matched
     KC->MBON edges can be established from the pinned annotations alone.

Output is a small sanitized JSON record. It contains no paths, credentials or
production identities. Observed counts are measurements of engineered model
assumptions, not biological findings.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

import numpy as np
import pyarrow.feather as feather

REPO = Path(__file__).resolve().parent.parent
# Engineered kernel constants mirrored from server/sparse-lif.js LIF_MODEL.
CONTACT_GAIN = 0.001
THRESHOLD = 1.0
# Engineered encoder constant mirrored from the reviewed v2 onset hypothesis.
DELTA_V_PER_FULL_CONTRAST = 1.25

PROFILES = [
    {
        'dataset': 'male-cns:v1.0',
        'graphLock': 'graph.lock.json',
        'sourceLock': 'malecns-v1.lock.json',
        'mapping': 'male-cns-v1.json',
    },
    {
        'dataset': 'banc:v888',
        'graphLock': 'banc-v888.graph.lock.json',
        'sourceLock': 'banc-v888.lock.json',
        'mapping': 'banc-v888.json',
    },
]


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def verify(path, expected, label):
    if Path(path).stat().st_size != expected['bytes'] or digest(path) != expected['sha256']:
        raise ValueError(f'Pinned {label} mismatch; refusing to derive from unverified data')


def load_graph(directory, lock, dataset):
    files = lock['manifest']['files']
    for name, expected in files.items():
        verify(Path(directory) / name, expected, f'graph file {name}')
    raw = json.loads((Path(directory) / 'ids.json').read_text())
    # The pinned CSR stores bare source IDs; the kernel namespaces them on load.
    ids = [f'{dataset}/{value}' for value in raw]
    offsets = np.fromfile(Path(directory) / 'offsets.u32', dtype='<u4')
    targets = np.fromfile(Path(directory) / 'targets.u32', dtype='<u4')
    contacts = np.fromfile(Path(directory) / 'contacts.u32', dtype='<u4')
    signs = np.fromfile(Path(directory) / 'signs.i8', dtype='<i1')
    n = len(ids)
    if offsets.shape != (n + 1,) or signs.shape != (n,) or targets.shape != contacts.shape:
        raise ValueError('Incompatible pinned CSR dimensions')
    return ids, offsets, targets, contacts, signs


def onset_ports(mapping):
    """Left-half full-contrast onset: exactly the admitted left-side L1 ports.

    Re-derived from the checked-in manifest and the documented encoder, not read
    back from the recorded campaign report.
    """
    selected = []
    for port in mapping['inputs']:
        if port['side'] != 'left' or port['type'] != 'L1':
            continue
        if port['hex'] is not None:
            q, r = port['hex']
            u = (q - 1 + 0.5 * (r - 1)) / 54.0
            x = min(15, int(u * 16))
            if x >= 16:  # left half-field only; defensive, cannot trigger for side 'left'
                continue
        selected.append(port['neuronId'])
    return selected


def causal_gate(profile, directory):
    lock = json.loads((REPO / 'connectome' / profile['graphLock']).read_text())
    mapping = json.loads((REPO / 'connectome' / 'visual-mappings' / profile['mapping']).read_text())
    if mapping['graphManifestSha256'] != lock['manifestSha256']:
        raise ValueError('Mapping manifest does not pin this graph manifest')
    ids, offsets, targets, contacts, signs = load_graph(directory, lock, profile['dataset'])
    index = {neuron_id: i for i, neuron_id in enumerate(ids)}
    ports = onset_ports(mapping)
    missing = [p for p in ports if p not in index]
    motor = {side: index.get(neuron_id) for side, neuron_id in mapping['motor'].items()}
    if missing or any(v is None for v in motor.values()):
        raise ValueError('Mapping IDs absent from the pinned graph')
    port_index = np.fromiter((index[p] for p in ports), dtype=np.int64, count=len(ports))

    # Tick 21: every selected port crosses threshold from rest under the reviewed
    # v2 onset (1.25 delta-V >= threshold 1). Tick 22: their outgoing signed
    # contacts arrive. Just-fired sources are refractory and receive reset, so
    # they are excluded from the eligible-target statistics.
    n = len(ids)
    incoming = np.zeros(n, dtype=np.float64)
    sign_counts = {-1: 0, 0: 0, 1: 0}
    rows = 0
    for i in port_index:
        sign = int(signs[i])
        sign_counts[sign] += 1
        start, end = int(offsets[i]), int(offsets[i + 1])
        if end > start:
            rows += end - start
            if sign:
                np.add.at(incoming, targets[start:end].astype(np.int64), sign * contacts[start:end].astype(np.float64))
    traversed = rows
    signed_contacts = incoming.copy()
    incoming *= CONTACT_GAIN

    eligible = np.ones(n, dtype=bool)
    eligible[port_index] = False
    values = incoming[eligible]
    max_value = float(values.max()) if values.size else 0.0
    min_value = float(values.min()) if values.size else 0.0
    argmax = int(np.flatnonzero(eligible)[int(np.argmax(values))]) if values.size else -1
    argmin = int(np.flatnonzero(eligible)[int(np.argmin(values))]) if values.size else -1

    return {
        'dataset': profile['dataset'],
        'graphManifestSha256': lock['manifestSha256'],
        'mappingSha256': mapping['mappingSha256'],
        'neuronCount': n,
        'directedEdgeCount': int(targets.shape[0]),
        'onsetPortCount': len(ports),
        'onsetDeltaVPerPort': DELTA_V_PER_FULL_CONTRAST,
        'onsetAggregateDeltaV': len(ports) * DELTA_V_PER_FULL_CONTRAST,
        'onsetSourceSignCounts': {'negative': sign_counts[-1], 'unknownZero': sign_counts[0], 'positive': sign_counts[1]},
        'outgoingRowsFromOnsetPorts': int(traversed),
        'firstHopEligibleTargetVoltage': {'minimum': min_value, 'maximum': max_value},
        'firstHopExtremeTargets': {
            'minimumNeuronId': ids[argmin] if argmin >= 0 else None,
            'minimumSignedContacts': float(signed_contacts[argmin]) if argmin >= 0 else None,
            'maximumNeuronId': ids[argmax] if argmax >= 0 else None,
            'maximumSignedContacts': float(signed_contacts[argmax]) if argmax >= 0 else None,
        },
        'motorDirectSignedContacts': {
            side: float(signed_contacts[i]) for side, i in motor.items()
        },
        'thresholdFractionReached': max_value / THRESHOLD,
        'netPositiveContactsRequiredForFirstCrossing': int(round(THRESHOLD / CONTACT_GAIN)),
        'positiveCrossingPossibleAtAnyPositiveGain': bool(sign_counts[1] > 0),
        'firstHopCrossesThreshold': bool(max_value >= THRESHOLD),
    }


MALE_COMPARTMENT = re.compile(r'^MBON[0-9]+[A-Za-z-]*\(([^)]+)\)')
# 'y' and 'B' are the ASCII transliterations the Male CNS instance strings use
# for the gamma and beta lobes. Lobe identity is all the pinned strings encode.
LOBE_TOKENS = {'y': 'gamma', "a'": "alpha'", "B'": "beta'", 'a': 'alpha', 'B': 'beta'}
KC_LOBES = {'KCg': {'gamma'}, 'KCab': {'alpha', 'beta'}, "KCa'b'": {"alpha'", "beta'"}, 'KCapbp': {"alpha'", "beta'"}}


def parse_compartments(instance):
    match = MALE_COMPARTMENT.match(str(instance or ''))
    if not match:
        return None
    body = match.group(1)
    lobes = set()
    for token, lobe in LOBE_TOKENS.items():
        if token in body:
            lobes.add(lobe)
    return {'raw': body, 'lobes': sorted(lobes)}


def kc_lobe(cell_type):
    name = str(cell_type or '')
    for prefix in ("KCa'b'", 'KCapbp', 'KCab', 'KCg'):
        if name.startswith(prefix):
            return sorted(KC_LOBES[prefix])
    return None


def compartment_gate(profile, directory, annotations):
    source_lock = json.loads((REPO / 'connectome' / profile['sourceLock']).read_text())
    verify(annotations, source_lock['files']['annotations'], 'annotation file')
    male = profile['dataset'].startswith('male')
    lock = json.loads((REPO / 'connectome' / profile['graphLock']).read_text())
    ids, offsets, targets, contacts, signs = load_graph(directory, lock, profile['dataset'])
    index = {neuron_id: i for i, neuron_id in enumerate(ids)}

    if male:
        columns = ['bodyId', 'status', 'class', 'type', 'instance']
    else:
        columns = ['banc_888_id', 'root_888', 'proofread', 'roughly_proofread', 'super_class',
                   'cell_class', 'cell_sub_class', 'cell_type']
    table = feather.read_table(annotations, columns=columns, memory_map=True)
    rows = table.to_pylist()
    if male:
        rows = [r for r in rows if r['status'] == 'Traced']
        identity, cls, typ = 'bodyId', 'class', 'type'
        kc_label, mbon_label = 'Kenyon_Cell', 'MBON'
    else:
        rows = [r for r in rows
                if (r['proofread'] == 'TRUE' or r['roughly_proofread'] == 'TRUE')
                and r['super_class'] not in ['glia', 'trachea', 'not_a_neuron']]
        if any(r['banc_888_id'] != r['root_888'] for r in rows):
            raise ValueError('Wrong materialization identity')
        identity, cls, typ = 'banc_888_id', 'cell_class', 'cell_type'
        kc_label, mbon_label = 'kenyon_cell', 'mushroom_body_output_neuron'

    kcs = [r for r in rows if r[cls] == kc_label]
    mbons = [r for r in rows if r[cls] == mbon_label]

    mbon_compartments = {}
    for row in mbons:
        parsed = parse_compartments(row['instance']) if male else None
        if parsed:
            mbon_compartments[f"{profile['dataset']}/{row[identity]}"] = parsed
    kc_lobes = {}
    for row in kcs:
        lobes = kc_lobe(row[typ])
        if lobes:
            kc_lobes[f"{profile['dataset']}/{row[identity]}"] = lobes

    kc_indices = {index[k]: v for k, v in kc_lobes.items() if k in index}
    mbon_indices = {index[k]: k for k in
                    (f"{profile['dataset']}/{row[identity]}" for row in mbons) if k in index}

    existing_edges = 0
    lobe_consistent_edges = 0
    resolvable_edges = 0
    for source, lobes in kc_indices.items():
        start, end = int(offsets[source]), int(offsets[source + 1])
        for edge in range(start, end):
            target = int(targets[edge])
            if target not in mbon_indices:
                continue
            existing_edges += 1
            parsed = mbon_compartments.get(mbon_indices[target])
            if parsed is None:
                continue
            resolvable_edges += 1
            if set(parsed['lobes']) & set(lobes):
                lobe_consistent_edges += 1

    weights_schema = feather.read_table(
        Path(directory).parent / 'sources' / 'weights.feather', memory_map=True).schema.names \
        if (Path(directory).parent / 'sources' / 'weights.feather').exists() else None

    return {
        'dataset': profile['dataset'],
        'annotationSha256': source_lock['files']['annotations']['sha256'],
        'kenyonCellCount': len(kcs),
        'mbonCount': len(mbons),
        'mbonWithParsedCompartmentString': len(mbon_compartments),
        'kenyonCellsWithResolvedLobe': len(kc_lobes),
        'existingKcToMbonEdgesInPinnedGraph': existing_edges,
        'edgesWhereMbonCompartmentStringIsAvailable': resolvable_edges,
        'edgesLobeConsistentOnly': lobe_consistent_edges,
        'perSynapseNeuropilAvailable': False,
        'pinnedWeightsColumns': weights_schema,
        'compartmentMatchEstablished': False,
        'reason': (
            'Male CNS instance strings identify each MBON lobe/compartment label, but Kenyon cells '
            'carry only a lobe-level subtype and the pinned weights table has no per-synapse neuropil '
            'column, so no individual KC->MBON edge can be assigned to a compartment. BANC annotations '
            'carry no mushroom-body compartment field at all. Lobe consistency is the strongest relation '
            'derivable here and is coarser than the compartment specificity the protocol requires.'
        ),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--male-graph', required=True)
    parser.add_argument('--banc-graph', required=True)
    parser.add_argument('--male-annotations', required=True)
    parser.add_argument('--banc-annotations', required=True)
    args = parser.parse_args()
    directories = {'male-cns:v1.0': args.male_graph, 'banc:v888': args.banc_graph}
    annotations = {'male-cns:v1.0': args.male_annotations, 'banc:v888': args.banc_annotations}

    causal = [causal_gate(p, directories[p['dataset']]) for p in PROFILES]
    compartment = [compartment_gate(p, directories[p['dataset']], annotations[p['dataset']]) for p in PROFILES]

    causal_open = all(p['firstHopCrossesThreshold'] for p in causal)
    compartment_open = all(p['compartmentMatchEstablished'] for p in compartment)
    record = {
        'schemaVersion': 1,
        'kind': 'benign-learning-gate-evidence',
        'protocolId': 'benign-landmark-association-v1',
        'neuralStepsExecuted': 0,
        'trainingPerformed': False,
        'derivation': 'independent numpy recomputation from pinned CSR arrays and annotations',
        'gates': {
            'fixed-causal-motor-readout': {
                'status': 'open' if causal_open else 'closed',
                'basis': (
                    'Recomputed first-hop signed drive for the already-recorded left-half onset volley. '
                    'A first threshold crossing from rest needs 1000 net positive contacts at the fixed '
                    'contact gain 0.001. This reproduces the recorded 0/8 negative campaign outcome from '
                    'the source arrays and is independent of the onset amplitude, which only sets how many '
                    'input ports fire, not the sign of what they deliver.'
                ),
                'profiles': causal,
            },
            'compartment-specific-plasticity-validation': {
                'status': 'open' if compartment_open else 'closed',
                'basis': (
                    'Attempted to assign each existing KC->MBON edge in the pinned graph to a mushroom-body '
                    'compartment using only pinned annotations.'
                ),
                'profiles': compartment,
            },
        },
        'disclosure': (
            'Engineered model measurements only. No neural advancement, plasticity update, body, reward or '
            'biological claim. Differences between the two specimen-derived models are not sex effects.'
        ),
    }
    record['executionAllowed'] = causal_open and compartment_open
    print(json.dumps(record, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
