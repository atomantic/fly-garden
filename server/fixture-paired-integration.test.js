import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runPairedFixtureIntegration } from '../scripts/run-paired-fixture-integration.js';
import { createPairedHostDouble } from '../scripts/fixture-integration/paired-host-double.js';

const CHECKS = ['local-capacity-admits-two-and-refuses-a-third', 'home-state-per-individual', 'per-individual-language-budgets',
  'late-provider-reply-keeps-its-recipient', 'split-location-a-visits-b-home', 'both-visiting-with-distinct-epochs',
  'revocation-of-a-leaves-b-visiting', 'peer-scope-reply-for-a-cannot-command-b', 'stale-epoch-reply-for-a-cannot-command-b',
  'independent-return-in-both-directions', 'host-wide-disconnect-with-confirmed-cleanup', 'host-wide-unreachable-host-holds-both-paused',
  'paired-round-trip-continuity', 'older-host-refuses-second-visitor', 'saved-paused-reopen-pair'];
const evidence = (report, id) => report.checks.find(check => check.id === id).evidence;
const requirement = (report, id) => report.requirements.find(value => value.id === id);

test('paired harness requires explicit invocation and rejects unknown options', () => {
  for (const args of [[], ['--run', '--host=http://example.test'], ['--paired'], ['--help']]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/run-paired-fixture-integration.js', import.meta.url)), ...args],
      { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 2); assert.equal(result.stdout, '');
    assert.match(result.stderr, /Explicit invocation required/);
  }
});

test('one paired HTTP fixture run produces scoped evidence and never claims missing acceptance', async () => {
  let cause = null;
  const report = await runPairedFixtureIntegration({ onFailure: (error, step) => { cause = `${step}: ${error?.stack ?? error}`; } });
  assert.equal(report.outcome, 'pass', cause ?? JSON.stringify(report.checks));
  assert.equal(report.integrationAcceptance, 'unavailable');
  assert.deepEqual(report.checks.map(check => check.id), CHECKS);
  assert(report.checks.every(check => check.outcome === 'pass'));
  assert(report.unavailable.every(check => check.outcome === 'unavailable'));
  for (const id of ['live-managed-host', 'rendered-observer', 'admin-ui-selection', 'full-connectome-embodiment', 'retained-learning',
    'shared-habitat-coupling', 'language-provider']) assert(report.unavailable.some(check => check.id === id), id);
  assert.equal(report.provenance.dataset.namespace, 'synthetic-fixture');
  for (const key of ['harnessSha256', 'hostDoubleSha256', 'dependencyLockSha256']) assert.match(report.provenance[key], /^[a-f0-9]{64}$/);

  // FR-40: two distinct, separately admitted flies; the second observer is explicitly not a rendered one.
  const both = evidence(report, 'both-visiting-with-distinct-epochs');
  assert.equal(both.negotiatedCapacity, 2); assert.equal(both.hostLeases, 2);
  assert.equal(new Set(both.distinctVisitEpochs).size, 2);
  assert(both.ticksAdvanced.A >= 3 && both.ticksAdvanced.B >= 3);
  assert.equal(both.secondObserver, 'local-http-reader-not-rendered');
  const split = evidence(report, 'split-location-a-visits-b-home');
  assert.notEqual(split.podLabels.A, split.podLabels.B); assert.equal(split.hostLeases, 1);
  for (const id of ['peer-scope-reply-for-a-cannot-command-b', 'stale-epoch-reply-for-a-cannot-command-b']) assert.equal(evidence(report, id).hostScopeViolations, 0);
  const older = evidence(report, 'older-host-refuses-second-visitor');
  assert.equal(older.hostPublishedCapacityField, false); assert.equal(older.bridgeReadsCapacityAs, 1); assert.equal(older.hostAdmissionRequests, 1);
  assert.match(older.reason, /Host negotiated 1 concurrent managed visitor/);

  // Per-individual provider budgets: each fly spent only its own ceiling, no real provider was involved, and nothing was refunded.
  const budgets = evidence(report, 'per-individual-language-budgets');
  assert.equal(budgets.providerKind, 'in-process-synthetic-double'); assert.equal(budgets.providerCalls, 2);
  assert.deepEqual(budgets.reserved.A, { calls: 1, tokens: 4096, spendMicros: 100 });
  assert.deepEqual(budgets.reserved.B, { calls: 1, tokens: 4096, spendMicros: 100 });
  assert.equal(budgets.aggregateReservedSpendMicros, 200); assert.equal(budgets.overCeilingRefusedForB, 'Language budget exhausted.');
  assert.equal(evidence(report, 'late-provider-reply-keeps-its-recipient').lateReplyDelivered, false);

  // Continuity is reported with its limit: unsupported state is named, never implied.
  const continuity = evidence(report, 'paired-round-trip-continuity');
  assert.deepEqual(continuity.notCarriedBecauseUnsupported, ['rng', 'plasticity', 'refractory', 'delayBuffers', 'embodiment']);
  for (const fly of ['A', 'B']) assert(continuity.ticksBeforeAndAfter[fly][1] > continuity.ticksBeforeAndAfter[fly][0]);
  assert.equal(continuity.hostScopeViolations, 0);
  assert.notDeepEqual(continuity.hostSteps, { A: 0, B: 0 });

  // FR-36–40 are reported clause by clause. Nothing this fixture run cannot see is upgraded to a pass.
  assert.deepEqual(report.requirements.map(value => value.id), ['FR-36', 'FR-37', 'FR-38', 'FR-39', 'FR-40']);
  assert.deepEqual(report.requirements.map(value => value.outcome), ['unavailable', 'partial', 'partial', 'unavailable', 'partial']);
  assert(requirement(report, 'FR-38').clauses.some(clause => /RNG and learning/.test(clause.clause) && clause.outcome === 'unavailable'));
  assert(requirement(report, 'FR-40').clauses.some(clause => /rendered host/.test(clause.clause) && clause.outcome === 'unavailable'));
  assert(requirement(report, 'FR-40').clauses.filter(clause => clause.checks).every(clause => clause.outcome === 'pass'));

  // Nothing private is published: no individual or session identifier, token, credential, address or path.
  const published = JSON.stringify(report);
  assert.doesNotMatch(published, /controllerToken|mv1_|127\.0\.0\.1|\/Users\/|\/tmp\/|LATE-SYNTHETIC-REPLY/);
  assert.doesNotMatch(published, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
});

test('a host that publishes capacity one fails the paired run at the second admission instead of passing vacuously', async () => {
  const report = await runPairedFixtureIntegration({ hostFactory: ids => createPairedHostDouble(ids, { capacity: 1 }) });
  assert.equal(report.outcome, 'failed'); assert.equal(report.integrationAcceptance, 'unavailable');
  assert.equal(report.checks.at(-1).id, 'both-visiting-with-distinct-epochs'); assert.equal(report.checks.at(-1).outcome, 'failed');
  assert.equal(requirement(report, 'FR-40').outcome, 'failed');
  assert(!report.checks.some(check => check.id === 'revocation-of-a-leaves-b-visiting'));
  assert.doesNotMatch(JSON.stringify(report), /Host negotiated/);
});

test('a host that revokes every visitor when one grant is revoked fails the independence check', async () => {
  let cause = null;
  const report = await runPairedFixtureIntegration({ onFailure: (error, step) => { cause = `${step}: ${error?.stack ?? error}`; }, hostFactory(ids, options) {
    const host = createPairedHostDouble(ids, options), known = new Set(ids), allow = host.allow, setFault = host.setFault;
    host.allow = id => { known.add(id); allow(id); };
    host.setFault = (id, fault) => { for (const other of known) setFault(other, fault); };
    return host;
  } });
  assert.equal(report.outcome, 'failed');
  assert.equal(report.checks.at(-1).id, 'revocation-of-a-leaves-b-visiting', cause); assert.equal(report.checks.at(-1).outcome, 'failed');
  assert(report.checks.some(check => check.id === 'both-visiting-with-distinct-epochs' && check.outcome === 'pass'));
  assert.equal(requirement(report, 'FR-40').outcome, 'failed');
});

test('broken visitor acknowledgment fails the paired report without publishing untrusted exception text', async () => {
  const report = await runPairedFixtureIntegration({ hostFactory(ids, options) {
    const host = createPairedHostDouble(ids, options);
    host.transport.admit = async () => { throw new Error('private-response-secret'); };
    return host;
  } });
  assert.equal(report.outcome, 'failed'); assert.equal(report.checks.at(-1).outcome, 'failed');
  assert.equal(report.checks.at(-1).id, 'late-provider-reply-keeps-its-recipient');
  assert.doesNotMatch(JSON.stringify(report), /private-response-secret/);
  assert(!report.checks.some(check => check.id === 'saved-paused-reopen-pair'));
  assert(report.requirements.every(value => value.outcome !== 'pass'));
});

test('the paired host double scopes every lease, omits capacity like an older host, and counts out-of-scope requests', async () => {
  const older = createPairedHostDouble(['a'], { capacity: null });
  assert.equal(Object.hasOwn((await older.transport.capabilities()).contract, 'maxConcurrentVisitors'), false);
  assert.equal((await createPairedHostDouble(['a']).transport.capabilities()).contract.maxConcurrentVisitors, 2);

  const host = createPairedHostDouble(['a', 'b'], { capacity: 2 });
  const scope = (individualId, lease) => ({ individualId, individualSessionId: `${individualId}-session`, worldId: 'fixture-world', epoch: lease.epoch });
  const leaseA = await host.transport.admit({ individualId: 'a', individualSessionId: 'a-session', worldId: 'fixture-world', ttlMs: 30000 });
  const leaseB = await host.transport.admit({ individualId: 'b', individualSessionId: 'b-session', worldId: 'fixture-world', ttlMs: 30000 });
  assert.notEqual(leaseA.epoch, leaseB.epoch); assert.notEqual(leaseA.sessionId, leaseB.sessionId);
  await assert.rejects(host.transport.admit({ individualId: 'a', individualSessionId: 'a-session', worldId: 'fixture-world', ttlMs: 30000 }), /capacity/);
  // A request for A's lease that carries B's scope is refused and counted; it never reaches B's lease.
  await assert.rejects(host.transport.observe(leaseA.sessionId, scope('b', leaseB)), /outside its lease scope/);
  assert.equal(host.counts().scopeViolations, 1);
  host.setFault('a', 'revoked');
  await assert.rejects(host.transport.observe(leaseA.sessionId, scope('a', leaseA)), /revoked/);
  assert.equal((await host.transport.observe(leaseB.sessionId, scope('b', leaseB))).individualId, 'b');
  host.setFault('a', 'peer-scope'); host.clearFault('b');
  assert.equal((await host.transport.observe(leaseA.sessionId, scope('a', leaseA))).individualId, 'b');
  host.clearFault('a');
  host.setHostMode('unreachable');
  await assert.rejects(host.transport.leave(leaseA.sessionId, scope('a', leaseA)), /unreachable/);
  assert.equal(host.counts().leases, 2);
  host.setHostMode('supported');
  await host.transport.leave(leaseA.sessionId, scope('a', leaseA));
  assert.deepEqual(host.counts().leased, ['b']);
});
