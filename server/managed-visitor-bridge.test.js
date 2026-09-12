import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from './runtime.js';
import { createManagedVisitorBridge } from './managed-visitor-bridge.js';
import { createManagedVisitorTransport } from './managed-visitor-transport.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function setup() {
  let clock = 10000; const runtimes = new Map(['a', 'b'].map(id => [id, createRuntime({ individualId: id, sessionId: `runtime-${id}` })]));
  const owners = new Map(), leases = new Map(), calls = [];
  const authority = { claim(id, owner) {
    assert(!owners.has(id)); const r = runtimes.get(id); owners.set(id, owner);
    return { snapshot: () => r.snapshot(), control: action => r.control(action), prepareStep: input => r.prepareStep(input),
      previewStep: token => r.previewStep(token), commitStep: token => r.commitStep(token),
      isCurrent: () => owners.get(id) === owner && runtimes.get(id) === r,
      release: () => { if (owners.get(id) === owner) owners.delete(id); } };
  } };
  const transport = { enabled: true, appId: 'garden',
    capabilities: async () => ({ version: 1, appId: 'garden', available: true, individualIds: ['a', 'b'], worldIds: ['world'],
      contract: { version: 1, expiryEnforced: true, admissionDeadline: true, bodies: ['fly-v1'], actions: ['start', 'pause', 'rest', 'move', 'leave'], controllerRaster: { width: 8, height: 4, channels: 3 } } }),
    admit: async body => { const lease = { version: 1, appId: 'garden', individualId: body.individualId,
      individualSessionId: body.individualSessionId, worldId: body.worldId, epoch: `epoch-${body.individualId}`,
      sessionId: `visit-${body.individualId}`, expiresAt: clock + body.ttlMs, status: 'paused', pose: { x: 0, z: 0, yaw: 0 } };
      leases.set(lease.sessionId, { ...lease, frame: -1 }); return lease; },
    observe: async (id, body) => { const l = leases.get(id); return { version: 1, sessionId: id, appId: 'garden', ...body,
      frameId: ++l.frame, capturedAtMs: clock, camera: 'controller', width: 8, height: 4, rgb: Array(96).fill(90), pose: l.pose,
      sensorySource: 'engineered-gentle-patch-spatial-proxy-v1' }; },
    action: async (id, body) => { calls.push(body); const l = leases.get(id); return { version: 1, sessionId: id, appId: 'garden',
      individualId: body.individualId, individualSessionId: body.individualSessionId, worldId: body.worldId, epoch: body.epoch,
      expiresAt: l.expiresAt, sequence: body.sequence, pose: l.pose, status: { start: 'running', pause: 'paused', rest: 'resting', move: 'running' }[body.action.type] }; },
    leave: async (id, body) => { leases.delete(id); return { version: 1, appId: 'garden', sessionId: id, ...body, status: 'left' }; },
    cancel: async body => ({ version: 1, appId: 'garden', ...body, confirmed: true, pending: false, expiresAt: null }) };
  const bridge = createManagedVisitorBridge({ authority, transport, now: () => clock });
  return { bridge, runtimes, owners, leases, transport, calls, advance: ms => { clock += ms; } };
}
test('two fixture visits admit paused and use only their own scoped geometric observation and motor loop', async () => {
  const s = setup();
  for (const id of ['a', 'b']) { const state = await s.bridge.admit(id, { worldId: 'world' }); assert.equal(state.phase, 'visiting'); assert.equal(state.running, false); assert.equal(s.runtimes.get(id).snapshot().tick, 0); }
  await s.bridge.tick('a'); assert.equal(s.calls.length, 0);
  await s.bridge.control('a', 'start'); await s.bridge.control('b', 'start');
  for (let i = 0; i < 40; i++) await s.bridge.tick('a');
  assert.equal(s.runtimes.get('a').snapshot().tick, 40); assert.equal(s.runtimes.get('b').snapshot().tick, 0);
  assert.match(s.bridge.snapshot('a').lastTrace.sensorySource, /spatial-proxy/);
  assert(s.calls.every(c => !('potentials' in c) && !('checkpoint' in c)));
  await s.bridge.control('a', 'home'); assert.equal(s.owners.has('a'), false); assert.equal(s.bridge.snapshot('b').running, true);
  await s.bridge.tick('b'); assert.equal(s.runtimes.get('b').snapshot().tick, 1);
});
test('wrong scope or repeated frame stops outward authority without neural advancement', async () => {
  for (const corrupt of ['scope', 'replay', 'rgb']) {
    const s = setup(); await s.bridge.admit('a', { worldId: 'world' }); await s.bridge.control('a', 'start'); await s.bridge.tick('a');
    const observe = s.transport.observe; s.transport.observe = async (...args) => { const value = await observe(...args);
      if (corrupt === 'scope') value.individualId = 'b'; else if (corrupt === 'replay') value.frameId = 0; else value.rgb[0] = NaN; return value; };
    await s.bridge.tick('a'); assert.equal(s.runtimes.get('a').snapshot().tick, 1); assert.equal(s.bridge.snapshot('a').running, false);
  }
});
test('pending movement cannot commit after home revokes ownership', async () => {
  const s = setup(); await s.bridge.admit('a', { worldId: 'world' }); await s.bridge.control('a', 'start');
  const action = s.transport.action, gate = deferred(), entered = deferred();
  s.transport.action = async (...args) => { const result = await action(...args); entered.resolve(); await gate.promise; return result; };
  const pending = s.bridge.tick('a'); await entered.promise; await s.bridge.control('a', 'home'); gate.resolve(); await pending;
  assert.equal(s.runtimes.get('a').snapshot().tick, 0); assert.equal(s.owners.has('a'), false);
});
test('unknown admission remains quarantined through broker deadline when cancellation is unconfirmed', async () => {
  const s = setup(); s.transport.admit = async () => { throw Object.assign(new Error('timeout'), { code: 'timed-out' }); };
  s.transport.cancel = async body => ({ version: 1, appId: 'garden', ...body, confirmed: false, pending: false, expiresAt: 40000 });
  await s.bridge.admit('a', { worldId: 'world' }); assert.equal(s.owners.has('a'), true); assert.equal(s.runtimes.get('a').snapshot().status, 'paused');
  s.advance(29999); await s.bridge.tick('a'); assert.equal(s.owners.has('a'), true);
  s.advance(1001); await s.bridge.tick('a'); assert.equal(s.owners.has('a'), false);
});
test('cancel while admission awaits never releases local owner before late admission is cleaned', async () => {
  const s = setup(), admission = s.transport.admit, gate = deferred(), entered = deferred();
  s.transport.admit = async body => { entered.resolve(); await gate.promise; return admission(body); };
  const pending = s.bridge.admit('a', { worldId: 'world' }); await entered.promise;
  await s.bridge.control('a', 'home'); assert.equal(s.owners.has('a'), true);
  gate.resolve(); await pending; assert.equal(s.owners.has('a'), false); assert.equal(s.leases.size, 0);
});
test('expiry and backwards clocks pause before another neural step', async () => {
  for (const delta of [30001, -1]) { const s = setup(); await s.bridge.admit('a', { worldId: 'world' }); await s.bridge.control('a', 'start'); s.advance(delta);
    await s.bridge.tick('a'); assert.equal(s.runtimes.get('a').snapshot().tick, 0); assert.equal(s.bridge.snapshot('a').running, false); }
});
test('transport is disabled without exact loopback configuration and never exposes its credential', async () => {
  let calls = 0; const disabled = createManagedVisitorTransport({ baseUrl: 'https://example.com', credential: `mv1_${'a'.repeat(64)}`, appId: 'garden', fetchImpl: () => { calls++; } });
  await assert.rejects(disabled.capabilities, /not configured/); assert.equal(calls, 0);
  const token = `mv1_${'b'.repeat(64)}`;
  const enabled = createManagedVisitorTransport({ baseUrl: 'http://127.0.0.1:5555', credential: token, appId: 'garden', fetchImpl: async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:5555/api/managed-visitors/v1/capabilities'); assert.equal(init.redirect, 'error'); assert.equal(init.headers.Authorization, `Bearer ${token}`); return Response.json({ available: false }); } });
  assert.deepEqual(await enabled.capabilities(), { available: false }); assert(!JSON.stringify(enabled).includes(token));
});
test('unconfirmed leave keeps ownership and rejects a late movement acknowledgment', async () => {
  const s = setup(); await s.bridge.admit('a', { worldId: 'world' }); await s.bridge.control('a', 'start');
  const action = s.transport.action, gate = deferred(), entered = deferred();
  s.transport.action = async (...args) => { const response = await action(...args); entered.resolve(); await gate.promise; return response; };
  s.transport.leave = async () => { throw new Error('offline'); };
  const pending = s.bridge.tick('a'); await entered.promise; await s.bridge.control('a', 'home'); gate.resolve(); await pending;
  assert.equal(s.runtimes.get('a').snapshot().tick, 0); assert.equal(s.owners.has('a'), true); assert.equal(s.bridge.snapshot('a').running, false);
  s.advance(31000); await s.bridge.tick('a'); assert.equal(s.owners.has('a'), false);
});
test('replacement runtime cannot inherit the pending visitor result or be mutated by cleanup', async () => {
  const s = setup(); await s.bridge.admit('a', { worldId: 'world' }); await s.bridge.control('a', 'start');
  const observation = s.transport.observe, gate = deferred(), entered = deferred();
  s.transport.observe = async (...args) => { const response = await observation(...args); entered.resolve(); await gate.promise; return response; };
  const pending = s.bridge.tick('a'); await entered.promise;
  const replacement = createRuntime({ individualId: 'a', sessionId: 'replacement' }); s.runtimes.set('a', replacement);
  const before = replacement.snapshot(); gate.resolve(); await pending; assert.deepEqual(replacement.snapshot(), before);
  assert.equal(s.bridge.snapshot('a').owned, false);
});
test('transport rejects oversized responses and sanitizes private response errors', async () => {
  const options = { baseUrl: 'http://127.0.0.1:5555', credential: `mv1_${'b'.repeat(64)}`, appId: 'garden' };
  const oversized = createManagedVisitorTransport({ ...options, fetchImpl: async () => new Response('x'.repeat(16385)) });
  await assert.rejects(oversized.capabilities, /exceeds its bound/);
  const invalid = createManagedVisitorTransport({ ...options, fetchImpl: async () => new Response('private-machine-path secret-value') });
  await assert.rejects(invalid.capabilities, error => !error.message.includes('secret-value') && !error.message.includes('private-machine-path'));
});
test('repeated return commands share one outstanding cleanup request', async () => {
  const s = setup(); await s.bridge.admit('a', { worldId: 'world' });
  const leave = s.transport.leave, gate = deferred(); let calls = 0;
  s.transport.leave = async (...args) => { calls++; await gate.promise; return leave(...args); };
  const returns = Array.from({ length: 20 }, () => s.bridge.control('a', 'home'));
  assert.equal(calls, 1); gate.resolve(); await Promise.all(returns); assert.equal(s.owners.has('a'), false);
});

test('concurrent explicit capability discovery shares one bounded transport request', async () => {
  const s = setup(), capabilities = s.transport.capabilities, gate = deferred(); let calls = 0;
  s.transport.capabilities = async () => { calls++; await gate.promise; return capabilities(); };
  const reads = Array.from({ length: 20 }, () => s.bridge.capabilities('a'));
  await Promise.resolve(); assert.equal(calls, 1); gate.resolve(); await Promise.all(reads);
  await s.bridge.capabilities('a'); assert.equal(calls, 2);
});

test('Rest remains resting through pending movement cleanup and a late acknowledgment', async () => {
  for(const leaveFails of [false,true]) {
    const s=setup();await s.bridge.admit('a',{worldId:'world'});await s.bridge.control('a','start');
    const action=s.transport.action,gate=deferred(),entered=deferred();
    s.transport.action=async(...args)=>{const result=await action(...args);entered.resolve();await gate.promise;return result;};
    if(leaveFails)s.transport.leave=async()=>{throw new Error('offline');};
    const pending=s.bridge.tick('a');await entered.promise;await s.bridge.control('a','rest');
    assert.equal(s.runtimes.get('a').snapshot().status,'resting');
    gate.resolve();await pending;assert.equal(s.runtimes.get('a').snapshot().status,'resting');assert.equal(s.runtimes.get('a').snapshot().tick,0);
    if(leaveFails){assert.equal(s.owners.has('a'),true);s.advance(31000);await s.bridge.tick('a');}
    assert.equal(s.owners.has('a'),false);assert.equal(s.runtimes.get('a').snapshot().status,'resting');
  }
});
test('failed Rest acknowledgment preserves Rest, while a later explicit Start resets its return preference', async () => {
  const s=setup();await s.bridge.admit('a',{worldId:'world'});await s.bridge.control('a','start');
  const action=s.transport.action;s.transport.action=async()=>{throw new Error('offline');};
  await s.bridge.control('a','rest');assert.equal(s.runtimes.get('a').snapshot().status,'resting');
  s.transport.action=action;await s.bridge.admit('a',{worldId:'world'});await s.bridge.control('a','rest');await s.bridge.control('a','start');
  await s.bridge.lifecycle('a');assert.equal(s.runtimes.get('a').snapshot().status,'paused');
});
