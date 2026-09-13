#!/usr/bin/env python3
"""Export pinned L1/L2/DNa02 annotation metadata. Never reads weights or runs a model."""
import argparse
import hashlib
import json
from pathlib import Path
import pyarrow.feather as feather

parser = argparse.ArgumentParser()
parser.add_argument('--dataset', choices=['male-cns:v1.0', 'banc:v888'], required=True)
parser.add_argument('--annotations', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
male = args.dataset == 'male-cns:v1.0'
lock = json.loads((root / 'connectome' / ('malecns-v1.lock.json' if male else 'banc-v888.lock.json')).read_text())
source = lock['files']['annotations']
hash_value = hashlib.sha256()
with open(args.annotations, 'rb') as stream:
    for block in iter(lambda: stream.read(1024 * 1024), b''):
        hash_value.update(block)
if Path(args.annotations).stat().st_size != source['bytes'] or hash_value.hexdigest() != source['sha256']:
    raise ValueError('Pinned annotation hash or size mismatch')
columns = ['bodyId', 'status', 'type', 'somaSide', 'assignedOlHex1', 'assignedOlHex2'] if male else ['banc_888_id', 'root_888', 'proofread', 'roughly_proofread', 'super_class', 'cell_type', 'side']
rows = []
for row in feather.read_table(args.annotations, columns=columns, memory_map=True).to_pylist():
    retained = row['status'] == 'Traced' if male else (row['proofread'] == 'TRUE' or row['roughly_proofread'] == 'TRUE') and row['super_class'] not in ['glia', 'trachea', 'not_a_neuron']
    cell_type = row['type' if male else 'cell_type']
    if not retained or cell_type not in ['L1', 'L2', 'DNa02']:
        continue
    if not male and row['banc_888_id'] != row['root_888']:
        raise ValueError('BANC materialization mismatch')
    side = row['somaSide' if male else 'side']
    rows.append({'neuronId': args.dataset + '/' + str(row['bodyId' if male else 'banc_888_id']), 'type': cell_type,
                 'side': {'L': 'left', 'R': 'right'}.get(side, side),
                 'hex': [row['assignedOlHex1'], row['assignedOlHex2']] if male and cell_type != 'DNa02' else None})
print(json.dumps({'dataset': args.dataset, 'annotationSha256': source['sha256'], 'rows': rows}, separators=(',', ':')))
