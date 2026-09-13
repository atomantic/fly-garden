import React, { useEffect, useRef, useState } from 'react';
import evidence from './population-evidence.json';
import { populationRequestCurrent, readPopulation } from './population-state.js';

const mib = bytes => (bytes / 1024 ** 2).toFixed(2);
const reportRoot = 'https://github.com/atomantic/fly-garden/blob/14766ca/';
function PublishedEvidence() {
  const environment = evidence.zeroDrive.environment;
  return <details>
    <summary>Published workload measurements · {evidence.measuredDate}</summary>
    <p>Historical research measurements, separate from this installation’s configured ceiling and current memory. These reports do not authorize a load or change settings.</p>
    <h3>Single and paired zero-drive workload</h3>
    <p>Recorded environment: {environment.runtime}, {environment.platform} {environment.architecture}, {environment.cpuModel}, {environment.logicalCpuCount} logical CPUs, {environment.physicalMemoryBytes / 1024 ** 3} GiB RAM.</p>
    <p>One run per scenario: 1,000 steps / 1,000 simulated ms per resident, 100-step batches, then checkpoint and paused reopen. Zero spikes and zero traversed active edges. Pair batches waited for both workers.</p>
    <div style={{ overflowX: 'auto' }} tabIndex={0} role="region" aria-label="Recorded zero-drive measurements"><table>
      <caption>Recorded process RSS includes all workers; it is not a per-fly allocation estimate.</caption>
      <thead><tr><th scope="col">Scenario</th><th scope="col">Step wall time</th><th scope="col">Sampled peak RSS</th></tr></thead>
      <tbody>{evidence.zeroDrive.runs.map(run => <tr key={run.scenario}><th scope="row">{{ 'male-single': 'MaleCNS alone', 'banc-single': 'BANC alone', 'male-banc-pair': 'MaleCNS + BANC' }[run.scenario]}</th><td>{run.steppingWallMs.toFixed(2)} ms</td><td>{mib(run.sampledPeakRssBytes)} MiB</td></tr>)}</tbody>
    </table></div>
    <p>Models: {[...new Set(evidence.zeroDrive.runs.flatMap(run => run.models))].join(', ')}. <a href={reportRoot + 'docs/OPERATING_ENVELOPE.md'}>Zero-drive protocol, graph provenance and complete report</a>.</p>
    <h3>Separate single-worker active-edge trial</h3>
    <p>Eight sequential conditions on {evidence.activeEdge.runtime}, {evidence.activeEdge.platform} {evidence.activeEdge.architecture}; one temporary worker at a time. {evidence.activeEdge.executedSteps.toLocaleString()} actual steps total (200 per condition, final clock 180 after a duplicated restore continuation). Campaign wall time: {evidence.activeEdge.totalWallMs.toFixed(2)} ms; sampled process peak: {mib(evidence.activeEdge.sampledPeakRssBytes)} MiB.</p>
    <p>A single engineered visual onset produced 875 MaleCNS input spikes / 13,333 traversed edges and 716 BANC input spikes / 11,614 traversed edges. DNa02 and yaw stayed zero in every condition: a negative motor result, not a working body controller. This does not measure an active pair.</p>
    <p><a href={reportRoot + 'docs/VISUAL_CAUSAL_VALIDATION.md'}>Active-edge conditions, model / mapping hashes and negative result</a>.</p>
    <p>Both protocols used a 2 GiB sampled RSS abort threshold and 120-second deadline. Sampling can miss allocation peaks. Neither validates renderer or recording costs, real-time interaction, sustained activity, larger populations, or capacity on your current machine. Admission still needs matching local memory evidence and fresh host headroom.</p>
  </details>;
}

export default function Population() {
  const [population, setPopulation] = useState(null);
  const [limits, setLimits] = useState(null);
  const [readError, setReadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const live = useRef({ generation: 0, stopped: false, saving: false });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let stopped = false, timer;
    live.current.stopped = false;
    const controller = new AbortController();
    async function refresh() {
      const generation = live.current.generation;
      try {
        if (live.current.saving) return;
        const response = await fetch('/api/population', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (!response.ok) throw new Error('Population status unavailable.');
        const next = readPopulation(await response.json());
        if (populationRequestCurrent(generation, live.current)) { setPopulation(next); setLimits(value => value ?? next.settings); setReadError(''); }
      } catch (error) { if (populationRequestCurrent(generation, live.current)) setReadError(error.message); }
      finally { if (!stopped) timer = setTimeout(refresh, 2000); }
    }
    refresh();
    return () => { stopped = true; live.current.stopped = true; live.current.generation++; clearTimeout(timer); controller.abort(); };
  }, []);
  async function save(event) {
    event.preventDefault(); if (live.current.saving) return;
    const generation = ++live.current.generation; live.current.saving = true; setBusy(true); setSaveError('');
    try {
      const response = await fetch('/api/population', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(limits), signal: AbortSignal.timeout(10000) });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || 'Settings refused.');
      if (populationRequestCurrent(generation, live.current)) { setPopulation(readPopulation(next)); setReadError(''); setSaveError(''); }
    } catch (error) { if (populationRequestCurrent(generation, live.current)) setSaveError(error.name === 'TimeoutError' ? 'Save response timed out; check current settings before retrying.' : error.message); }
    finally { live.current.saving = false; if (populationRequestCurrent(generation, live.current)) setBusy(false); }
  }
  return <section className="card" aria-label="Population capacity">
    <h2>Population capacity</h2>
    {readError && <p role="alert">{readError} Current usage below may be stale.</p>}
    {saveError && <p role="alert">{saveError}</p>}
    {population && <>
      <h3>Current usage and configured ceiling</h3>
      <p>Current resident ceiling: {population.settings.maxResidentFlies}. This is an operator setting, not a validated population size.</p>
      <p>{population.residentCount} resident · {population.runningCount} running · {population.savedUnloadedCount} saved unloaded · pressure: {population.pressure}</p>
      <p>Service memory: {population.aggregateMemoryBytes === null ? 'unknown' : `${(population.aggregateMemoryBytes / 1024 ** 2).toFixed(1)} MiB`}. Host free memory: {population.availableMemoryBytes === null ? 'unknown' : `${(population.availableMemoryBytes / 1024 ** 2).toFixed(1)} MiB`}.</p>
      {population.excessResidents > 0 && <p role="status">{population.excessResidents} residents above the new ceiling. All are preserved; unload explicitly to free capacity.</p>}
      <p>{population.disclosure}</p>
      {population.admission && <p>Next synthetic fixture load: {population.admission.reason}</p>}
    </>}
    <PublishedEvidence />
    {limits && <form onSubmit={save}>
      <h3>Edit capacity settings</h3>
      {Object.entries({ maxResidentFlies: 'Resident ceiling', maxAggregateMemoryBytes: 'Aggregate service budget (bytes)', minFreeMemoryBytes: 'Reserved host headroom (bytes)' }).map(([key, label]) => <label key={key} style={{ display: 'block', marginBottom: 12 }}>{label} <input type="number" min="1" step="1" required disabled={busy} value={limits[key]} onChange={event => setLimits({ ...limits, [key]: Number(event.target.value) })} /></label>)}
      <button disabled={busy}>Save capacity settings</button>
      <p>Changing limits never creates, starts or evicts an individual. Paused residents count toward capacity.</p>
    </form>}
  </section>;
}
