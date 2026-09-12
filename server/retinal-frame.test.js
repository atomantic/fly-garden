import test from 'node:test';
import assert from 'node:assert/strict';
import { topDownRetinalRGB, environmentKey } from '../client/src/retinal-frame.js';
test('controller readback flips rows and drops alpha without camera/world metadata', () => {
  const rgba = new Uint8Array(128);
  for (let i = 0; i < 32; i++) rgba.set([i, i + 1, i + 2, 255], i * 4);
  const rgb = topDownRetinalRGB(rgba); assert.equal(rgb.length, 96);
  assert.deepEqual(rgb.slice(0, 3), [24, 25, 26]); assert.deepEqual(rgb.slice(-3), [7, 8, 9]);
  assert.throws(() => topDownRetinalRGB(new Uint8Array(127)), /Invalid/);
});
test('frame response identity includes individual, runtime session and environment epoch', () => {
  const state = { individualId: 'one', sessionId: 'session', environmentAdapter: { attached: true, environmentEpoch: 'epoch' } };
  const key = environmentKey(state);
  for (const changed of [{ ...state, individualId: 'two' }, { ...state, sessionId: 'restored' }, { ...state, environmentAdapter: { attached: true, environmentEpoch: 'new' } }]) assert.notEqual(environmentKey(changed), key);
  assert.equal(environmentKey({ ...state, environmentAdapter: { attached: false } }), null);
});
