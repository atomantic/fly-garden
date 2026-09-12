import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('../scripts/measure-connectome-memory.js', import.meta.url));
const run = args => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 5000 });
test('memory measurement requires explicit opt-in and bounded configuration before loading', () => {
  const disabled = run(['--dataset', 'male-cns:v1.0', '--data', '/not-a-connectome']);
  assert.notEqual(disabled.status, 0); assert.match(disabled.stderr, /Explicit --measure/); assert.equal(disabled.stdout, '');
  const unbounded = run(['--measure', '--dataset', 'banc:v888', '--data', '/not-a-connectome', '--max-memory-mib', '999999']);
  assert.notEqual(unbounded.status, 0); assert.match(unbounded.stderr, /Memory bound/); assert.equal(unbounded.stdout, '');
});
test('missing pinned data terminates and produces no successful fixture measurement', () => {
  const result = run(['--measure', '--dataset', 'banc:v888', '--data', '/not-a-connectome']);
  assert.equal(result.error, undefined); assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Pinned graph unavailable/); assert.equal(result.stdout, '');
});
