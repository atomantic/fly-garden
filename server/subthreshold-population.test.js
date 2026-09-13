import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveHopTwoGroups, subthresholdFeature, buildGraphIndex } from './subthreshold-population.js';

function tinyGraph() {
  // 6 neurons: 0=left/L1, 1=left/L2, 2=right/L1, 3=right/L2, 4=hop2-left-target, 5=hop2-right-target.
  // left ports (0,1) both contact index4; right ports (2,3) both contact index5.
  const ids = ['a/1', 'a/2', 'a/3', 'a/4', 'a/5', 'a/6'];
  return { ids, offsets: new Uint32Array([0, 1, 2, 3, 4, 4, 4]), targets: new Uint32Array([4, 4, 5, 5]) };
}
const mapping = { inputs: [
  { neuronId: 'a/1', side: 'left' }, { neuronId: 'a/2', side: 'left' },
  { neuronId: 'a/3', side: 'right' }, { neuronId: 'a/4', side: 'right' },
] };

test('resolves disjoint hop-2 target sets by side and reuses a prebuilt index', () => {
  const graph = tinyGraph();
  const groups = resolveHopTwoGroups(graph, mapping, buildGraphIndex(graph.ids));
  assert.deepEqual([...groups.leftTargets], [4]);
  assert.deepEqual([...groups.rightTargets], [5]);
  assert.deepEqual(groups.sourceIndexBySide, { left: [0, 1], right: [2, 3] });
});

test('a hop-2 neuron reached from both sides contributes to both group means (no exclusive partition)', () => {
  const graph = { ids: ['a/1', 'a/2', 'a/3'], offsets: new Uint32Array([0, 1, 2, 2]), targets: new Uint32Array([2, 2]) };
  const shared = { inputs: [{ neuronId: 'a/1', side: 'left' }, { neuronId: 'a/2', side: 'right' }] };
  const groups = resolveHopTwoGroups(graph, shared);
  assert.deepEqual([...groups.leftTargets], [2]);
  assert.deepEqual([...groups.rightTargets], [2]);
});

test('feature is mean(right) - mean(left), reading directly from the potential array', () => {
  const graph = tinyGraph();
  const groups = resolveHopTwoGroups(graph, mapping);
  const potential = new Float64Array([0, 0, 0, 0, -0.3, 0.5]);
  assert.equal(subthresholdFeature(potential, groups), 0.5 - -0.3);
});

test('rejects a port absent from the graph, an unresolved side, or an empty side group', () => {
  const graph = tinyGraph();
  assert.throws(() => resolveHopTwoGroups(graph, { inputs: [{ neuronId: 'missing', side: 'left' }] }));
  assert.throws(() => resolveHopTwoGroups(graph, { inputs: [{ neuronId: 'a/1', side: 'up' }] }));
  const onlyLeft = { inputs: [{ neuronId: 'a/1', side: 'left' }] };
  assert.throws(() => resolveHopTwoGroups(graph, onlyLeft));
});
