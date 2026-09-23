import { randomUUID, createHash } from 'node:crypto';
import { constants, mkdirSync, lstatSync, fstatSync, openSync, closeSync, readFileSync, writeFileSync, fsyncSync, renameSync, unlinkSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { RuntimeError } from './runtime.js';

/**
 * Cross-catalog research checkpoint coordinator (#108).
 *
 * Coordinates one joint save or restore across independent catalogs (the synthetic fixture identity
 * catalog and one or more full-connectome catalogs) through a declared adapter contract and a durable
 * recovery journal. It never starts a simulation, couples a sensory/motor path or infers embodiment.
 * Adapters own their catalog's payload validation, immutable staging and runtime restoration; this module
 * owns membership snapshots, reservations, fixed commit order, compensation and fail-closed recovery.
 */
export const CROSS_CATALOG_CONTRACT_VERSION = 1;
export const CROSS_CATALOG_TYPES = Object.freeze(['fixture-identity', 'full-connectome']);
export const CROSS_CATALOG_LIMITS = Object.freeze({ members: 64, catalogs: 8, jointHistory: 64, transactionHistory: 256, journalBytes: 2 * 1024 * 1024 });
const OPEN_STATES = Object.freeze(['staged', 'committing', 'activating', 'recovery-required']);
const TERMINAL_STATES = Object.freeze(['committed', 'rolled-back', 'aborted', 'unloaded']);
const CATALOG_STATES = Object.freeze(['staged', 'committed', 'failed', 'uncertain', 'reverting', 'reverted', 'cancelled']);
const ADAPTER_METHODS = Object.freeze(['epoch', 'member', 'reserve', 'preflight', 'stage', 'commit', 'cancel', 'revert', 'activate', 'evict']);
const JOINT_KEYS = Object.freeze(['jointCheckpointId', 'createdAt', 'payload', 'sha256']);
const PAYLOAD_KEYS = Object.freeze(['version', 'kind', 'intervalMs', 'tick', 'members']);
const JOINT_MEMBER_KEYS = Object.freeze(['individualId', 'catalogType', 'catalogId', 'dataset', 'graphSha256', 'modelId', 'checkpointId', 'checkpointSha256', 'simTimeMs', 'mode']);
const TRANSACTION_KEYS = Object.freeze(['transactionId', 'operation', 'state', 'createdAt', 'updatedAt', 'intervalMs', 'tick', 'jointCheckpointId', 'catalogs', 'members', 'reason']);
const TRANSACTION_CATALOG_KEYS = Object.freeze(['catalogType', 'catalogId', 'catalogEpoch', 'state']);
const TRANSACTION_MEMBER_KEYS = Object.freeze(['individualId', 'catalogType', 'catalogId', 'dataset', 'graphSha256', 'modelId', 'mode', 'priorHead', 'plannedHead', 'selectedHead', 'sourceCheckpointId', 'checkpointSha256', 'simTimeMs']);
const JOURNAL_KEYS = Object.freeze(['schemaVersion', 'kind', 'jointCheckpoints', 'transactions', 'sha256']);
const DISCLOSURE = 'Cross-catalog research checkpoint transaction. It coordinates durable heads and paused runtime restoration only; it is not embodied, sensory, learned or biological behavior.';

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const shaValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const catalogIdValid = value => typeof value === 'string' && /^[a-z0-9][a-z0-9:._-]{0,63}$/.test(value);
const text = (value, max = 128) => typeof value === 'string' && value.length > 0 && value.length <= max;
const nullable = (value, test) => value === null || test(value);
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (message, code = 'CROSS_CATALOG_REFUSED', extra = {}) => { throw Object.assign(new RuntimeError(message, 409), { code, ...extra }); };
const corrupt = () => fail('Cross-catalog journal is corrupt or incompatible; existing files preserved.', 'CROSS_CATALOG_JOURNAL_CORRUPT');
const journalDigest = value => sha({ schemaVersion: value.schemaVersion, kind: value.kind, jointCheckpoints: value.jointCheckpoints, transactions: value.transactions });

function validateJointMember(member) {
  if (!exact(member, JOINT_MEMBER_KEYS) || !uuid(member.individualId) || !CROSS_CATALOG_TYPES.includes(member.catalogType) || !catalogIdValid(member.catalogId)
    || !text(member.dataset) || !nullable(member.graphSha256, shaValid) || !nullable(member.modelId, text) || !uuid(member.checkpointId)
    || !shaValid(member.checkpointSha256) || !integer(member.simTimeMs) || !['active', 'resting'].includes(member.mode)) corrupt();
}
function validateJoint(joint) {
  if (!exact(joint, JOINT_KEYS) || !uuid(joint.jointCheckpointId) || !integer(joint.createdAt) || !shaValid(joint.sha256) || joint.sha256 !== sha(joint.payload)) corrupt();
  const payload = joint.payload;
  if (!exact(payload, PAYLOAD_KEYS) || payload.version !== 1 || payload.kind !== 'cross-catalog-joint' || payload.intervalMs !== 5 || !integer(payload.tick)
    || !Array.isArray(payload.members) || payload.members.length < 2 || payload.members.length > CROSS_CATALOG_LIMITS.members) corrupt();
  payload.members.forEach(validateJointMember);
  if (new Set(payload.members.map(member => member.individualId)).size !== payload.members.length) corrupt();
}
function validateTransaction(record) {
  if (!exact(record, TRANSACTION_KEYS) || !uuid(record.transactionId) || !['save', 'restore'].includes(record.operation)
    || ![...OPEN_STATES, ...TERMINAL_STATES].includes(record.state) || !integer(record.createdAt) || !integer(record.updatedAt)
    || record.intervalMs !== 5 || !integer(record.tick) || !uuid(record.jointCheckpointId) || !nullable(record.reason, value => text(value, 512))
    || !Array.isArray(record.catalogs) || !record.catalogs.length || record.catalogs.length > CROSS_CATALOG_LIMITS.catalogs
    || !Array.isArray(record.members) || record.members.length < 2 || record.members.length > CROSS_CATALOG_LIMITS.members) corrupt();
  const catalogs = new Set();
  for (const catalog of record.catalogs) {
    if (!exact(catalog, TRANSACTION_CATALOG_KEYS) || !CROSS_CATALOG_TYPES.includes(catalog.catalogType) || !catalogIdValid(catalog.catalogId)
      || catalogs.has(catalog.catalogId) || !text(catalog.catalogEpoch) || !CATALOG_STATES.includes(catalog.state)) corrupt();
    catalogs.add(catalog.catalogId);
  }
  const ids = new Set();
  for (const member of record.members) {
    if (!exact(member, TRANSACTION_MEMBER_KEYS) || !uuid(member.individualId) || ids.has(member.individualId) || !catalogs.has(member.catalogId)
      || record.catalogs.find(catalog => catalog.catalogId === member.catalogId).catalogType !== member.catalogType
      || !text(member.dataset) || !nullable(member.graphSha256, shaValid) || !nullable(member.modelId, text) || !['active', 'resting'].includes(member.mode)
      || !nullable(member.priorHead, uuid) || !uuid(member.plannedHead) || !nullable(member.selectedHead, uuid)
      || !nullable(member.sourceCheckpointId, uuid) || (record.operation === 'restore') !== (member.sourceCheckpointId !== null)
      || !shaValid(member.checkpointSha256) || !integer(member.simTimeMs)) corrupt();
    ids.add(member.individualId);
  }
}
function validateJournal(value) {
  if (!exact(value, JOURNAL_KEYS) || value.schemaVersion !== 1 || value.kind !== 'cross-catalog-journal' || value.sha256 !== journalDigest(value)
    || !Array.isArray(value.jointCheckpoints) || value.jointCheckpoints.length > CROSS_CATALOG_LIMITS.jointHistory
    || !Array.isArray(value.transactions) || value.transactions.length > CROSS_CATALOG_LIMITS.transactionHistory) corrupt();
  value.jointCheckpoints.forEach(validateJoint);
  value.transactions.forEach(validateTransaction);
  if (new Set(value.jointCheckpoints.map(joint => joint.jointCheckpointId)).size !== value.jointCheckpoints.length
    || new Set(value.transactions.map(record => record.transactionId)).size !== value.transactions.length) corrupt();
  // At most one open transaction, and only as the newest record: a later transaction cannot start while one is unresolved.
  const open = value.transactions.flatMap((record, index) => OPEN_STATES.includes(record.state) ? [index] : []);
  if (open.length > 1 || open.length === 1 && open[0] !== value.transactions.length - 1) corrupt();
  return value;
}
function readBounded(path, max) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat = fstatSync(fd); if (!stat.isFile() || stat.size > max) corrupt(); return readFileSync(fd); }
  finally { closeSync(fd); }
}
function atomicReplace(path, bytes) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, path);
  } finally { try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}
function fsyncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** One bounded, checksummed journal document per coordinator directory, replaced atomically under an OS-backed writer lock. */
export function openCrossCatalogJournal(directory, { writeDocument = atomicReplace, syncDirectory = fsyncDirectory, capacityBytes = CROSS_CATALOG_LIMITS.journalBytes } = {}) {
  if (!Number.isSafeInteger(capacityBytes) || capacityBytes < 512 || capacityBytes > CROSS_CATALOG_LIMITS.journalBytes) throw new Error('Invalid cross-catalog journal capacity');
  directory = resolve(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) corrupt();
  const path = join(directory, 'journal.json'), files = readdirSync(directory);
  if (!files.includes('journal.json') && files.length !== 0) throw new Error('Refusing to initialize a nonempty cross-catalog journal directory');
  const lock = new DatabaseSync(join(directory, 'writer.sqlite'));
  try { lock.exec('CREATE TABLE IF NOT EXISTS writer (id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE'); }
  catch { lock.close(); throw new Error('Cross-catalog journal is already open or its writer lock is unavailable'); }
  let current, closed = false, uncertain = false;
  function write(next) {
    if (closed) fail('Cross-catalog journal closed.', 'CROSS_CATALOG_UNAVAILABLE');
    if (uncertain) fail('Cross-catalog journal durability is uncertain; close and reopen before further transactions.', 'CROSS_CATALOG_RECOVERY_REQUIRED');
    next = structuredClone(next); next.sha256 = journalDigest(next); validateJournal(next);
    const bytes = Buffer.from(JSON.stringify(next));
    if (bytes.length > capacityBytes) fail('Cross-catalog journal capacity reached; no history was deleted.', 'CROSS_CATALOG_CAPACITY');
    writeDocument(path, bytes); current = next;
    try { syncDirectory(directory); }
    catch { uncertain = true; fail('Cross-catalog journal replaced but directory durability is uncertain; close and reopen before recovery.', 'CROSS_CATALOG_JOURNAL_UNCERTAIN'); }
  }
  try {
    if (files.includes('journal.json')) { current = validateJournal(JSON.parse(readBounded(path, capacityBytes).toString())); syncDirectory(directory); }
    else write({ schemaVersion: 1, kind: 'cross-catalog-journal', jointCheckpoints: [], transactions: [] });
  } catch (error) { lock.close(); throw error; }
  return {
    document: () => { if (closed) fail('Cross-catalog journal closed.', 'CROSS_CATALOG_UNAVAILABLE'); return structuredClone(current); },
    /** Projected size check before any catalog is staged; refusal writes nothing. */
    fits: next => Buffer.byteLength(JSON.stringify({ ...next, sha256: '0'.repeat(64) })) <= capacityBytes,
    write,
    uncertain: () => uncertain,
    close() { if (!closed) { closed = true; lock.close(); } },
  };
}

function validateAdapter(adapter) {
  if (!adapter || adapter.contractVersion !== CROSS_CATALOG_CONTRACT_VERSION || !CROSS_CATALOG_TYPES.includes(adapter.catalogType) || !catalogIdValid(adapter.catalogId)
    || ADAPTER_METHODS.some(name => typeof adapter[name] !== 'function')) throw new Error('Invalid or unsupported cross-catalog adapter declaration');
  return adapter;
}
function validView(view, adapter, individualId) {
  return exact(view, ['individualId', 'catalogType', 'head', 'dataset', 'graphSha256', 'modelId', 'status', 'mode', 'sessionEpoch', 'simTimeMs'])
    && view.individualId === individualId && view.catalogType === adapter.catalogType && nullable(view.head, uuid) && text(view.dataset)
    && nullable(view.graphSha256, shaValid) && nullable(view.modelId, text) && text(view.status) && ['active', 'resting'].includes(view.mode)
    && text(view.sessionEpoch) && integer(view.simTimeMs);
}
const affected = members => members.map(member => ({ individualId: member.individualId, catalogType: member.catalogType, catalogId: member.catalogId,
  priorHead: member.priorHead, plannedHead: member.plannedHead, selectedHead: member.selectedHead }));

/** Explicit paused coordinator. Adapters are trusted server-side integrations; browser input selects IDs only. */
export function createCrossCatalogCoordinator({ journal, catalogs, now = Date.now } = {}) {
  if (!journal || typeof journal.document !== 'function' || typeof journal.write !== 'function' || !Array.isArray(catalogs) || !catalogs.length
    || catalogs.length > CROSS_CATALOG_LIMITS.catalogs || typeof now !== 'function') throw new Error('Invalid cross-catalog coordinator configuration');
  const byId = new Map();
  for (const adapter of catalogs.map(validateAdapter)) {
    if (byId.has(adapter.catalogId)) throw new Error('Duplicate cross-catalog adapter namespace');
    byId.set(adapter.catalogId, adapter);
  }
  // Fixed commit order: catalog type, then namespace. Completion order of adapters never changes it.
  const order = [...byId.keys()].sort((a, b) => byId.get(a).catalogType.localeCompare(byId.get(b).catalogType) || a.localeCompare(b));
  const reserved = new Set();
  let busy = null, closing = false;
  let recovery = journal.document().transactions.find(record => OPEN_STATES.includes(record.state)) ?? null;
  const time = () => { const value = now(); return integer(value) ? value : fail('Coordinator clock unavailable.'); };

  function required() {
    if (closing) fail('Cross-catalog coordination is closing.', 'CROSS_CATALOG_UNAVAILABLE');
    if (busy) fail('A cross-catalog transaction is already in progress.', 'CROSS_CATALOG_BUSY');
  }
  function refuseDuringRecovery() {
    if (recovery || journal.uncertain?.()) fail('Cross-catalog recovery is required before another transaction.', 'CROSS_CATALOG_RECOVERY_REQUIRED', { recovery: recoveryView() });
  }
  function recoveryView() {
    return recovery ? { transactionId: recovery.transactionId, operation: recovery.operation, state: recovery.state, reason: recovery.reason,
      catalogs: structuredClone(recovery.catalogs), affectedHeads: affected(recovery.members), journalReopenRequired: !!journal.uncertain?.() } : null;
  }
  async function exclusive(operation) {
    required();
    const work = (async () => operation())();
    busy = work;
    try { return await work; } finally { busy = null; }
  }
  /** Resolve one member to exactly one catalog namespace; the same ID in another catalog is a cross-namespace conflict. */
  async function resolveMember(individualId, catalogId) {
    const adapter = byId.get(catalogId);
    if (!uuid(individualId) || !adapter) fail('Unknown cross-catalog member or catalog namespace.');
    const view = await adapter.member(individualId);
    if (!validView(view, adapter, individualId)) fail('Cross-catalog member is unavailable or its catalog view is malformed.');
    for (const other of byId.values()) if (other !== adapter && await other.member(individualId) !== null) fail('Member identity appears in more than one catalog namespace.');
    return { adapter, view };
  }
  function groups(members) {
    return order.filter(catalogId => members.some(member => member.catalogId === catalogId))
      .map(catalogId => ({ adapter: byId.get(catalogId), members: members.filter(member => member.catalogId === catalogId) }));
  }
  function persist(record, extra = {}) {
    record.updatedAt = time();
    const document = journal.document();
    const index = document.transactions.findIndex(value => value.transactionId === record.transactionId);
    if (index === -1) document.transactions.push(structuredClone(record)); else document.transactions[index] = structuredClone(record);
    if (extra.joint) document.jointCheckpoints.push(extra.joint);
    journal.write(document);
  }
  /** A journal write failure after staging leaves the complete record in memory as the recovery authority. */
  function persistOrRecover(record, extra) {
    try { persist(record, extra); }
    catch (error) { record.state = 'recovery-required'; record.reason = 'Journal write failed during a cross-catalog transaction.'; recovery = record; throw withRecovery(error); }
  }
  function withRecovery(error) { return Object.assign(error, { code: error.code ?? 'CROSS_CATALOG_RECOVERY_REQUIRED', recovery: recoveryView() }); }
  async function cancelStaged(record, stagedGroups) {
    for (const group of stagedGroups) {
      const catalog = record.catalogs.find(value => value.catalogId === group.adapter.catalogId);
      if (!['staged', 'failed'].includes(catalog.state)) continue;
      try { await group.adapter.cancel({ transactionId: record.transactionId }); catalog.state = 'cancelled'; } catch { catalog.state = 'failed'; }
    }
  }
  async function verifyUnchanged(record, snapshot) {
    for (const group of groups(record.members)) {
      const catalog = record.catalogs.find(value => value.catalogId === group.adapter.catalogId);
      if (await group.adapter.epoch() !== catalog.catalogEpoch) fail('A source catalog epoch changed during the transaction.', 'CROSS_CATALOG_STALE');
      for (const member of group.members) {
        const view = await group.adapter.member(member.individualId), prior = snapshot.get(member.individualId);
        if (!validView(view, group.adapter, member.individualId) || view.head !== member.priorHead || view.sessionEpoch !== prior.sessionEpoch || view.status !== prior.status) fail('A member changed during the transaction.', 'CROSS_CATALOG_STALE');
      }
    }
  }
  /** Commit each catalog in fixed order. An ordinary pre-selection refusal compensates already committed catalogs in reverse. */
  async function commitAll(record) {
    const committed = [];
    for (const group of groups(record.members)) {
      const catalog = record.catalogs.find(value => value.catalogId === group.adapter.catalogId);
      try {
        const result = await group.adapter.commit({ transactionId: record.transactionId });
        if (!exact(result, ['heads']) || !exact(result.heads, group.members.map(member => member.individualId))
          || group.members.some(member => result.heads[member.individualId] !== member.plannedHead)) fail('Catalog commit reported heads that do not match the staged plan.', 'CROSS_CATALOG_DISAGREEMENT');
        for (const member of group.members) member.selectedHead = member.plannedHead;
        catalog.state = 'committed'; committed.push(group);
        persistOrRecover(record);
      } catch (error) {
        if (error.recovery) throw error;
        if (error?.code === 'CATALOG_DURABILITY_UNCERTAIN' || error?.code === 'CROSS_CATALOG_DISAGREEMENT') {
          catalog.state = 'uncertain';
          const selected = error.selectedHeads && typeof error.selectedHeads === 'object' ? error.selectedHeads : {};
          for (const member of group.members) if (uuid(selected[member.individualId])) member.selectedHead = selected[member.individualId];
          await cancelStaged(record, groups(record.members));
          return enterRecovery(record, 'A catalog selection is uncertain; the complete affected-head set is reported.', error);
        }
        catalog.state = 'failed';
        const reverted = await compensate(record, committed);
        await cancelStaged(record, groups(record.members));
        if (!reverted) return enterRecovery(record, 'Compensation of an already committed catalog failed.', error);
        record.state = 'rolled-back'; record.reason = 'A catalog refused its commit; every committed catalog was compensated to its prior content.';
        persistOrRecover(record);
        fail(record.reason, 'CROSS_CATALOG_ROLLED_BACK', { cause: error, affectedHeads: affected(record.members) });
      }
    }
  }
  /** Revert is idempotent per transaction ID: a repeat after a crash reports the heads the first call selected. */
  async function revertGroup(record, adapter, members) {
    if (members.some(member => member.priorHead === null)) fail('A member had no prior head to revert to.');
    const result = await adapter.revert({ transactionId: record.transactionId, heads: Object.fromEntries(members.map(member => [member.individualId, member.priorHead])) });
    if (!exact(result, ['heads']) || !exact(result.heads, members.map(member => member.individualId)) || members.some(member => !uuid(result.heads[member.individualId]))) fail('Invalid revert result.');
    // A revert may append a restore lineage entry whose payload equals the prior head; history is never deleted.
    for (const member of members) member.selectedHead = result.heads[member.individualId];
    record.catalogs.find(value => value.catalogId === adapter.catalogId).state = 'reverted';
  }
  async function compensate(record, committed) {
    let complete = true;
    for (const group of [...committed].reverse()) {
      const catalog = record.catalogs.find(value => value.catalogId === group.adapter.catalogId);
      try {
        // Journal the intent first, so a crash mid-revert leaves a record that recovery can reconcile idempotently.
        catalog.state = 'reverting'; persist(record);
        await revertGroup(record, group.adapter, group.members);
      } catch { complete = false; if (catalog.state !== 'reverting') catalog.state = 'uncertain'; }
    }
    return complete;
  }
  function enterRecovery(record, reason, cause) {
    record.state = 'recovery-required'; record.reason = reason; recovery = record;
    try { persist(record); } catch { /* the in-memory record remains the recovery authority until reopen */ }
    fail(reason, 'CROSS_CATALOG_RECOVERY_REQUIRED', { cause, recovery: recoveryView() });
  }
  async function evictAll(record) {
    let complete = true;
    for (const group of groups(record.members)) {
      try { await group.adapter.evict({ transactionId: record.transactionId, ids: group.members.map(member => member.individualId) }); }
      catch { complete = false; }
    }
    return complete;
  }
  /** Reserve, re-read, preflight and stage every catalog before the first journal record. Any refusal cancels only transaction-owned staging. */
  async function prepare(record, resolved) {
    const releases = [];
    for (const member of record.members) if (reserved.has(member.individualId)) fail('Member is reserved by another operation.', 'CROSS_CATALOG_BUSY');
    record.members.forEach(member => reserved.add(member.individualId));
    const staged = [];
    let journaled = false;
    try {
      for (const group of groups(record.members)) releases.push(await group.adapter.reserve(group.members.map(member => member.individualId)));
      const snapshot = new Map(resolved.map(value => [value.view.individualId, value.view]));
      await verifyUnchanged(record, snapshot);
      const draft = structuredClone(record);
      draft.members.forEach(member => { member.plannedHead = randomUUID(); member.checkpointSha256 = '0'.repeat(64); });
      if (!journal.fits({ ...journal.document(), transactions: [...journal.document().transactions, draft], jointCheckpoints: [...journal.document().jointCheckpoints, ...(record.operation === 'save' ? [{ jointCheckpointId: record.jointCheckpointId, createdAt: 0, payload: { version: 1, kind: 'cross-catalog-joint', intervalMs: 5, tick: record.tick, members: record.members.map(member => ({ ...member })) }, sha256: '0'.repeat(64) }] : [])] })
        || journal.document().transactions.length >= CROSS_CATALOG_LIMITS.transactionHistory
        || record.operation === 'save' && journal.document().jointCheckpoints.length >= CROSS_CATALOG_LIMITS.jointHistory) fail('Cross-catalog journal capacity reached; no history was deleted.', 'CROSS_CATALOG_CAPACITY');
      const request = group => ({ transactionId: record.transactionId, operation: record.operation,
        members: group.members.map(member => ({ individualId: member.individualId, parentId: member.priorHead, sourceCheckpointId: member.sourceCheckpointId,
          checkpointSha256: record.operation === 'restore' ? member.checkpointSha256 : null, mode: member.mode })) });
      for (const group of groups(record.members)) await group.adapter.preflight(request(group));
      if (closing) fail('Cross-catalog coordination is closing.', 'CROSS_CATALOG_UNAVAILABLE');
      for (const group of groups(record.members)) {
        staged.push(group); record.catalogs.find(value => value.catalogId === group.adapter.catalogId).state = 'staged';
        const result = await group.adapter.stage(request(group));
        if (!Array.isArray(result) || result.length !== group.members.length) fail('Catalog staging returned an incomplete plan.', 'CROSS_CATALOG_DISAGREEMENT');
        for (const member of group.members) {
          const value = result.find(item => item?.individualId === member.individualId);
          if (!exact(value, ['individualId', 'parentId', 'checkpointId', 'sourceCheckpointId', 'checkpointSha256', 'simTimeMs']) || value.parentId !== member.priorHead
            || !uuid(value.checkpointId) || value.checkpointId === member.priorHead || value.sourceCheckpointId !== member.sourceCheckpointId || !shaValid(value.checkpointSha256)
            || !integer(value.simTimeMs) || record.operation === 'restore' && (value.checkpointSha256 !== member.checkpointSha256 || value.simTimeMs !== member.simTimeMs)) fail('Catalog staging disagrees with the requested membership.', 'CROSS_CATALOG_DISAGREEMENT');
          member.plannedHead = value.checkpointId; member.checkpointSha256 = value.checkpointSha256; member.simTimeMs = value.simTimeMs;
        }
      }
      if (new Set(record.members.map(member => member.plannedHead)).size !== record.members.length) fail('Catalog staging reused a checkpoint identifier.', 'CROSS_CATALOG_DISAGREEMENT');
      record.state = 'staged';
      try { persist(record); journaled = true; }
      catch (error) {
        if (error.code === 'CROSS_CATALOG_JOURNAL_UNCERTAIN') { record.state = 'recovery-required'; record.reason = 'Journal durability uncertain after staging; nothing was selected.'; recovery = record; }
        throw error;
      }
      if (closing) fail('Cross-catalog coordination is closing.', 'CROSS_CATALOG_UNAVAILABLE');
      await verifyUnchanged(record, snapshot);
      return releases;
    } catch (error) {
      await cancelStaged(record, staged);
      if (journaled) {
        // Journaled but not selected: close the record so the journal stays resolvable.
        record.state = 'aborted'; record.reason = String(error.message || 'Transaction aborted before selection.').slice(0, 512);
        try { persist(record); } catch { record.state = 'recovery-required'; recovery = record; }
      }
      releaseAll(record, releases);
      throw error;
    }
  }
  function releaseAll(record, releases) {
    for (const release of releases) { try { if (typeof release === 'function') release(); } catch { /* adapter release is best-effort after a terminal state */ } }
    record.members.forEach(member => reserved.delete(member.individualId));
  }
  function transaction(operation, jointCheckpointId, tick, resolved, extra) {
    const at = time();
    const catalogIds = order.filter(catalogId => resolved.some(value => value.adapter.catalogId === catalogId));
    return { transactionId: randomUUID(), operation, state: 'preparing', createdAt: at, updatedAt: at, intervalMs: 5, tick, jointCheckpointId,
      catalogs: catalogIds.map(catalogId => ({ catalogType: byId.get(catalogId).catalogType, catalogId, catalogEpoch: extra.epochs.get(catalogId), state: 'cancelled' })),
      members: resolved.map(({ adapter, view }, index) => ({ individualId: view.individualId, catalogType: adapter.catalogType, catalogId: adapter.catalogId,
        dataset: view.dataset, graphSha256: view.graphSha256, modelId: view.modelId, mode: extra.modes?.[index] ?? view.mode, priorHead: view.head,
        plannedHead: null, selectedHead: view.head, sourceCheckpointId: extra.sources?.[index]?.checkpointId ?? null,
        checkpointSha256: extra.sources?.[index]?.checkpointSha256 ?? null, simTimeMs: extra.sources?.[index]?.simTimeMs ?? view.simTimeMs })), reason: null };
  }
  async function epochs(resolved) {
    const values = new Map();
    for (const { adapter } of resolved) if (!values.has(adapter.catalogId)) {
      const epoch = await adapter.epoch(); if (!text(epoch)) fail('Catalog epoch unavailable.'); values.set(adapter.catalogId, epoch);
    }
    return values;
  }
  function membership(members) {
    if (!Array.isArray(members) || members.length < 2 || members.length > CROSS_CATALOG_LIMITS.members
      || members.some(member => !exact(member, ['individualId', 'catalogId'])) || new Set(members.map(member => member.individualId)).size !== members.length) fail('Select 2–64 distinct cross-catalog members with explicit catalog namespaces.');
  }

  async function save(body) {
    return exclusive(async () => {
      refuseDuringRecovery();
      if (!exact(body, ['protocolVersion', 'intervalMs', 'tick', 'members']) || body.protocolVersion !== 1 || body.intervalMs !== 5 || !integer(body.tick)) fail('Invalid cross-catalog save envelope.');
      membership(body.members);
      const resolved = [];
      for (const member of body.members) resolved.push(await resolveMember(member.individualId, member.catalogId));
      if (resolved.some(({ view }) => view.status !== 'paused')) fail('Every cross-catalog member must be explicitly paused before a joint save.');
      const record = transaction('save', randomUUID(), body.tick, resolved, { epochs: await epochs(resolved) });
      const releases = await prepare(record, resolved);
      try {
        record.state = 'committing'; persistOrRecover(record);
        await commitAll(record);
        const joint = { jointCheckpointId: record.jointCheckpointId, createdAt: time(), payload: { version: 1, kind: 'cross-catalog-joint', intervalMs: 5, tick: record.tick,
          members: record.members.map(member => ({ individualId: member.individualId, catalogType: member.catalogType, catalogId: member.catalogId, dataset: member.dataset,
            graphSha256: member.graphSha256, modelId: member.modelId, checkpointId: member.plannedHead, checkpointSha256: member.checkpointSha256, simTimeMs: member.simTimeMs, mode: member.mode })) } };
        joint.sha256 = sha(joint.payload);
        record.state = 'committed'; record.reason = null;
        persistOrRecover(record, { joint });
        return { ...structuredClone(joint), disclosure: DISCLOSURE };
      } finally { releaseAll(record, releases); }
    });
  }

  async function restore(body) {
    return exclusive(async () => {
      refuseDuringRecovery();
      if (!exact(body, ['protocolVersion', 'jointCheckpointId', 'members']) || body.protocolVersion !== 1 || !uuid(body.jointCheckpointId)) fail('Invalid cross-catalog restore envelope.');
      membership(body.members);
      const joint = journal.document().jointCheckpoints.find(value => value.jointCheckpointId === body.jointCheckpointId);
      if (!joint) fail('Cross-catalog joint checkpoint not found.', 'CROSS_CATALOG_NOT_FOUND');
      const saved = joint.payload.members;
      if (saved.length !== body.members.length || saved.some(member => !body.members.some(value => value.individualId === member.individualId && value.catalogId === member.catalogId))) fail('Cross-catalog restore requires the complete saved membership and namespaces.');
      const resolved = [];
      for (const member of saved) {
        const value = await resolveMember(member.individualId, member.catalogId);
        if (value.adapter.catalogType !== member.catalogType || value.view.dataset !== member.dataset || value.view.graphSha256 !== member.graphSha256 || value.view.modelId !== member.modelId) fail('Cross-catalog member namespace disagrees with the saved checkpoint.', 'CROSS_CATALOG_DISAGREEMENT');
        if (value.view.status !== 'paused') fail('Every cross-catalog restore member must be an explicitly paused resident.');
        resolved.push(value);
      }
      const record = transaction('restore', joint.jointCheckpointId, joint.payload.tick, resolved, { epochs: await epochs(resolved), modes: saved.map(member => member.mode), sources: saved });
      const priorEpochs = new Map(resolved.map(({ view }) => [view.individualId, view.sessionEpoch]));
      const releases = await prepare(record, resolved);
      try {
        record.state = 'committing'; persistOrRecover(record);
        await commitAll(record);
        record.state = 'activating'; persistOrRecover(record);
        const restored = [];
        try {
          for (const group of groups(record.members)) {
            const result = await group.adapter.activate({ transactionId: record.transactionId, members: group.members.map(member => ({ individualId: member.individualId, checkpointId: member.plannedHead, mode: member.mode })) });
            if (!Array.isArray(result) || result.length !== group.members.length) fail('Runtime activation returned an incomplete result.');
            for (const member of group.members) {
              const value = result.find(item => item?.individualId === member.individualId);
              if (!exact(value, ['individualId', 'checkpointId', 'sessionEpoch', 'status']) || value.checkpointId !== member.plannedHead || !text(value.sessionEpoch)
                || value.sessionEpoch === priorEpochs.get(member.individualId) || value.status !== 'paused') fail('Runtime activation could not be verified against the selected head.');
              restored.push({ individualId: member.individualId, catalogType: member.catalogType, catalogId: member.catalogId, checkpointId: member.plannedHead, sessionEpoch: value.sessionEpoch, mode: member.mode });
            }
          }
        } catch (error) {
          // Never pair a selected head with an unverified runtime: unload every member so it reloads paused from the durable head.
          if (!await evictAll(record)) return enterRecovery(record, 'Runtime restoration failed and eviction could not be verified.', error);
          record.state = 'unloaded'; record.reason = 'Durable heads selected; runtime restoration failed and every member was unloaded for explicit paused reload.';
          persistOrRecover(record);
          fail(record.reason, 'CROSS_CATALOG_RUNTIME_EVICTED', { cause: error, affectedHeads: affected(record.members) });
        }
        record.state = 'committed'; record.reason = null; persistOrRecover(record);
        const allResting = restored.every(member => member.mode === 'resting');
        return { jointCheckpointId: joint.jointCheckpointId, transactionId: record.transactionId, status: allResting ? 'resting' : 'paused', members: restored, disclosure: DISCLOSURE };
      } finally { releaseAll(record, releases); }
    });
  }

  /** Explicit operator action. It verifies every catalog's live head against the journal before changing anything. */
  async function recover(body) {
    return exclusive(async () => {
      if (!recovery) fail('No cross-catalog recovery is pending.', 'CROSS_CATALOG_NOT_FOUND');
      if (journal.uncertain?.()) fail('Close and reopen the cross-catalog journal before recovery.', 'CROSS_CATALOG_RECOVERY_REQUIRED', { recovery: recoveryView() });
      if (!exact(body, ['protocolVersion', 'transactionId', 'action']) || body.protocolVersion !== 1 || body.transactionId !== recovery.transactionId
        || !['rollback', 'complete'].includes(body.action)) fail('Invalid or stale cross-catalog recovery envelope.');
      const record = structuredClone(recovery);
      const reverting = groups(record.members).filter(group => record.catalogs.find(value => value.catalogId === group.adapter.catalogId).state === 'reverting');
      if (reverting.length && body.action === 'complete') fail('A compensation was in progress; only rollback can resolve this transaction.', 'CROSS_CATALOG_DISAGREEMENT', { recovery: recoveryView() });
      // Re-issue interrupted reverts first; idempotence makes their resulting heads explainable.
      for (const group of reverting) {
        try { await revertGroup(record, group.adapter, group.members); }
        catch (error) { fail('An interrupted compensation could not be reconciled; recovery remains pending.', 'CROSS_CATALOG_RECOVERY_REQUIRED', { cause: error, recovery: recoveryView() }); }
      }
      for (const member of record.members) {
        const adapter = byId.get(member.catalogId);
        if (!adapter || adapter.catalogType !== member.catalogType) fail('A catalog named by the recovery record is not configured.', 'CROSS_CATALOG_DISAGREEMENT', { recovery: recoveryView() });
        if (reserved.has(member.individualId)) fail('Member is reserved by another operation.', 'CROSS_CATALOG_BUSY');
        const view = await adapter.member(member.individualId);
        if (!validView(view, adapter, member.individualId) || ![member.priorHead, member.plannedHead, member.selectedHead].includes(view.head)) fail('A catalog head disagrees with every head the recovery record can explain.', 'CROSS_CATALOG_DISAGREEMENT', { recovery: recoveryView() });
        member.selectedHead = view.head;
      }
      if (body.action === 'complete') {
        if (record.members.some(member => member.selectedHead !== member.plannedHead)) fail('Completion requires every catalog to select the planned head.', 'CROSS_CATALOG_DISAGREEMENT', { recovery: recoveryView() });
        if (record.operation === 'restore' && !await evictAll(record)) fail('Runtime eviction could not be verified; recovery remains pending.', 'CROSS_CATALOG_RECOVERY_REQUIRED', { recovery: recoveryView() });
        let joint;
        if (record.operation === 'save') {
          joint = { jointCheckpointId: record.jointCheckpointId, createdAt: time(), payload: { version: 1, kind: 'cross-catalog-joint', intervalMs: 5, tick: record.tick,
            members: record.members.map(member => ({ individualId: member.individualId, catalogType: member.catalogType, catalogId: member.catalogId, dataset: member.dataset,
              graphSha256: member.graphSha256, modelId: member.modelId, checkpointId: member.plannedHead, checkpointSha256: member.checkpointSha256, simTimeMs: member.simTimeMs, mode: member.mode })) } };
          joint.sha256 = sha(joint.payload);
        }
        record.catalogs.forEach(catalog => { catalog.state = 'committed'; });
        record.state = record.operation === 'save' ? 'committed' : 'unloaded';
        record.reason = 'Explicit operator recovery verified every planned head.';
        persist(record, joint ? { joint } : {});
      } else {
        const failures = [];
        for (const group of groups(record.members)) {
          const catalog = record.catalogs.find(value => value.catalogId === group.adapter.catalogId);
          const selected = group.members.filter(member => member.selectedHead === member.plannedHead);
          try {
            if (selected.length) await revertGroup(record, group.adapter, selected);
            else catalog.state = catalog.state === 'reverted' ? 'reverted' : 'cancelled';
            await group.adapter.cancel({ transactionId: record.transactionId });
          } catch (error) { failures.push(error); catalog.state = 'uncertain'; }
        }
        if (record.operation === 'restore' && !await evictAll(record)) failures.push(new Error('eviction'));
        if (failures.length) { recovery = record; try { persist(record); } catch { /* retained in memory */ } fail('Rollback incomplete; recovery remains pending.', 'CROSS_CATALOG_RECOVERY_REQUIRED', { recovery: recoveryView() }); }
        record.state = 'rolled-back'; record.reason = 'Explicit operator recovery rolled every catalog back to its prior content.';
        persist(record);
      }
      recovery = null;
      return { transactionId: record.transactionId, state: record.state, affectedHeads: affected(record.members), disclosure: DISCLOSURE };
    });
  }

  return {
    save, restore, recover,
    status: () => ({ protocolVersion: 1, kind: 'cross-catalog-checkpoint-status', available: !closing, busy: !!busy, recovery: recoveryView(),
      catalogs: order.map(catalogId => ({ catalogId, catalogType: byId.get(catalogId).catalogType })), disclosure: DISCLOSURE }),
    jointCheckpoints: () => journal.document().jointCheckpoints,
    /** Integrations consult this before samples, lifecycle commands, joins, withdrawals and barriers. */
    reserved: individualId => reserved.has(individualId) || !!recovery?.members.some(member => member.individualId === individualId),
    async close() { closing = true; try { await busy; } catch { /* the transaction already reported its own outcome */ } },
  };
}
