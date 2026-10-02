import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runFixtureIntegration } from '../scripts/run-fixture-integration.js';
import { createHostDouble } from '../scripts/fixture-integration/host-double.js';

test('fixture harness requires explicit invocation and rejects unknown options', () => {
  for (const args of [[], ['--run', '--host=http://example.test'], ['--help']]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/run-fixture-integration.js', import.meta.url)), ...args],
      { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 2); assert.equal(result.stdout, '');
    assert.match(result.stderr, /Explicit invocation required/);
  }
});

test('one HTTP fixture session produces scoped evidence and never claims missing acceptance', async () => {
  const report = await runFixtureIntegration();
  assert.equal(report.outcome, 'pass', JSON.stringify(report.checks));
  assert.equal(report.integrationAcceptance, 'unavailable');
  assert.deepEqual(report.checks.map(check => check.id), ['paused-boot-and-observer', 'garden-to-artifact',
    'replayed-garden-frame', 'acknowledged-visit-and-return', 'denied', 'old-version', 'stale-frame',
    'prior-epoch', 'disconnect', 'saved-paused-reopen']);
  assert(report.checks.every(check => check.outcome === 'pass'));
  assert(report.unavailable.every(check => check.outcome === 'unavailable'));
  assert.equal(report.provenance.dataset.namespace, 'synthetic-fixture');
  assert.match(report.provenance.harnessSha256, /^[a-f0-9]{64}$/);
  const art = report.checks.find(check => check.id === 'garden-to-artifact').evidence;
  assert.equal(art.acceptedActions, 40); assert.equal(art.events, 0);
  const visit = report.checks.find(check => check.id === 'acknowledged-visit-and-return').evidence;
  assert(visit.returnedTick > visit.homeTick && visit.returnedTick <= visit.homeTick + 3);
  const published = JSON.stringify(report);
  assert.doesNotMatch(published, /controllerToken|mv1_|127\.0\.0\.1|\/Users\/|\/tmp\//);
});

test('broken visitor acknowledgment fails the report without publishing untrusted exception text', async () => {
  const report = await runFixtureIntegration({ hostFactory(id) {
    const host = createHostDouble(id);
    host.transport.admit = async () => { throw new Error('private-response-secret'); };
    return host;
  } });
  assert.equal(report.outcome, 'failed'); assert.equal(report.integrationAcceptance, 'unavailable');
  assert.equal(report.checks.at(-1).id, 'acknowledged-visit-and-return');
  assert.equal(report.checks.at(-1).outcome, 'failed');
  assert.doesNotMatch(JSON.stringify(report), /private-response-secret/);
  assert(!report.checks.some(check => check.id === 'saved-paused-reopen'));
});
