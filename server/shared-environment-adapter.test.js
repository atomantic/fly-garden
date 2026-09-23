import test from 'node:test';
import assert from 'node:assert/strict';
import { createSparseLif } from './sparse-lif.js';
import { createConnectomeSharedSession } from './connectome-shared-session.js';
import { ADAPTER_CHANNELS, connectomeDeclaration, createSharedEnvironmentAdapter, describeDeclarations, SHARED_ADAPTER_CONTRACT,
  validateDeclaration } from './shared-environment-adapter.js';

const off = { sensoryMotor: false, embodiment: false, chemistry: false, learning: false };
const on = { ...off, sensoryMotor: true };
const declare = (individualId, fields = {}) => ({ contractVersion: 1, individualId, sessionEpoch: `epoch-${individualId}`, backend: 'synthetic-double',
  inputs: ['visual-frame', 'contact-proxy'], outputs: ['motor-proposal'], capabilities: on, ...fields });
const code = expected => error => { assert.equal(error.code, expected); return true; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const dark = () => ({ width: 8, height: 4, luminance: Array(32).fill(0) });
const bright = () => ({ width: 8, height: 4, luminance: Array(32).fill(255) });
// A tiny named four-neuron graph: 0→1→2→3→0. No pinned dataset is ever loaded here.
const graph = () => ({ ids: ['1', '2', '3', '4'], offsets: new Uint32Array([0, 1, 2, 3, 4]), targets: new Uint32Array([1, 2, 3, 0]),
  contacts: new Uint32Array([3, 3, 3, 3]), signs: new Int8Array([1, 1, 1, 1]) });

/** Transactional synthetic double: an explicit engineered map from declared channels to one
 * sparse input per substep, staged on a candidate kernel and committed only on request. */
function tinyDouble(individualId, { delays = [], motor = true, stage: override, commit: commitFault, rollback: rollbackFault } = {}) {
  let kernel = createSparseLif(graph(), { individualId }), previous = null, staged = null, calls = 0;
  const requests = [], log = [];
  const key = ref => `${ref.worldEpoch}:${ref.worldTick}`;
  const backend = {
    async stage(request) {
      requests.push(request); const call = calls++;
      await delay(delays[call] ?? 0);
      if (override) { const value = override(request, call); if (value !== undefined) return value; }
      const candidate = createSparseLif(graph(), { individualId, checkpoint: kernel.checkpoint() });
      const luminance = request.channels['visual-frame']?.luminance ?? [];
      const drive = luminance.reduce((sum, value) => sum + value, 0) / (32 * 255);
      const contact = request.channels['contact-proxy']?.magnitude ?? 0;
      for (let step = 0; step < request.substeps; step++) {
        candidate.step([...(drive > 0 ? [{ index: 0, deltaV: 1.2 * drive }] : []), ...(contact > 0 ? [{ index: 2, deltaV: 1.2 * contact }] : [])]);
      }
      staged = { key: key(request), candidate };
      const summary = candidate.summary();
      return { individualId, sessionEpoch: request.sessionEpoch, worldTick: request.worldTick, neural: { tick: summary.tick, simTimeMs: summary.simTimeMs },
        proposal: motor ? { forward: Math.min(0.12, summary.totalSpikes * 0.01), yaw: 0 } : null };
    },
    async commit(ref) {
      log.push(['commit', individualId]);
      if (commitFault?.()) throw new Error('commit failed');
      if (staged?.key !== key(ref)) throw new Error('foreign commit');
      previous = kernel; kernel = staged.candidate; staged = null;
    },
    async rollback() { log.push(['rollback', individualId]); if (rollbackFault?.()) throw new Error('rollback failed'); kernel = previous; },
    async discard() { log.push(['discard', individualId]); staged = null; },
  };
  return { backend, requests, log, kernel: () => kernel };
}

function setup({ ids = ['a', 'b'], declarations = {}, doubles: overrides = {}, now = () => 1000, stageTimeoutMs } = {}) {
  const doubles = Object.fromEntries(ids.map(id => [id, tinyDouble(id, overrides[id])]));
  const adapter = createSharedEnvironmentAdapter({ sharedId: 'world', now, stageTimeoutMs,
    members: ids.map(id => ({ declaration: declarations[id] ?? declare(id), backend: doubles[id].backend, clock: { tick: 0, simTimeMs: 0 } })) });
  const batch = (fields = {}, channels = {}) => ({ contractVersion: 1, sharedId: 'world', worldEpoch: adapter.view().worldEpoch, worldTick: adapter.view().worldTick,
    capturedAtMs: 990, observations: ids.filter(id => adapter.view().participants.find(member => member.individualId === id)?.mode === 'active')
      .map(id => ({ individualId: id, sessionEpoch: `epoch-${id}`, channels: channels[id] ?? { 'visual-frame': dark() } })), ...fields });
  const run = () => adapter.resume({ worldEpoch: adapter.view().worldEpoch });
  return { adapter, doubles, batch, run };
}

test('declarations are exact, versioned and fail closed; unavailable capabilities are refused', () => {
  assert.throws(() => validateDeclaration(undefined), code('undeclared-capability'));
  assert.deepEqual(validateDeclaration(declare('a', { inputs: ['contact-proxy', 'visual-frame'] })).inputs, ['visual-frame', 'contact-proxy']);
  for (const fields of [{ contractVersion: 2 }, { backend: 'fixture' }, { inputs: ['reward'] }, { inputs: ['motor-proposal'] }, { outputs: ['visual-frame'] },
    { inputs: ['visual-frame', 'visual-frame'] }, { capabilities: { ...on, extra: false } }, { capabilities: off }, { inputs: [], outputs: [], capabilities: on },
    { individualId: '../escape' }]) {
    assert.throws(() => validateDeclaration(declare('a', fields)), code('invalid-declaration'), JSON.stringify(fields));
  }
  assert.throws(() => validateDeclaration({ ...declare('a'), extra: true }), code('invalid-declaration'));
  for (const key of ['embodiment', 'chemistry', 'learning']) assert.throws(() => validateDeclaration(declare('a', { capabilities: { ...on, [key]: true } })), code('capability-unavailable'));
  assert.throws(() => validateDeclaration(declare('a', { backend: 'connectome' })), code('capability-unavailable'));
  assert.equal(Object.isFrozen(validateDeclaration(declare('a')).capabilities), true);
  assert.equal(SHARED_ADAPTER_CONTRACT.channels.includes('reward'), false);
  assert.equal(Object.values(ADAPTER_CHANNELS).every(channel => typeof channel.disclosure === 'string'), true);
});

test('full-connectome workers can only declare no channel, and missing flags fail closed', () => {
  const state = { individualId: 'm', sessionEpoch: 'e', capabilities: { ...off, disclosure: 'research only' } };
  assert.deepEqual(connectomeDeclaration(state), { contractVersion: 1, individualId: 'm', sessionEpoch: 'e', backend: 'connectome', inputs: [], outputs: [], capabilities: off });
  for (const capabilities of [undefined, { ...off, sensoryMotor: true }, { sensoryMotor: false, embodiment: false, chemistry: false }, { ...off, learning: undefined }]) {
    assert.throws(() => connectomeDeclaration({ ...state, capabilities }), code('undeclared-capability'));
  }
  const summary = describeDeclarations([state, { individualId: 'x' }]);
  assert.equal(summary.coupled, false);
  assert.deepEqual(summary.participants.map(value => [value.individualId, value.declared]), [['m', true], ['x', false]]);
  assert.match(summary.reason, /accepts no observation or action payload/);
  assert.throws(() => createSharedEnvironmentAdapter({ members: [{ declaration: undefined }, { declaration: declare('b') }] }), code('undeclared-capability'));
});

test('an adapter is created paused and never starts, stages or advances without an explicit resume', async () => {
  const { adapter, doubles, batch } = setup();
  assert.equal(adapter.view().status, 'paused');
  await delay(5);
  await assert.rejects(adapter.step(batch()), code('not-running'));
  assert.throws(() => adapter.resume({ worldEpoch: 'guess' }), code('stale-epoch'));
  assert.equal(Object.values(doubles).every(double => double.requests.length === 0 && double.kernel().summary().tick === 0), true);
  assert.equal(adapter.view().worldTick, 0);
});

test('undeclared, extra, duplicate, malformed and cross-session fields are rejected before any state changes', async () => {
  const { adapter, doubles, batch, run } = setup({ declarations: { b: declare('b', { inputs: ['visual-frame'] }) } });
  run();
  const before = adapter.view();
  const good = batch();
  const cases = [
    [{ ...good, extra: 1 }, 'malformed-batch'],
    [{ ...good, sharedId: 'other' }, 'malformed-batch'],
    [{ ...good, observations: [...good.observations, good.observations[0]] }, 'duplicate'],
    [{ ...good, observations: [...good.observations, { individualId: 'z', sessionEpoch: 'epoch-z', channels: {} }] }, 'cross-session'],
    [{ ...good, observations: [{ ...good.observations[0], partnerNeural: [1] }, good.observations[1]] }, 'malformed-batch'],
    [batch({}, { b: { 'contact-proxy': { surface: 'leaf', side: 'left', magnitude: 1 } } }), 'undeclared-channel'],
    [batch({}, { a: { 'visual-frame': { ...dark(), partner: 'b' } } }), 'malformed-channel'],
    [batch({}, { a: { 'visual-frame': { ...dark(), luminance: Array(32).fill(256) } } }), 'malformed-channel'],
    [batch({}, { a: { 'contact-proxy': { surface: 'thorn', side: 'left', magnitude: 1 } } }), 'malformed-channel'],
    [batch({}, { a: { 'contact-proxy': { surface: 'leaf', side: 'left', magnitude: Number.NaN } } }), 'malformed-channel'],
    [batch({}, { a: { reward: 1 } }), 'undeclared-channel'],
  ];
  for (const [value, expected] of cases) await assert.rejects(adapter.step(value), code(expected), expected);
  assert.deepEqual(adapter.view(), before);
  assert.equal(Object.values(doubles).every(double => double.requests.length === 0 && double.kernel().summary().tick === 0), true);
});

test('a complete batch commits the exact interval in membership order whatever the completion order or latency', async () => {
  const { adapter, doubles, batch, run } = setup({ doubles: { a: { delays: [20, 0] }, b: { delays: [0, 20] } } });
  run();
  const first = await adapter.step(batch());
  const second = await adapter.step(batch());
  for (const [index, result] of [first, second].entries()) {
    assert.deepEqual(result.traces.map(trace => trace.individualId), ['a', 'b']);
    assert.deepEqual(result.traces.map(trace => [trace.neural.tick, trace.neural.simTimeMs, trace.substeps]), [[5 * (index + 1), 5 * (index + 1), 5], [5 * (index + 1), 5 * (index + 1), 5]]);
    assert.deepEqual(result.traces[0].interval, { startMs: index * 5, endMs: (index + 1) * 5 });
    assert.deepEqual(result.traces.map(trace => trace.receivedChannels), [['visual-frame'], ['visual-frame']]);
  }
  assert.equal(second.worldTick, 2);
  assert.deepEqual(doubles.a.log.concat(doubles.b.log).filter(entry => entry[0] === 'commit').length, 4);
  assert.deepEqual([doubles.a.kernel().summary().tick, doubles.b.kernel().summary().tick], [10, 10]);
});

test('a visual or contact change reaches only its declared recipient; the zero-input control stays quiet', async () => {
  const { adapter, doubles, batch, run } = setup({ ids: ['a', 'b', 'c'] });
  run();
  const result = await adapter.step(batch({}, { a: { 'visual-frame': bright() }, c: { 'contact-proxy': { surface: 'petal', side: 'both', magnitude: 1 } } }));
  const potentials = id => doubles[id].kernel().checkpoint().potential;
  assert.ok(doubles.a.kernel().summary().totalSpikes > 0);
  assert.ok(doubles.c.kernel().summary().totalSpikes > 0);
  assert.deepEqual([doubles.b.kernel().summary().totalSpikes, ...potentials('b')], [0, 0, 0, 0, 0]);
  assert.ok(potentials('a')[0] !== 0 || doubles.a.kernel().checkpoint().refractory[0] > 0);
  assert.equal(potentials('c')[0], 0, 'contact drives only its own input neuron');
  assert.equal(result.traces[1].proposal.forward, 0);
  // Each backend saw only its own recipient-scoped request: no partner ID, payload or neural state.
  for (const id of ['a', 'b', 'c']) {
    const request = doubles[id].requests[0];
    assert.deepEqual(Object.keys(request).sort(), ['channels', 'contractVersion', 'individualId', 'intervalMs', 'sessionEpoch', 'substeps', 'worldEpoch', 'worldTick']);
    assert.equal(request.individualId, id);
    assert.equal(JSON.stringify(request).match(/"(a|b|c)"/g).length, 1);
    assert.equal(Object.isFrozen(request.channels), true);
  }
  assert.deepEqual(Object.keys(doubles.b.requests[0].channels), ['visual-frame']);
});

test('a response carrying partner state or an undeclared output is refused without committing anyone', async () => {
  const { adapter, doubles, batch, run } = setup({ declarations: { b: declare('b', { outputs: [], inputs: ['visual-frame'] }) },
    doubles: { b: { motor: false, stage: (request, call) => {
      const response = { individualId: 'b', sessionEpoch: request.sessionEpoch, worldTick: request.worldTick, neural: { tick: 5, simTimeMs: 5 }, proposal: null };
      if (call === 0) return { ...response, partnerNeural: { individualId: 'a', potential: [0] } };
      if (call === 1) return { ...response, proposal: { forward: 0.1, yaw: 0 } };
    } } } });
  for (let attempt = 0; attempt < 2; attempt++) {
    run();
    await assert.rejects(adapter.step(batch()), code('invalid-response'));
    assert.equal(adapter.view().status, 'paused');
    assert.deepEqual([doubles.a.kernel().summary().tick, doubles.b.kernel().summary().tick], [0, 0]);
  }
  assert.deepEqual(doubles.a.log, [['discard', 'a'], ['discard', 'a']]);
  run();
  const ok = await adapter.step(batch());
  assert.equal(ok.traces[1].proposal, null);
});

test('stale inputs, partial batches, timeouts, numerical faults and step mismatches pause and rotate the epoch', async () => {
  let clock = 1000;
  const scenarios = [
    ['stale-observation', ({ batch }) => batch({ capturedAtMs: 500 })],
    ['stale-observation', ({ batch }) => batch({ capturedAtMs: 1001 })],
    ['stale-observation', ({ batch }) => batch({ worldTick: 3 })],
    ['stale-epoch', ({ batch }) => batch({ worldEpoch: 'previous' })],
    ['stale-epoch', ({ batch }) => { const value = batch(); value.observations[1].sessionEpoch = 'old'; return value; }],
    ['partial-batch', ({ batch }) => { const value = batch(); value.observations.pop(); return value; }],
  ];
  for (const [expected, make] of scenarios) {
    const context = setup({ now: () => clock });
    context.run();
    const epoch = context.adapter.view().worldEpoch;
    await assert.rejects(context.adapter.step(make(context)), code(expected), expected);
    const view = context.adapter.view();
    assert.deepEqual([view.status, view.fault, view.worldTick, view.worldEpoch === epoch], ['paused', expected, 0, false], expected);
    assert.equal(Object.values(context.doubles).every(double => double.requests.length === 0), true);
    await assert.rejects(context.adapter.step(context.batch()), code('not-running'));
  }
  const faults = [
    ['timeout', { a: { delays: [200] } }],
    ['worker-fault', { b: { stage: () => { throw new Error('worker exited'); } } }],
    ['numerical-fault', { b: { stage: request => ({ individualId: 'b', sessionEpoch: request.sessionEpoch, worldTick: 0, neural: { tick: 5, simTimeMs: 5 }, proposal: { forward: Number.NaN, yaw: 0 } }) } }],
    ['invalid-response', { b: { stage: request => ({ individualId: 'b', sessionEpoch: request.sessionEpoch, worldTick: 0, neural: { tick: 5, simTimeMs: 5 }, proposal: { forward: 1, yaw: 0 } }) } }],
    ['step-mismatch', { b: { stage: request => ({ individualId: 'b', sessionEpoch: request.sessionEpoch, worldTick: 0, neural: { tick: 4, simTimeMs: 5 }, proposal: { forward: 0, yaw: 0 } }) } }],
    ['invalid-response', { b: { stage: request => ({ individualId: 'a', sessionEpoch: request.sessionEpoch, worldTick: 0, neural: { tick: 5, simTimeMs: 5 }, proposal: { forward: 0, yaw: 0 } }) } }],
  ];
  for (const [expected, doubles] of faults) {
    const context = setup({ doubles, stageTimeoutMs: 50 });
    context.run();
    await assert.rejects(context.adapter.step(context.batch()), code(expected), expected);
    assert.deepEqual([context.adapter.view().status, context.adapter.view().worldTick], ['paused', 0]);
    assert.deepEqual([context.doubles.a.kernel().summary().tick, context.doubles.b.kernel().summary().tick], [0, 0], expected);
    assert.equal(context.doubles.a.log.some(entry => entry[0] === 'commit'), false);
  }
});

test('a commit failure rolls back already committed members; an unrecoverable rollback faults the session', async () => {
  let failCommit = true;
  const context = setup({ ids: ['a', 'b', 'c'], doubles: { b: { commit: () => failCommit } } });
  context.run();
  await assert.rejects(context.adapter.step(context.batch()), code('worker-fault'));
  assert.deepEqual(['a', 'b', 'c'].map(id => context.doubles[id].kernel().summary().tick), [0, 0, 0]);
  assert.deepEqual(context.doubles.a.log, [['commit', 'a'], ['rollback', 'a']]);
  assert.deepEqual(context.doubles.c.log, [['discard', 'c']]);
  failCommit = false;
  context.run();
  assert.equal((await context.adapter.step(context.batch())).worldTick, 1);

  const broken = setup({ doubles: { a: { rollback: () => true }, b: { commit: () => true } } });
  broken.run();
  await assert.rejects(broken.adapter.step(broken.batch()), code('worker-fault'));
  assert.equal(broken.adapter.view().status, 'fault');
  assert.throws(() => broken.run(), code('fault'));
});

test('rest and withdrawal stay quiet and scoped; an all-resting world freezes until an explicit resume', async () => {
  const { adapter, doubles, batch, run } = setup({ ids: ['a', 'b', 'c'] });
  run();
  adapter.rest('b');
  const restingBatch = batch();
  assert.deepEqual(restingBatch.observations.map(value => value.individualId), ['a', 'c']);
  await assert.rejects(adapter.step({ ...restingBatch, observations: [...restingBatch.observations, { individualId: 'b', sessionEpoch: 'epoch-b', channels: {} }] }), code('resting-member'));
  const result = await adapter.step(restingBatch);
  assert.deepEqual(result.traces.map(trace => trace.individualId), ['a', 'c']);
  assert.deepEqual([doubles.b.requests.length, doubles.b.kernel().summary().tick], [0, 0]);
  const epoch = adapter.view().worldEpoch;
  adapter.withdraw('c');
  assert.deepEqual([adapter.view().status, adapter.view().worldEpoch === epoch], ['running', true], 'withdrawal revokes only its own scope');
  assert.throws(() => adapter.withdraw('a'), code('population-floor'));
  await assert.rejects(adapter.step({ ...batch(), observations: [{ individualId: 'c', sessionEpoch: 'epoch-c', channels: {} }] }), code('cross-session'));
  adapter.rest('a');
  assert.equal(adapter.view().status, 'resting');
  await assert.rejects(adapter.step(batch()), code('not-running'));
  adapter.wake('b');
  assert.equal(adapter.view().status, 'paused');
  run();
  assert.deepEqual((await adapter.step(batch())).traces.map(trace => [trace.individualId, trace.neural.tick]), [['b', 5]]);
});

test('the full-connectome shared session reports an uncoupled adapter and refuses an undeclared participant', async () => {
  const states = new Map();
  const make = (id, capabilities) => ({ source: 'connectome', individualId: id, dataset: id === 'one' ? 'male-cns:v1.0' : 'banc:v888', sessionEpoch: `epoch-${id}`,
    commandSequence: 0, resident: true, status: 'paused', neural: { tick: 0, simTimeMs: 0 }, graphSha256: 'a'.repeat(64), model: { id }, capabilities });
  states.set('one', make('one', { ...off })); states.set('two', make('two', { ...off }));
  const service = createConnectomeSharedSession({ snapshot: id => structuredClone(states.get(id)), control: async () => {}, barrier: async () => [] });
  const members = ['one', 'two'].map(id => ({ protocolVersion: 1, individualId: id, sessionEpoch: `epoch-${id}`, commandSequence: 0 }));
  const joined = await service.join({ protocolVersion: 1, members });
  assert.equal(joined.shared.adapter.coupled, false);
  assert.deepEqual(joined.shared.adapter.participants.map(value => [value.individualId, value.backend, value.inputs, value.outputs]),
    [['one', 'connectome', [], []], ['two', 'connectome', [], []]]);
  await service.close();

  states.set('two', make('two', { sensoryMotor: false, learning: false, chemistry: false }));
  const refusing = createConnectomeSharedSession({ snapshot: id => structuredClone(states.get(id)), control: async () => {}, barrier: async () => [] });
  await assert.rejects(refusing.join({ protocolVersion: 1, members }), /Stale or unavailable/);
  await refusing.close();
});
