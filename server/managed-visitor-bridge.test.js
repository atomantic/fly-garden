import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from './runtime.js';
import { createManagedVisitorBridge } from './managed-visitor-bridge.js';
import { createManagedVisitorTransport } from './managed-visitor-transport.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function setup({ capacity = 2 } = {}) {
  let clock = 10000; const runtimes = new Map(['a', 'b'].map(id => [id, createRuntime({ individualId: id, sessionId: `runtime-${id}` })]));
  const owners = new Map(), leases = new Map(), calls = [], controls = [];
  let epochs = 0;
  const authority = { claim(id, owner) {
    assert(!owners.has(id)); const r = runtimes.get(id); owners.set(id, owner);
    return { snapshot: () => r.snapshot(), control: action => { controls.push([id, action]); return r.control(action); }, prepareStep: input => r.prepareStep(input),
      previewStep: token => r.previewStep(token), commitStep: token => r.commitStep(token),
      isCurrent: () => owners.get(id) === owner && runtimes.get(id) === r,
      release: () => { if (owners.get(id) === owner) owners.delete(id); } };
  } };
  const transport = { enabled: true, appId: 'garden',
    capabilities: async () => ({ version: 1, appId: 'garden', available: true, individualIds: ['a', 'b'], worldIds: ['world'],
      contract: { version: 1, expiryEnforced: true, admissionDeadline: true, bodies: ['fly-v1'],
        actions: ['start', 'pause', 'rest', 'move', 'leave', 'interact'], maxConcurrentVisitors: capacity,
        patchObjects: [{ objectId: 'gentle-patch-a', x: 0, z: 0, radius: 0.3 }, { objectId: 'gentle-patch-b', x: 1.4, z: -0.5, radius: 0.2 }],
        interactionEffects: ['settle'], controllerRaster: { width: 8, height: 4, channels: 3 } } }),
    admit: async body => { const lease = { version: 1, appId: 'garden', individualId: body.individualId,
      individualSessionId: body.individualSessionId, worldId: body.worldId, epoch: `epoch-${body.individualId}-${++epochs}`,
      sessionId: `visit-${body.individualId}`, expiresAt: clock + body.ttlMs, status: 'paused', pose: { x: 0, z: 0, yaw: 0 } };
      leases.set(lease.sessionId, { ...lease, frame: -1 }); return lease; },
    observe: async (id, body) => { const l = leases.get(id); return { version: 1, sessionId: id, appId: 'garden', ...body,
      frameId: ++l.frame, capturedAtMs: clock, camera: 'controller', width: 8, height: 4, rgb: Array(96).fill(90), pose: l.pose,
      sensorySource: 'engineered-gentle-patch-spatial-proxy-v1' }; },
    action: async (id, body) => { calls.push(body); const l = leases.get(id);
      const reply = { version: 1, sessionId: id, appId: 'garden',
        individualId: body.individualId, individualSessionId: body.individualSessionId, worldId: body.worldId, epoch: body.epoch,
        expiresAt: l.expiresAt, sequence: body.sequence, pose: l.pose,
        status: { start: 'running', pause: 'paused', rest: 'resting', move: 'running', interact: 'running' }[body.action.type] };
      return body.action.type === 'interact'
        ? { ...reply, interaction: { objectId: body.action.objectId, effect: body.action.effect, accepted: true } } : reply; },
    leave: async (id, body) => { leases.delete(id); return { version: 1, appId: 'garden', sessionId: id, ...body, status: 'left' }; },
    cancel: async body => ({ version: 1, appId: 'garden', ...body, confirmed: true, pending: false, expiresAt: null }) };
  const bridge = createManagedVisitorBridge({ authority, transport, now: () => clock });
  return { bridge, runtimes, owners, leases, transport, calls, controls, advance: ms => { clock += ms; }, clock: () => clock };
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
  await assert.rejects(disabled.capabilities, /approved local loopback addresses/); assert.equal(calls, 0);
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

// ---------------------------------------------------------------------------
// Negative admission paths (#9 acceptance criteria)
// ---------------------------------------------------------------------------
test('a host without the nonhumanoid protocol refuses admission with the unsupported reason and no claim', async () => {
  const s = setup(), base = await s.transport.capabilities();
  s.transport.capabilities = async () => ({ ...base, available: false });
  await assert.rejects(() => s.bridge.capabilities('a'), error => error.code === 'unsupported');
  const state = await s.bridge.admit('a', { worldId: 'world' });
  assert.equal(state.phase, 'blocked'); assert.equal(state.owned, false);
  assert.match(state.reason, /nonhumanoid visitor protocol/);
  assert.equal(s.owners.has('a'), false); assert.equal(s.calls.length, 0);
  assert.equal(s.runtimes.get('a').snapshot().tick, 0);
});
test('an individual or world outside the owner allowlist refuses admission with the unauthorized reason', async () => {
  for (const [individualIds, worldIds, world] of [[['b'], ['world'], 'world'], [['a', 'b'], ['other'], 'world']]) {
    const s = setup(), base = await s.transport.capabilities();
    s.transport.capabilities = async () => ({ ...base, individualIds, worldIds });
    await assert.rejects(() => s.bridge.capabilities('a', world), error => error.code === 'unauthorized');
    const state = await s.bridge.admit('a', { worldId: world });
    assert.equal(state.phase, 'blocked'); assert.match(state.reason, /owner-approved visitor scope/);
    assert.equal(s.owners.has('a'), false); assert.equal(s.calls.length, 0);
  }
});
test('a mismatched negotiated contract refuses admission without acquiring a remote body', async () => {
  const base = (await setup().transport.capabilities()).contract;
  const mutations = {
    'missing fly-v1 body': { bodies: ['humanoid-v1'] },
    'wrong controller raster': { controllerRaster: { width: 16, height: 8, channels: 3 } },
    'expiry not enforced': { expiryEnforced: false },
    'no admission deadline': { admissionDeadline: false },
    // A half-published optional capability is still a mismatch: offering objects without the action,
    // or the action without objects, is refused. Offering none of the three is legal (see below).
    'patch objects without the interact action': { actions: ['start', 'pause', 'rest', 'move', 'leave'] },
    'interact action without a patch-object allowlist': { patchObjects: [] },
    'interact action with no interaction effects': { interactionEffects: [] },
    'patch object outside the negotiated patch': { patchObjects: [{ objectId: 'far', x: 9, z: 0, radius: 0.3 }] },
    'unsupported interaction effect set': { interactionEffects: ['harvest'] },
    'invalid concurrent visitor capacity': { maxConcurrentVisitors: 0 },
  };
  for (const [label, patch] of Object.entries(mutations)) {
    const s = setup(), capabilities = s.transport.capabilities;
    s.transport.capabilities = async () => { const value = await capabilities(); value.contract = { ...base, ...patch }; return value; };
    await assert.rejects(() => s.bridge.capabilities('a', 'world'), error => error.code === 'invalid-response', label);
    const state = await s.bridge.admit('a', { worldId: 'world' });
    assert.equal(state.phase, 'blocked', label); assert.equal(s.owners.has('a'), false, label);
    assert.equal(s.leases.size, 0, label); assert.equal(s.calls.length, 0, label);
  }
});
test('mid-visit host revocation stops outward actions and offers a paused return', async () => {
  for (const channel of ['action', 'observe']) {
    for (const status of [401, 403]) {
      const s = setup(); await s.bridge.admit('a', { worldId: 'world' }); await s.bridge.control('a', 'start');
      await s.bridge.tick('a'); assert.equal(s.runtimes.get('a').snapshot().tick, 1);
      const refused = () => { throw Object.assign(new Error(`host refused with ${status}`), { code: 'unauthorized' }); };
      s.transport[channel] = async () => refused();
      const outward = s.calls.length;
      await s.bridge.tick('a');
      // No further outward action is attempted after revocation, and nothing advanced locally.
      assert.equal(s.runtimes.get('a').snapshot().tick, 1);
      assert.equal(s.runtimes.get('a').snapshot().status, 'paused');
      assert.equal(s.bridge.snapshot('a').running, false);
      // Nothing further was dispatched through the fake transport after the refusal.
      assert.equal(s.calls.length, outward);
      await s.bridge.tick('a'); assert.equal(s.calls.length, outward);
      // Cleanup succeeded here, so the home controller is offered back paused rather than stranded.
      assert.equal(s.owners.has('a'), false);
      assert.equal(s.bridge.snapshot('a').phase, 'home');
      assert.match(s.bridge.snapshot('a').reason, /paused/);
    }
  }
});
test('a prior-epoch action or observation after re-admission is rejected without advancing the fixture', async () => {
  for (const channel of ['observe', 'action']) {
    const s = setup();
    await s.bridge.admit('a', { worldId: 'world' }); await s.bridge.control('a', 'start');
    await s.bridge.tick('a'); assert.equal(s.runtimes.get('a').snapshot().tick, 1);
    const staleEpoch = s.bridge.snapshot('a').visitEpoch;
    await s.bridge.control('a', 'home'); assert.equal(s.owners.has('a'), false);
    await s.bridge.admit('a', { worldId: 'world' }); await s.bridge.control('a', 'start');
    const freshEpoch = s.bridge.snapshot('a').visitEpoch;
    assert.notEqual(freshEpoch, staleEpoch);
    const original = s.transport[channel];
    s.transport[channel] = async (...args) => { const value = await original(...args); value.epoch = staleEpoch; return value; };
    const tick = s.runtimes.get('a').snapshot().tick;
    await s.bridge.tick('a');
    assert.equal(s.runtimes.get('a').snapshot().tick, tick, `${channel} replay advanced the fixture`);
    assert.equal(s.bridge.snapshot('a').running, false);
    assert.equal(s.runtimes.get('a').snapshot().status, 'paused');
  }
});

// ---------------------------------------------------------------------------
// Negotiated host capacity and paired faults (#21 acceptance criteria)
// ---------------------------------------------------------------------------
test('an absent capacity field is treated as one visitor and a second admission is refused before any claim', async () => {
  const s = setup(), capabilities = s.transport.capabilities;
  s.transport.capabilities = async () => { const value = await capabilities(); delete value.contract.maxConcurrentVisitors; return value; };
  assert.equal((await s.bridge.capabilities('a', 'world')).maxConcurrentVisitors, 1);
  await s.bridge.admit('a', { worldId: 'world' }); await s.bridge.control('a', 'start');
  for (let i = 0; i < 3; i++) await s.bridge.tick('a');
  const before = s.runtimes.get('a').snapshot(), leaseBefore = s.bridge.snapshot('a');
  const claims = s.controls.length;
  await assert.rejects(() => s.bridge.admit('b', { worldId: 'world' }), error => error.code === 'host-capacity'
    && /left undisturbed/.test(error.message));
  assert.equal(s.owners.has('b'), false);
  // The first visitor was never claimed, paused or re-leased by the refused second admission.
  assert.equal(s.controls.length, claims);
  assert.deepEqual(s.runtimes.get('a').snapshot(), before);
  assert.equal(s.bridge.snapshot('a').visitEpoch, leaseBefore.visitEpoch);
  assert.equal(s.bridge.snapshot('a').phase, 'visiting'); assert.equal(s.bridge.snapshot('a').running, true);
  await s.bridge.tick('a'); assert.equal(s.runtimes.get('a').snapshot().tick, before.tick + 1);
});
test('a capacity lowered between discovery and admission reports the specific host-capacity refusal', async () => {
  const s = setup();
  await s.bridge.admit('a', { worldId: 'world' }); await s.bridge.admit('b', { worldId: 'world' });
  assert.equal(s.bridge.snapshot('a').phase, 'visiting'); assert.equal(s.bridge.snapshot('b').phase, 'visiting');
  assert.equal(s.bridge.snapshot('a').hostCapacity, 2); assert.equal(s.bridge.snapshot('a').hostVisitors, 2);
  await s.bridge.control('b', 'home');
  // The cached contract still says two, so B is claimed; fresh discovery then reveals the lowered limit.
  const capabilities = s.transport.capabilities;
  s.transport.capabilities = async () => { const value = await capabilities(); value.contract.maxConcurrentVisitors = 1; return value; };
  const aBefore = s.runtimes.get('a').snapshot(), epoch = s.bridge.snapshot('a').visitEpoch;
  const refused = await s.bridge.admit('b', { worldId: 'world' });
  // The refusal keeps its specific message instead of collapsing into the generic admission failure.
  assert.equal(refused.phase, 'blocked');
  assert.match(refused.reason, /concurrent managed visitor/);
  assert.doesNotMatch(refused.reason, /was not confirmed/);
  assert.equal(s.owners.has('b'), false);
  assert.equal(s.leases.size, 1);
  // A kept its body, lease and clock throughout.
  assert.equal(s.bridge.snapshot('a').phase, 'visiting');
  assert.equal(s.bridge.snapshot('a').visitEpoch, epoch);
  assert.deepEqual(s.runtimes.get('a').snapshot(), aBefore);
});
test('a host refusing the second admission leaves the first visit stepping on a single-capacity contract', async () => {
  const s = setup({ capacity: 1 });
  await s.bridge.admit('a', { worldId: 'world' }); await s.bridge.control('a', 'start');
  for (let i = 0; i < 4; i++) await s.bridge.tick('a');
  const admitCalls = s.leases.size;
  await assert.rejects(() => s.bridge.admit('b', { worldId: 'world' }), error => error.code === 'host-capacity');
  assert.equal(s.leases.size, admitCalls); assert.equal(s.owners.has('b'), false);
  assert.equal(s.runtimes.get('b').snapshot().tick, 0); assert.equal(s.runtimes.get('b').snapshot().status, 'paused');
  assert.equal(s.bridge.snapshot('a').phase, 'visiting');
  await s.bridge.tick('a'); assert.equal(s.runtimes.get('a').snapshot().tick, 5);
});
test("one visitor's expiry, revocation or stale-epoch reply never touches the paired visitor", async () => {
  for (const fault of ['expiry', 'revoked', 'stale-epoch']) {
    const s = setup(), admit = s.transport.admit;
    if (fault === 'expiry') s.transport.admit = async body => { const lease = await admit(body);
      if (body.individualId === 'a') { lease.expiresAt -= 25000; s.leases.get(lease.sessionId).expiresAt = lease.expiresAt; } return lease; };
    await s.bridge.admit('a', { worldId: 'world' }); await s.bridge.admit('b', { worldId: 'world' });
    await s.bridge.control('a', 'start'); await s.bridge.control('b', 'start');
    for (let i = 0; i < 6; i++) { await s.bridge.tick('a'); await s.bridge.tick('b'); }
    const bBefore = s.bridge.snapshot('b'), bTick = s.runtimes.get('b').snapshot().tick;
    assert.equal(bTick, 6);
    if (fault === 'expiry') s.advance(6000);
    if (fault === 'revoked') { const observe = s.transport.observe;
      s.transport.observe = async (id, body) => { if (body.individualId === 'a') throw Object.assign(new Error('revoked'), { code: 'unauthorized' }); return observe(id, body); }; }
    if (fault === 'stale-epoch') { const observe = s.transport.observe;
      s.transport.observe = async (id, body) => { const value = await observe(id, body); if (body.individualId === 'a') value.epoch = 'epoch-a-0'; return value; }; }
    await s.bridge.tick('a');
    assert.equal(s.runtimes.get('a').snapshot().tick, 6, fault);
    assert.equal(s.bridge.snapshot('a').running, false, fault);
    // B keeps its own lease, epoch, expiry, tick count and outward authority.
    const bAfter = s.bridge.snapshot('b');
    assert.equal(bAfter.visitEpoch, bBefore.visitEpoch, fault);
    assert.equal(bAfter.expiresAt, bBefore.expiresAt, fault);
    assert.equal(bAfter.phase, 'visiting', fault); assert.equal(bAfter.running, true, fault);
    assert.equal(s.runtimes.get('b').snapshot().tick, bTick, fault);
    await s.bridge.tick('b');
    assert.equal(s.runtimes.get('b').snapshot().tick, bTick + 1, fault);
  }
});
test('disconnectAll pauses both visitors, keeps their ticks and never restores a checkpoint', async () => {
  const s = setup();
  await s.bridge.admit('a', { worldId: 'world' }); await s.bridge.admit('b', { worldId: 'world' });
  await s.bridge.control('a', 'start'); await s.bridge.control('b', 'start');
  for (let i = 0; i < 7; i++) await s.bridge.tick('a');
  for (let i = 0; i < 3; i++) await s.bridge.tick('b');
  const ticks = { a: s.runtimes.get('a').snapshot().tick, b: s.runtimes.get('b').snapshot().tick };
  assert.deepEqual(ticks, { a: 7, b: 3 });
  const results = await s.bridge.disconnectAll();
  assert.equal(results.length, 2); assert(results.every(value => value.status === 'fulfilled'));
  for (const id of ['a', 'b']) {
    assert.equal(s.owners.has(id), false, id);
    assert.equal(s.bridge.snapshot(id).phase, 'home', id);
    assert.equal(s.bridge.snapshot(id).running, false, id);
    assert.equal(s.runtimes.get(id).snapshot().status, 'paused', id);
    // Independent clocks survive: neither runtime was rewound, restored or swapped.
    assert.equal(s.runtimes.get(id).snapshot().tick, ticks[id], id);
    assert.equal(s.runtimes.get(id).snapshot().individualId, id, id);
    assert.equal(s.runtimes.get(id).snapshot().sessionId, `runtime-${id}`, id);
  }
  // The ownership handle only ever received explicit local lifecycle actions; never a restore.
  assert(s.controls.every(([, action]) => ['start', 'pause', 'rest'].includes(action)));
  assert.equal(s.bridge.snapshot('a').hostVisitors, 0);
  assert.deepEqual(await s.bridge.disconnectAll(), []);
});

// ---------------------------------------------------------------------------
// Allowlisted patch-object interaction (#10 acceptance criteria)
// ---------------------------------------------------------------------------
async function armed(options) {
  const s = setup(options);
  await s.bridge.admit('a', { worldId: 'world' }); await s.bridge.control('a', 'start');
  await s.bridge.tick('a');
  const state = await s.bridge.control('a', 'interact');
  assert.equal(state.interactArmed, true);
  assert.deepEqual(state.patchObjects, ['gentle-patch-a', 'gentle-patch-b']);
  return s;
}
test('an armed visitor interacts with an allowlisted patch object derived from its own pose and motor readout', async () => {
  const s = await armed();
  const before = s.calls.length;
  await s.bridge.tick('a');
  const outward = s.calls.slice(before);
  assert.equal(outward.length, 1);
  assert.equal(outward[0].action.type, 'interact');
  assert.deepEqual(outward[0].action, { type: 'interact', objectId: 'gentle-patch-a', effect: 'settle', intervalMs: 5 });
  const snapshot = s.bridge.snapshot('a');
  assert.equal(snapshot.lastInteraction.objectId, 'gentle-patch-a');
  assert.equal(snapshot.lastInteraction.effect, 'settle');
  assert.equal(snapshot.lastTrace.action, 'interact');
  assert.equal(s.runtimes.get('a').snapshot().tick, 2);
  // Withdrawing the permission returns the visitor to movement only.
  await s.bridge.control('a', 'interact');
  assert.equal(s.bridge.snapshot('a').interactArmed, false);
  await s.bridge.tick('a');
  assert.equal(s.calls.at(-1).action.type, 'move');
});
test('an out-of-patch pose or unallowlisted effect refuses the interaction without advancing the fixture', async () => {
  for (const corrupt of ['pose', 'effect', 'object', 'extra-field']) {
    const s = await armed(), action = s.transport.action;
    s.transport.action = async (id, body) => { const value = await action(id, body);
      if (body.action.type !== 'interact') return value;
      if (corrupt === 'pose') value.pose = { x: 1.9, z: 1.9, yaw: 0 };
      if (corrupt === 'effect') value.interaction.effect = 'harvest';
      if (corrupt === 'object') value.interaction.objectId = 'gentle-patch-b';
      if (corrupt === 'extra-field') value.interaction.hostResident = 'caretaker';
      return value; };
    const tick = s.runtimes.get('a').snapshot().tick;
    await s.bridge.tick('a');
    assert.equal(s.runtimes.get('a').snapshot().tick, tick, corrupt);
    assert.equal(s.bridge.snapshot('a').lastInteraction, null, corrupt);
    assert.equal(s.bridge.snapshot('a').running, false, corrupt);
    assert.equal(s.runtimes.get('a').snapshot().status, 'paused', corrupt);
  }
});
test('a host that never negotiated an interaction allowlist cannot be armed at all', async () => {
  const s = setup(), capabilities = s.transport.capabilities;
  await s.bridge.admit('a', { worldId: 'world' }); await s.bridge.control('a', 'start');
  await assert.rejects(() => s.bridge.control('b', 'interact'), error => error.code === 'unavailable');
  s.transport.capabilities = capabilities;
  // Arming outside a live acknowledged visit is refused rather than queued.
  await s.bridge.control('a', 'home');
  await assert.rejects(() => s.bridge.control('a', 'interact'), error => error.code === 'unavailable');
});
test('interaction after expiry or revocation never leaves the process', async () => {
  for (const fault of ['expiry', 'revoked']) {
    const s = await armed();
    const before = s.calls.length, tick = s.runtimes.get('a').snapshot().tick;
    if (fault === 'expiry') s.advance(31000);
    else s.transport.action = async () => { throw Object.assign(new Error('revoked'), { code: 'unauthorized' }); };
    await s.bridge.tick('a');
    if (fault === 'expiry') assert.equal(s.calls.length, before, 'an expired lease sent an action');
    else assert(s.calls.slice(before).every(call => call.action.type === 'interact'));
    assert.equal(s.runtimes.get('a').snapshot().tick, tick, fault);
    assert.equal(s.bridge.snapshot('a').lastInteraction, null, fault);
    assert.equal(s.runtimes.get('a').snapshot().status, 'paused', fault);
    // Arming is refused once the lease is gone; nothing is retried automatically.
    await assert.rejects(() => s.bridge.control('a', 'interact'), error => ['unavailable', 'unsupported'].includes(error.code));
  }
});
test('no host or resident payload can reach the local runtime control path', async () => {
  const s = await armed(), action = s.transport.action, observe = s.transport.observe;
  // A host reply that smuggles a command, a caretaker message or neural state is refused outright.
  s.transport.action = async (id, body) => ({ ...await action(id, body), control: { action: 'start' }, residentMessage: 'come here' });
  await s.bridge.tick('a');
  assert.equal(s.bridge.snapshot('a').running, false);
  assert.equal(s.runtimes.get('a').snapshot().status, 'paused');
  s.transport.action = action;
  const s2 = await armed();
  s2.transport.observe = async (id, body) => ({ ...await observe(id, body), command: 'start', potentials: [1, 2, 3] });
  await s2.bridge.tick('a');
  assert.equal(s2.runtimes.get('a').snapshot().status, 'paused');
  // Only explicit local lifecycle actions ever reached the ownership handle.
  for (const bridge of [s, s2]) assert(bridge.controls.every(([, value]) => ['start', 'pause', 'rest'].includes(value)));
  // And nothing beyond the allowlisted outward payload ever left the process.
  for (const bridge of [s, s2]) assert(bridge.calls.every(call => ['start', 'pause', 'rest', 'move', 'interact'].includes(call.action.type)
    && !('potentials' in call) && !('checkpoint' in call) && !('weights' in call)));
});

test('a legacy five-action host without the optional interaction fields admits, visits, moves and returns', async () => {
  const s = setup(), capabilities = s.transport.capabilities;
  s.transport.capabilities = async () => { const value = await capabilities();
    // Exactly the contract shape that predates the optional interaction capability.
    value.contract = { version: 1, expiryEnforced: true, admissionDeadline: true, bodies: ['fly-v1'],
      actions: ['start', 'pause', 'rest', 'move', 'leave'], maxConcurrentVisitors: 2,
      controllerRaster: { width: 8, height: 4, channels: 3 } };
    return value; };
  const discovered = await s.bridge.capabilities('a', 'world');
  assert.equal(discovered.available, true);
  assert.equal(discovered.interactionAvailable, false);
  assert.deepEqual(discovered.patchObjects, []);
  assert.deepEqual(discovered.interactionEffects, []);
  assert.equal(discovered.maxConcurrentVisitors, 2);

  const admitted = await s.bridge.admit('a', { worldId: 'world' });
  assert.equal(admitted.phase, 'visiting');
  assert.equal(admitted.interactionAvailable, false);
  assert.deepEqual(admitted.patchObjects, []);
  assert.equal(admitted.interactArmed, false);
  // Interaction is reported unavailable rather than pending or broken, and cannot be armed.
  await assert.rejects(() => s.bridge.control('a', 'interact'), error => error.code === 'unsupported'
    && /did not negotiate the optional patch-object interaction/.test(error.message));

  await s.bridge.control('a', 'start');
  for (let i = 0; i < 12; i++) await s.bridge.tick('a');
  assert.equal(s.runtimes.get('a').snapshot().tick, 12);
  // Move-only behaviour is preserved exactly: no interact ever leaves the process.
  assert(s.calls.every(call => ['start', 'move'].includes(call.action.type)));
  assert(s.calls.some(call => call.action.type === 'move'));
  assert.equal(s.bridge.snapshot('a').lastInteraction, null);
  assert.equal(s.bridge.snapshot('a').lastTrace.action, 'move');

  await s.bridge.control('a', 'home');
  assert.equal(s.owners.has('a'), false);
  assert.equal(s.bridge.snapshot('a').phase, 'home');
  assert.equal(s.runtimes.get('a').snapshot().status, 'paused');
  assert.equal(s.runtimes.get('a').snapshot().tick, 12);
  assert.equal(s.leases.size, 0);
});

test('each unmet visitor setting disables the bridge for its own stated reason and echoes no configured value', async () => {
  const configured = { baseUrl: 'http://127.0.0.1:5555', credential: `mv1_${'a'.repeat(64)}`, appId: 'garden' };
  const unmet = [
    ['host-unset', 'FLY_GARDEN_PORTOS_URL', { baseUrl: undefined }],
    ['host-unsupported', 'FLY_GARDEN_PORTOS_URL', { baseUrl: 'https://portos.example.com' }],
    ['app-unset', 'FLY_GARDEN_MANAGED_APP_ID', { appId: '' }],
    ['app-invalid', 'FLY_GARDEN_MANAGED_APP_ID', { appId: 'not a valid app id' }],
    // NFR-5: PortOS's instance password is optional, and an instance without one provisions no
    // mv1_ credential at all. That case must read differently from an unset or unapproved host.
    ['credential-unset', 'FLY_GARDEN_VISITOR_CREDENTIAL', { credential: undefined }],
    ['credential-invalid', 'FLY_GARDEN_VISITOR_CREDENTIAL', { credential: 'mv1_short' }],
  ];
  const reasons = new Set();
  for (const [code, setting, override] of unmet) {
    let calls = 0;
    const transport = createManagedVisitorTransport({ ...configured, ...override, fetchImpl: () => { calls++; } });
    assert.equal(transport.enabled, false); assert.equal(transport.appId, null);
    assert.equal(transport.configuration.code, code);
    assert.deepEqual(transport.configuration.unresolved, [setting]);
    reasons.add(transport.configuration.reason);
    await assert.rejects(transport.capabilities, error => error.code === 'disabled' && error.message === transport.configuration.reason);
    assert.equal(calls, 0);
    const published = JSON.stringify(transport.configuration);
    assert(!published.includes('a'.repeat(64)) && !published.includes('mv1_short') && !published.includes('portos.example.com'));
  }
  // Six causes, six wordings: no owner ever has to guess which setting is unmet.
  assert.equal(reasons.size, unmet.length);
  const all = createManagedVisitorTransport({ fetchImpl: () => assert.fail('no request') });
  assert.deepEqual(all.configuration.unresolved, ['FLY_GARDEN_PORTOS_URL', 'FLY_GARDEN_MANAGED_APP_ID', 'FLY_GARDEN_VISITOR_CREDENTIAL']);
  const ready = createManagedVisitorTransport({ ...configured, fetchImpl: () => assert.fail('no request') });
  assert.equal(ready.enabled, true); assert.equal(ready.configuration.code, 'ready');
});
test('a disabled bridge names its unmet setting and stays distinct from an unsupported or unauthorized host', async () => {
  const transport = createManagedVisitorTransport({ baseUrl: 'http://127.0.0.1:5555', appId: 'garden', fetchImpl: () => assert.fail('no request') });
  const bridge = createManagedVisitorBridge({ authority: { claim: () => assert.fail('no claim') }, transport });
  const state = bridge.snapshot('a');
  assert.equal(state.available, false); assert.equal(state.configurationCode, 'credential-unset');
  assert.match(state.reason, /optional password unset/);
  assert.deepEqual(bridge.configuration().unresolved, ['FLY_GARDEN_VISITOR_CREDENTIAL']);
  for (const rejected of [bridge.admit('a', { worldId: 'world' }), bridge.capabilities('a')]) {
    await assert.rejects(() => rejected, error => error.code === 'disabled' && error.message === state.reason);
  }
  for (const available of [false, true]) {
    const s = setup(), original = s.transport.capabilities;
    s.transport.capabilities = async () => ({ ...await original(), available, worldIds: ['other-world'] });
    const blocked = await s.bridge.admit('a', { worldId: 'world' });
    assert.equal(blocked.phase, 'blocked'); assert.equal(s.owners.has('a'), false);
    assert.match(blocked.reason, available ? /owner-approved visitor scope/ : /nonhumanoid visitor protocol/);
    assert.notEqual(blocked.reason, state.reason);
  }
});
test('a returned fly needs a new grant: nothing outward resumes and re-admission revalidates the allowlist', async () => {
  const s = setup();
  await s.bridge.admit('a', { worldId: 'world' }); await s.bridge.control('a', 'start');
  for (let i = 0; i < 3; i++) await s.bridge.tick('a');
  const visited = s.bridge.snapshot('a'), calls = s.calls.length, tick = s.runtimes.get('a').snapshot().tick;
  assert(tick >= 3);
  await s.bridge.control('a', 'home');
  assert.equal(s.owners.has('a'), false); assert.equal(s.leases.size, 0);
  const home = s.bridge.snapshot('a');
  assert.equal(home.phase, 'home'); assert.equal(home.owned, false); assert.equal(home.visitEpoch, null);
  // Local state the visit accumulated stays put: same runtime session, same tick, no restore.
  assert.equal(s.runtimes.get('a').snapshot().tick, tick); assert.equal(s.runtimes.get('a').snapshot().sessionId, 'runtime-a');
  // Without a fresh grant no control is accepted and no scheduler tick reaches the host.
  for (const action of ['start', 'pause', 'rest', 'home', 'interact']) {
    await assert.rejects(() => s.bridge.control('a', action), error => error.code === 'unavailable');
  }
  assert.equal(await s.bridge.tick('a'), null); assert.equal(s.calls.length, calls);
  // Re-entry re-runs discovery, so an allowlist the owner narrowed since the last visit is enforced.
  const original = s.transport.capabilities;
  s.transport.capabilities = async () => ({ ...await original(), worldIds: ['other-world'] });
  const refused = await s.bridge.admit('a', { worldId: 'world' });
  assert.equal(refused.phase, 'blocked'); assert.match(refused.reason, /owner-approved visitor scope/);
  assert.equal(s.owners.has('a'), false); assert.equal(s.leases.size, 0); assert.equal(s.calls.length, calls);
  s.transport.capabilities = original;
  const again = await s.bridge.admit('a', { worldId: 'world' });
  assert.equal(again.phase, 'visiting'); assert.equal(again.running, false);
  assert.notEqual(again.visitEpoch, visited.visitEpoch);
  assert.equal(s.runtimes.get('a').snapshot().tick, tick);
});
