import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveVisitorPreview, projectVisitorPose } from '../client/src/visitor-preview.js';

const makeVisitor = (overrides = {}) => ({
  version: 1,
  individualId: 'fly-a',
  individualSessionId: 'runtime-a',
  visitEpoch: 'epoch-a-1',
  owned: true,
  running: true,
  phase: 'visiting',
  lastTrace: {
    individualId: 'fly-a',
    individualSessionId: 'runtime-a',
    visitEpoch: 'epoch-a-1',
    frameId: 12,
    inputSimTimeMs: 60,
    outputSimTimeMs: 65,
    sensorySource: 'engineered-gentle-patch-spatial-proxy-v1',
    motor: { forward: 0.04, yaw: -0.2 },
    pose: { x: 0.6, z: -0.4, yaw: 1.2 },
    action: 'move',
    objectId: null,
  },
  lastInteraction: null,
  ...overrides,
});

test('derives a render-only projection only from a current acknowledged visitor trace', () => {
  const preview = deriveVisitorPreview(makeVisitor());
  assert.equal(preview.available, true);
  assert.equal(preview.renderOnly, true);
  assert.equal(preview.individualId, 'fly-a');
  assert.equal(preview.visitEpoch, 'epoch-a-1');
  assert.equal(preview.frameId, 12);
  assert.equal(preview.action, 'move');
  assert.deepEqual(preview.pose, { x: 0.6, z: -0.4, yaw: 1.2 });
  assert.deepEqual(preview.motor, { forward: 0.04, yaw: -0.2 });
  assert.equal(Object.hasOwn(preview, 'patchObjects'), false);
  assert.equal(Object.hasOwn(preview, 'target'), false);
  assert(Object.isFrozen(preview));
  assert(Object.isFrozen(preview.pose));
});

test('exposes a settled interaction only when its scoped host acknowledgment is present', () => {
  const visitor = makeVisitor({
    lastTrace: { ...makeVisitor().lastTrace, action: 'interact', objectId: 'gentle-patch-a' },
    lastInteraction: { individualId: 'fly-a', visitEpoch: 'epoch-a-1', frameId: 12, sequence: 4,
      objectId: 'gentle-patch-a', effect: 'settle', pose: { x: 0.6, z: -0.4, yaw: 1.2 } },
  });
  const preview = deriveVisitorPreview(visitor);
  assert.equal(preview.action, 'interact');
  assert.deepEqual(preview.interaction, { objectId: 'gentle-patch-a', effect: 'settle', frameId: 12, sequence: 4 });
  assert.equal(Object.hasOwn(preview, 'targetCoordinates'), false);
});

test('rejects stale, mismatched, malformed, and non-visiting traces', () => {
  const cases = [
    makeVisitor({ phase: 'home' }),
    makeVisitor({ visitEpoch: 'epoch-a-2' }),
    makeVisitor({ individualId: 'fly-b' }),
    makeVisitor({ lastTrace: { ...makeVisitor().lastTrace, sensorySource: 'observer-camera' } }),
    makeVisitor({ lastTrace: { ...makeVisitor().lastTrace, motor: { forward: 1, yaw: 0 } } }),
    makeVisitor({ lastTrace: { ...makeVisitor().lastTrace, pose: { x: 3, z: 0, yaw: 0 } } }),
    makeVisitor({ lastTrace: { ...makeVisitor().lastTrace, action: 'interact', objectId: 'gentle-patch-a' } }),
    makeVisitor({ lastTrace: { ...makeVisitor().lastTrace, action: 'interact', objectId: 'gentle-patch-a' },
      lastInteraction: { individualId: 'fly-a', visitEpoch: 'epoch-a-1', frameId: 12, sequence: 4,
        objectId: 'gentle-patch-a', effect: 'settle', pose: { x: 0.7, z: -0.4, yaw: 1.2 } } }),
    makeVisitor({ lastTrace: { ...makeVisitor().lastTrace, visitEpoch: 'epoch-a-0' } }),
  ];
  for (const visitor of cases) {
    const preview = deriveVisitorPreview(visitor);
    assert.equal(preview.available, false);
    assert.equal(preview.renderOnly, true);
  }
});

test('projects only bounded poses into the local observer stage', () => {
  assert.deepEqual(projectVisitorPose({ x: -2, z: 2, yaw: 0 }), { x: 80, y: 324 });
  assert.deepEqual(projectVisitorPose({ x: 2, z: -2, yaw: 0 }), { x: 560, y: 36 });
  assert.equal(projectVisitorPose({ x: 2.1, z: 0, yaw: 0 }), null);
});
