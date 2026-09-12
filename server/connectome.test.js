import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSparseLif, validateGraph, LIF_MODEL } from './sparse-lif.js';
import { openConnectomeBackend } from './connectome.js';
import { connectomeProfile, neuronIdentity } from './connectome-profiles.js';

function graphFor(n, edges, signs = Array(n).fill(1)) {
  const ordered = edges.toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  return {
    ids: Array.from({ length: n }, (_, i) => String(9007199254740993n + BigInt(i))),
    offsets: Uint32Array.from(Array.from({ length: n + 1 }, (_, source) => ordered.filter(e => e[0] < source).length)),
    targets: Uint32Array.from(ordered.map(e => e[1])), contacts: Uint32Array.from(ordered.map(e => e[2])),
    signs: Int8Array.from(signs),
  };
}

test('retains exact string IDs, rejects malformed graph structure and probes', () => {
  const graph = graphFor(3, [[0, 1, 500]]);
  assert.equal(graph.ids[0], '9007199254740993');
  assert.throws(() => validateGraph({ ...graph, ids: ['1', '1', '2'] }));
  assert.throws(() => validateGraph({ ...graph, ids: ['1', , '3'] }));
  assert.throws(() => validateGraph({ ...graph, offsets: Uint32Array.from([0, 1, 0, 1]) }));
  assert.throws(() => validateGraph({ ...graph, targets: Uint32Array.of(3) }));
  assert.throws(() => validateGraph({ ...graph, contacts: Uint32Array.of(0) }));
  assert.throws(() => validateGraph({ ...graph, offsets: [0, NaN, 1, 1] }), /array types/);
  assert.throws(() => validateGraph({ ...graph, targets: Float64Array.of(0.5) }), /array types/);
  assert.throws(() => validateGraph({ ...graph, contacts: [Infinity] }), /array types/);
  const model = createSparseLif(graph);
  assert.throws(() => model.seedProbe([0, 0]));
  assert.throws(() => model.seedProbe([3]));
  assert.throws(() => model.seedProbe([0.5]));
  assert.throws(() => model.seedProbe(Array(1)));
  assert.equal(model.summary().spikes, 0);
  model.seedProbe([0]);
  model.step();
  assert.throws(() => model.seedProbe([1]));
});

test('one-step transmission delay, two full refractory steps, and silence without drive', () => {
  const model = createSparseLif(graphFor(3, [[0, 1, 1000], [1, 2, 1000], [2, 0, 1000]]));
  for (let i = 0; i < 10; i++) model.step();
  assert.equal(model.summary().totalSpikes, 0);
  const cascade = createSparseLif(graphFor(3, [[0, 1, 1000], [1, 2, 1000], [2, 0, 1000]]));
  cascade.seedProbe([0]);
  for (let tick = 1; tick <= 6; tick++) {
    cascade.step();
    assert.deepEqual([...cascade.inspect().firing], Array.from({ length: 3 }, (_, i) => Number(i === tick % 3)));
  }
  const self = createSparseLif(graphFor(1, [[0, 0, 5000]]));
  self.seedProbe([0]);
  self.step();
  assert.equal(self.inspect().potential[0], 0); // Incoming jump discarded during refractory interval.
  assert.equal(self.inspect().refractory[0], 1);
  self.step();
  assert.equal(self.inspect().refractory[0], 0);
  assert.equal(self.summary().totalSpikes, 0);
});

test('analytic exponential decay agrees at 1e-12, inhibitory and unknown mappings disclosed', () => {
  const model = createSparseLif(graphFor(4, [[0, 3, 250], [1, 3, 500], [2, 3, 100000]], [1, -1, 0, 1]));
  model.seedProbe([0, 1, 2]);
  for (let tick = 1; tick <= 100; tick++) {
    model.step();
    const expected = -0.25 * Math.exp(-(tick - 1) / 20);
    assert.ok(Math.abs(model.inspect().potential[3] - expected) < 1e-12);
  }
  assert.equal(model.summary().traversedEdges, 3); // Includes anatomically retained zero-efficacy edge.
});

test('independent timestamped event reference agrees on spikes, refractory periods and voltage', () => {
  const edges = [[0, 1, 1200], [0, 3, 600], [1, 2, 1500], [2, 0, 1200], [2, 3, 650], [3, 1, 300]];
  const signs = [1, 1, 1, -1];
  const model = createSparseLif(graphFor(4, edges, signs));
  model.seedProbe([0]);
  const voltage = Array(4).fill(0), blockedUntil = [2, 0, 0, 0];
  const arrivals = new Map();
  const schedule = (source, at) => {
    for (const [from, to, contacts] of edges) {
      if (from !== source) continue;
      if (!arrivals.has(at)) arrivals.set(at, []);
      arrivals.get(at).push({ to, jump: signs[from] * contacts / 1000 });
    }
  };
  schedule(0, 1);
  let maxError = 0;
  for (let time = 1; time <= 120; time++) {
    const spike = Array(4).fill(0);
    for (let neuron = 0; neuron < 4; neuron++) {
      if (time <= blockedUntil[neuron]) voltage[neuron] = 0;
      else {
        voltage[neuron] /= Math.exp(1 / 20);
        for (const event of arrivals.get(time) ?? []) if (event.to === neuron) voltage[neuron] += event.jump;
        if (voltage[neuron] >= 1) {
          spike[neuron] = 1;
          voltage[neuron] = 0;
          blockedUntil[neuron] = time + 2;
          schedule(neuron, time + 1);
        }
      }
    }
    arrivals.delete(time);
    model.step();
    const actual = model.inspect();
    assert.deepEqual([...actual.firing], spike);
    assert.deepEqual([...actual.refractory], blockedUntil.map(until => Math.max(0, until - time)));
    for (let i = 0; i < 4; i++) maxError = Math.max(maxError, Math.abs(actual.potential[i] - voltage[i]));
  }
  assert.ok(maxError < 1e-12, `maximum voltage error ${maxError}`);
  assert.equal(LIF_MODEL.delaySteps, 1);
});

test('missing/incompatible data stays unavailable and never creates a fixture', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fly-connectome-test-'));
  try {
    for (const manifest of [null, '{"schemaVersion":999,"dataset":"pretend"}']) {
      if (manifest) await writeFile(join(directory, 'manifest.json'), manifest);
      const backend = await openConnectomeBackend(directory);
      try {
        assert.equal(backend.ready.status, 'unavailable');
        assert.equal(backend.ready.source, 'connectome');
        assert.equal(backend.ready.available, false);
        assert.equal(backend.ready.provenance, null);
        assert.equal(backend.ready.neural, null);
        await assert.rejects(backend.start(), /unavailable/);
        await assert.rejects(backend.advance(1), /unavailable/);
        await assert.rejects(backend.probe([() => {}]), /serialized/);
        assert.equal((await backend.snapshot()).status, 'unavailable');
      } finally {
        await backend.close();
      }
      await assert.rejects(backend.snapshot(), /closed/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('profile identity keeps equal numeric IDs isolated and rejects cross-profile graph mappings', () => {
  const maleId = neuronIdentity('male-cns:v1.0', '9007199254740993');
  const bancId = neuronIdentity('banc:v888', '9007199254740993');
  assert.notEqual(maleId, bancId);
  assert.throws(() => neuronIdentity('banc:v888', 9007199254740993));
  for (const invalid of ['__proto__', '../graph.lock.json', 'flywire:v783', null]) {
    assert.throws(() => connectomeProfile(invalid));
  }
  const base = graphFor(2, [[0, 1, 250]]);
  const graph = dataset => ({ ...base, ids: base.ids.map(id => neuronIdentity(dataset, id)) });
  const male = createSparseLif(graph('male-cns:v1.0'));
  const banc = createSparseLif(graph('banc:v888'));
  assert.throws(() => validateGraph({ ...base, ids: [maleId, bancId] }));
  male.seedProbe([0]);
  for (let i = 0; i < 100; i++) {
    male.step();
    banc.step();
    assert.ok(Math.abs(male.inspect().potential[1] - 0.25 * Math.exp(-i / 20)) < 1e-12);
    assert.equal(banc.inspect().potential[1], 0);
    assert.equal(banc.summary().totalSpikes, 0);
  }
});

test('BANC and unknown profiles fail independently without affecting another worker', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fly-profile-test-'));
  const male = await openConnectomeBackend(directory);
  try {
    for (const dataset of ['banc:v888', '__proto__']) {
      const banc = await openConnectomeBackend(directory, { dataset });
      try {
        assert.equal(banc.ready.status, 'unavailable');
        assert.equal(banc.ready.dataset, dataset);
        assert.equal(banc.ready.provenance, null);
        assert.equal(banc.ready.model, null);
        await assert.rejects(banc.start());
      } finally {
        await banc.close();
      }
      assert.equal((await male.snapshot()).dataset, 'male-cns:v1.0');
    }
  } finally {
    await male.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('real worker opening can be terminated before readiness and confirms exit', async () => {
  let exits=0;
  const opening=openConnectomeBackend('/nonexistent/never-loaded',{onExit:()=>{exits++;}});
  assert.equal(typeof opening.terminate,'function');assert.ok(opening.terminated instanceof Promise);
  const readiness=assert.rejects(opening,/stopped/);
  await opening.terminate();await readiness;await opening.terminated;assert.equal(exits,1);
});
