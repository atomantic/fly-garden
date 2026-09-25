import { useEffect, useRef, useState } from 'react';
import { apiJson } from './api-json.js';
import {
  CROSS_CATALOG_INTERVAL_MS,
  CROSS_CATALOG_MEMBER_LIMIT,
  crossCatalogRecoveryBody,
  crossCatalogRestoreBody,
  crossCatalogSaveBody,
  currentCrossCatalogRequest,
  readCrossCatalogCheckpoints,
  readCrossCatalogStatus,
} from './cross-catalog-state.js';

const json = apiJson('Cross-catalog checkpoint request failed.');
const POLL_INTERVAL_MS = 2000;
const READ_TIMEOUT_MS = 10000;
const MUTATION_TIMEOUT_MS = 45000;
const memberKey = member => `${member.catalogId}:${member.individualId}`;
const DATASET_LABELS = Object.freeze({
  'synthetic-fixture:v1': 'Synthetic fixture',
  'male-cns:v1.0': 'MaleCNS v1.0',
  'banc:v888': 'BANC v888',
});
const datasetLabel = dataset => DATASET_LABELS[dataset] ?? dataset;
const checkpointLabel = checkpoint => `${new Date(checkpoint.createdAt).toISOString()} · tick ${checkpoint.payload.tick} · ${checkpoint.jointCheckpointId}`;
const parsedTick = value => {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const tick = Number(value);
  return Number.isSafeInteger(tick) && tick >= 0 ? tick : null;
};

async function readWithTimeout(refresh, controller, duration = READ_TIMEOUT_MS) {
  const timeout = setTimeout(() => controller.abort(), duration);
  try {
    return await refresh(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

export default function CrossCatalogCheckpoints() {
  const live = useRef({ mounted: false, generation: 0, readGeneration: 0, busy: false, action: null });
  const [status, setStatus] = useState(null), [checkpoints, setCheckpoints] = useState([]);
  const [selected, setSelected] = useState([]), [selectedCheckpoint, setSelectedCheckpoint] = useState('');
  const [tick, setTick] = useState('0'), [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState(''), [error, setError] = useState('');

  function publish(next) {
    setStatus(next.status);
    setCheckpoints(next.checkpoints);
    const selectable = new Set(next.status.members.filter(member => member.status === 'paused').map(memberKey));
    setSelected(current => current.filter(key => selectable.has(key)));
    setSelectedCheckpoint(current => next.checkpoints.some(checkpoint => checkpoint.jointCheckpointId === current) ? current : '');
    setReadError('');
  }

  async function refresh(signal) {
    const generation = ++live.current.readGeneration;
    try {
      const [statusValue, checkpointValue] = await Promise.all([
        json('/api/cross-catalog', signal),
        json('/api/cross-catalog/checkpoints', signal),
      ]);
      const nextStatus = readCrossCatalogStatus(statusValue);
      const nextCheckpoints = readCrossCatalogCheckpoints(checkpointValue).checkpoints;
      if (JSON.stringify(nextStatus.checkpoints) !== JSON.stringify(nextCheckpoints)) throw new Error('Cross-catalog checkpoint history changed while reading; current controls remain disabled until the next refresh.');
      if (!live.current.mounted || generation !== live.current.readGeneration) return false;
      publish({ status: nextStatus, checkpoints: nextCheckpoints });
      return true;
    } catch (reason) {
      if (live.current.mounted && generation === live.current.readGeneration) setReadError(reason instanceof Error ? reason.message : 'Cross-catalog status could not be read.');
      return false;
    }
  }

  useEffect(() => {
    live.current.mounted = true;
    let stopped = false, timer, controller;
    async function poll() {
      if (live.current.busy) {
        if (!stopped) timer = setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }
      controller = new AbortController();
      await readWithTimeout(refresh, controller);
      if (!stopped) timer = setTimeout(poll, POLL_INTERVAL_MS);
    }
    void poll();
    return () => {
      stopped = true;
      live.current.mounted = false;
      live.current.generation++;
      live.current.readGeneration++;
      clearTimeout(timer);
      controller?.abort();
      live.current.action?.abort();
    };
  }, []);

  async function manualRefresh() {
    if (live.current.busy) return;
    await readWithTimeout(refresh, new AbortController());
  }

  async function mutate(path, body) {
    if (live.current.busy) return;
    const request = { generation: ++live.current.generation };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MUTATION_TIMEOUT_MS);
    live.current.action = controller;
    live.current.busy = true;
    setBusy(true);
    setError('');
    const current = () => live.current.mounted && currentCrossCatalogRequest(request, live.current);
    try {
      await json(path, controller.signal, body);
      clearTimeout(timeout);
      if (!current()) return;
      const refreshed = await readWithTimeout(refresh, new AbortController());
      if (!refreshed && current()) setError('The operation completed, but current cross-catalog status could not be refreshed. Do not infer the result from this panel.');
    } catch (reason) {
      if (current()) setError(controller.signal.aborted
        ? 'Cross-catalog request timed out. Refresh current status before retrying.'
        : reason instanceof Error ? reason.message : 'Cross-catalog request failed; current state was not inferred.');
    } finally {
      clearTimeout(timeout);
      if (live.current.action === controller) {
        live.current.action = null;
        live.current.busy = false;
        if (live.current.mounted) setBusy(false);
      }
    }
  }

  function requestError(reason) {
    setError(reason instanceof Error ? reason.message : 'Cross-catalog request could not be prepared.');
  }

  function save() {
    const tickValue = parsedTick(tick);
    const members = status?.members.filter(member => selected.includes(memberKey(member))) ?? [];
    try {
      void mutate('/api/cross-catalog', crossCatalogSaveBody(tickValue, members));
    } catch (reason) {
      requestError(reason);
    }
  }

  function restore() {
    const checkpoint = checkpoints.find(value => value.jointCheckpointId === selectedCheckpoint);
    try {
      if (checkpoint) void mutate('/api/cross-catalog/restore', crossCatalogRestoreBody(checkpoint));
    } catch (reason) {
      requestError(reason);
    }
  }

  function recover(action) {
    try {
      if (status?.recovery) void mutate('/api/cross-catalog/recover', crossCatalogRecoveryBody(status.recovery, action));
    } catch (reason) {
      requestError(reason);
    }
  }

  const selectedMembers = status?.members.filter(member => selected.includes(memberKey(member))) ?? [];
  const hasFixture = selectedMembers.some(member => member.catalogType === 'fixture-identity');
  const hasConnectome = selectedMembers.some(member => member.catalogType === 'full-connectome');
  const tickValue = parsedTick(tick);
  const currentMembers = new Map((status?.members ?? []).map(member => [memberKey(member), member]));
  const saved = checkpoints.find(checkpoint => checkpoint.jointCheckpointId === selectedCheckpoint);
  const restoreReady = Boolean(saved) && saved.payload.members.every(member => {
    const current = currentMembers.get(memberKey(member));
    return current?.status === 'paused' && current.catalogType === member.catalogType;
  });
  const serviceBlocked = busy || Boolean(readError) || !status?.available || status?.busy;
  const normalBlocked = serviceBlocked || Boolean(status?.recovery);
  const canSave = !normalBlocked && tickValue !== null && selectedMembers.length >= 2
    && selectedMembers.length <= CROSS_CATALOG_MEMBER_LIMIT && hasFixture && hasConnectome;
  const canRestore = !normalBlocked && restoreReady;
  const omitted = Math.max(0, (status?.memberCount ?? 0) - (status?.members.length ?? 0));
  const recovery = status?.recovery ?? null;

  return <section className="card content-panel" aria-label="Cross-catalog paused checkpoints" aria-busy={busy}>
    <span className="eyebrow">EXPLICIT CROSS-CATALOG RESEARCH TRANSACTIONS</span>
    <h2>Cross-catalog paused checkpoints</h2>
    <p>This is not an embodied mixed world. It coordinates durable checkpoint heads and paused runtime restoration only; it has no rendered body, sensory input, motor output, retained learning or biological validation. Save, restore and recovery never start a simulation.</p>
    <div className="actions">
      <button disabled={busy} onClick={() => void manualRefresh()}>Refresh cross-catalog status</button>
    </div>
    {!status && !readError && <p role="status">Reading local cross-catalog status…</p>}
    {readError && <p role="alert">Cross-catalog status is stale: {readError}</p>}
    {status && <>
      <p role="status"><strong>{status.available ? 'Available' : 'Unavailable'}</strong> · {status.busy ? 'transaction in progress' : 'idle'} · {status.memberCount} participant{status.memberCount === 1 ? '' : 's'}</p>
      <p>{status.disclosure}</p>
      {status.reason && <p role="alert">{status.reason}</p>}
      {omitted > 0 && <p>Showing the first {status.members.length} of {status.memberCount} participants; {omitted} are outside this bounded response.</p>}
    </>}

    {status && <div className="lab-grid">
      <fieldset disabled={normalBlocked}>
        <legend>Select paused participants</legend>
        <p>Choose 2–{CROSS_CATALOG_MEMBER_LIMIT} distinct participants, including at least one fixture and one full connectome. Only an explicitly paused participant can be selected.</p>
        {status.members.map(member => {
          const key = memberKey(member);
          const paused = member.status === 'paused';
          return <label key={key}>
            <span><input type="checkbox" checked={selected.includes(key)} disabled={!paused}
              onChange={event => setSelected(current => event.target.checked
                ? current.length < CROSS_CATALOG_MEMBER_LIMIT && !current.includes(key) ? [...current, key] : current
                : current.filter(value => value !== key))} /> {datasetLabel(member.dataset)} · {member.individualId} · {member.catalogId} · {member.status} · {member.mode}</span>
          </label>;
        })}
        {!status.members.length && <p>No safe participant records are available.</p>}
        <label>Joint tick <input type="number" min="0" step="1" inputMode="numeric" value={tick} onChange={event => setTick(event.target.value)} /></label>
        <p>Selected {selectedMembers.length}/{CROSS_CATALOG_MEMBER_LIMIT}. Fixed interval: {CROSS_CATALOG_INTERVAL_MS} ms. The tick must be a non-negative safe integer.</p>
        <button className="primary" disabled={!canSave} onClick={save}>Save joint checkpoint (paused)</button>
      </fieldset>

      <fieldset disabled={normalBlocked}>
        <legend>Restore an exact saved joint checkpoint</legend>
        <label>Saved checkpoint
          <select value={selectedCheckpoint} onChange={event => setSelectedCheckpoint(event.target.value)}>
            <option value="">Select saved checkpoint</option>
            {checkpoints.map(checkpoint => <option key={checkpoint.jointCheckpointId} value={checkpoint.jointCheckpointId}>{checkpointLabel(checkpoint)}</option>)}
          </select>
        </label>
        {!checkpoints.length && <p>No saved cross-catalog checkpoints are available.</p>}
        {saved && <details open>
          <summary>Exact saved membership: {saved.payload.members.length} participants</summary>
          <ul className="lab-provenance">
            {saved.payload.members.map(member => <li key={`${member.catalogId}:${member.individualId}`}>{datasetLabel(member.dataset)} · {member.individualId} · {member.catalogId} · {member.mode} · checkpoint {member.checkpointId}</li>)}
          </ul>
        </details>}
        <p>Restore sends this saved membership and namespace set exactly. Every named participant must still be present and explicitly paused; the restored session remains paused.</p>
        <button disabled={!canRestore} onClick={restore}>Restore exact saved membership (paused)</button>
      </fieldset>
    </div>}

    {recovery && <section aria-label="Cross-catalog recovery">
      <h3>Explicit recovery required</h3>
      <p role="alert">No recovery action is automatic. The affected participants remain reserved until an explicit verified rollback or completion.</p>
      <dl className="lab-metrics">
        <div><dt>Transaction</dt><dd>{recovery.transactionId}</dd></div>
        <div><dt>Operation</dt><dd>{recovery.operation}</dd></div>
        <div><dt>State</dt><dd>{recovery.state}</dd></div>
        <div><dt>Journal reopen</dt><dd>{recovery.journalReopenRequired ? 'required before action' : 'not required'}</dd></div>
      </dl>
      {recovery.reason && <p>{recovery.reason}</p>}
      <h4>Recovery catalogs</h4>
      <div className="lab-history" tabIndex={0} role="region" aria-label="Recovery catalogs">
        <table><caption>Catalog state reported by recovery</caption><thead><tr><th>Catalog namespace</th><th>Type</th><th>Epoch</th><th>State</th></tr></thead>
          <tbody>{recovery.catalogs.map(catalog => <tr key={catalog.catalogId}><td>{catalog.catalogId}</td><td>{catalog.catalogType}</td><td>{catalog.catalogEpoch}</td><td>{catalog.state}</td></tr>)}</tbody>
        </table>
      </div>
      <h4>Affected heads</h4>
      <div className="lab-history" tabIndex={0} role="region" aria-label="Affected checkpoint heads">
        <table><caption>Every head that recovery may verify or change</caption><thead><tr><th>Participant</th><th>Catalog namespace</th><th>Prior head</th><th>Planned head</th><th>Selected head</th></tr></thead>
          <tbody>{recovery.affectedHeads.map(head => <tr key={head.individualId}><td>{head.individualId}</td><td>{head.catalogId}</td><td>{head.priorHead ?? 'None'}</td><td>{head.plannedHead ?? 'None'}</td><td>{head.selectedHead ?? 'None'}</td></tr>)}</tbody>
        </table>
      </div>
      {recovery.journalReopenRequired && <p role="alert">Close and reopen the local service before choosing recovery; the journal durability boundary must be re-established first.</p>}
      <fieldset disabled={serviceBlocked || recovery.journalReopenRequired}>
        <legend>Choose one explicit recovery action</legend>
        <div className="lab-actions">
          <button onClick={() => recover('rollback')}>Roll back</button>
          <button onClick={() => recover('complete')}>Complete</button>
        </div>
      </fieldset>
      <p>Roll back restores prior heads where selected and cancels transaction-owned staging. Complete accepts only heads that match the recovery plan; neither action resumes a runtime.</p>
    </section>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
