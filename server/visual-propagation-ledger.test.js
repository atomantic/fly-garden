import test from 'node:test';
import assert from 'node:assert/strict';
import { contactLedger, decayedVolley } from './visual-propagation-ledger.js';
const model = { contactGain: .001, dtMs: 1, tauMs: 20 };
const graph = { ids: ['source', 'target', 'quiet'], offsets: [0, 2, 2, 2], targets: [0, 1], contacts: [2000, 74], signs: [-1, 0, 0] };
test('inhibitory volley and refractory self-edge preserve zero global maximum', () => {
  const result = contactLedger(graph, ['source'], { left: 'target' });
  assert.deepEqual(result.minimum, { neuronId: 'target', signedContacts: -74 });
  assert.equal(result.maximum.signedContacts, 0); assert.equal(result.contacts, 2074);
  assert.equal(result.totalEdges, 2); assert.equal(result.motor.left.signedContacts, -74);
});
test('raw contact gain is not normalized; 74 contacts stay below threshold and decay', () => {
  const result = contactLedger({ ...graph, signs: [1, 0, 0] }, ['source']);
  assert.equal(result.maximum.signedContacts, 74);
  assert.equal(decayedVolley(74, 0, model), .074);
  assert.ok(Math.abs(decayedVolley(74, 20, model) - .074 / Math.E) < 1e-16);
  assert.throws(() => contactLedger(graph, ['source', 'source']));
  assert.throws(() => contactLedger(graph, ['absent']));
  assert.throws(() => decayedVolley(74, -1, model));
});
