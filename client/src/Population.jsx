import React, { useEffect, useState } from 'react';

export default function Population() {
  const [population, setPopulation] = useState(null);
  const [limits, setLimits] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let stopped = false, timer;
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch('/api/population', { signal: controller.signal });
        if (!response.ok) throw new Error('Population status unavailable.');
        const next = await response.json();
        if (!stopped) { setPopulation(next); setLimits(value => value ?? next.settings); }
      } catch (error) { if (!stopped) setError(error.message); }
      finally { if (!stopped) timer = setTimeout(refresh, 2000); }
    }
    refresh();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, []);
  async function save(event) {
    event.preventDefault(); setBusy(true);
    try {
      const response = await fetch('/api/population', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(limits) });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || 'Settings refused.');
      setPopulation(next); setError('');
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <section className="card" aria-label="Population capacity">
    <h2>Population capacity</h2>
    {error && <p role="alert">{error}</p>}
    {population && <>
      <p>{population.residentCount} resident · {population.runningCount} running · {population.savedUnloadedCount} saved unloaded · pressure: {population.pressure}</p>
      <p>Service memory: {population.aggregateMemoryBytes === null ? 'unknown' : `${(population.aggregateMemoryBytes / 1024 ** 2).toFixed(1)} MiB`}. Host free memory: {population.availableMemoryBytes === null ? 'unknown' : `${(population.availableMemoryBytes / 1024 ** 2).toFixed(1)} MiB`}.</p>
      {population.excessResidents > 0 && <p role="status">{population.excessResidents} residents above the new ceiling. All are preserved; unload explicitly to free capacity.</p>}
      <p>{population.disclosure}</p>
      {population.admission && <p>Next synthetic fixture load: {population.admission.reason}</p>}
    </>}
    {limits && <form onSubmit={save}>
      {Object.entries({ maxResidentFlies: 'Resident ceiling', maxAggregateMemoryBytes: 'Aggregate service budget (bytes)', minFreeMemoryBytes: 'Reserved host headroom (bytes)' }).map(([key, label]) => <label key={key} style={{ display: 'block', marginBottom: 12 }}>{label} <input type="number" min="1" step="1" required disabled={busy} value={limits[key]} onChange={event => setLimits({ ...limits, [key]: Number(event.target.value) })} /></label>)}
      <button disabled={busy}>Save capacity settings</button>
      <p>Changing limits never creates, starts or evicts an individual. Paused residents count toward capacity.</p>
    </form>}
  </section>;
}
