import { useRef } from 'react';
import { rosterKeyTarget, rowCommandTarget, rowVisitorActions } from './fly-roster-state.js';
import { useVisitorCommands } from './use-visitor-commands.js';

const LANGUAGE_STATUS = {
  pending: 'interpreter request pending · stays with this fly',
  held: 'interpreter reply received · kept with this fly',
  shown: 'interpreter reply shown under this fly',
  failed: 'interpreter request failed · recorded for this fly',
};

/** One fly: its own pod status and its own Visit/Return controls, bound to this row's session only. */
function FlyRosterRow({ row, index, disabled, bridgeConfigured, onSelect, onKeyDown, radioRef, onVisitorReply }) {
  const target = rowCommandTarget(row);
  const commands = useVisitorCommands(target, { onMutation: (state, visitor) => onVisitorReply({ state, visitor }) });
  const actions = rowVisitorActions(row, { bridgeConfigured, busy: commands.busy });
  return <div className={`fly-roster-row pod-${row.pod.tone}`} data-individual={row.individualId} data-phase={row.pod.phase} data-selected={String(row.selected)}>
    <button type="button" role="radio" aria-checked={row.selected} tabIndex={row.selected ? 0 : -1} disabled={disabled}
      ref={radioRef} aria-label={`Select fly ${row.individualId}`} onClick={() => onSelect(row.individualId)} onKeyDown={event => onKeyDown(event, index)}>
      <strong>{row.individualId.slice(0, 8)}…</strong> · {row.resident ? 'resident' : 'saved unloaded'}
    </button>
    <p className="fly-roster-pod" role="status">◎ {row.pod.label}{row.pod.worldId ? ` · destination ${row.pod.worldId}` : ''} · {row.pod.owned ? 'owned by the bridge' : 'home controller available'} · {row.pod.running ? 'stepping' : 'paused'}{row.language ? ` · ${LANGUAGE_STATUS[row.language.status]}` : ''}</p>
    <div className="actions">
      {actions.canReturn && <button type="button" onClick={() => commands.perform('home')}>Return home (paused)</button>}
      {actions.canVisit && !commands.capabilities && <button type="button" disabled={commands.busy} onClick={() => commands.perform('discover')}>Check worlds</button>}
      {actions.canVisit && commands.capabilities && <>
        <label>World <select value={commands.world} disabled={commands.busy} onChange={event => commands.setWorld(event.target.value)}>
          {!commands.capabilities.worldIds.length && <option value="">No approved worlds</option>}
          {commands.capabilities.worldIds.map(id => <option key={id} value={id}>{id}</option>)}
        </select></label>
        <button type="button" disabled={commands.busy || !commands.capabilities.available || !commands.world} onClick={() => commands.perform('admit')}>Request visit (paused)</button>
      </>}
      {!target && <span className="muted">{row.resident ? 'Runtime session unknown; refresh before a visit.' : 'Load paused before a visit.'}</span>}
    </div>
    {commands.error && <p role="alert">{commands.error}</p>}
  </div>;
}

/** Keyboard-selectable roster with per-fly controls. Selecting a fly changes what is shown, never what runs. */
export default function FlyRoster({ rows, disabled = false, bridgeConfigured = false, onSelect, onVisitorReply = () => {} }) {
  const radios = useRef([]);
  function onKeyDown(event, index) {
    const next = rosterKeyTarget(event.key, index, rows.length);
    if (next === null) return;
    event.preventDefault();
    radios.current[next]?.focus();
    const row = rows[next];
    if (row && !row.selected) onSelect(row.individualId);
  }
  return <section className="card info-panel fly-roster" id="panel-roster" aria-label="Fly roster">
    <div className="card-heading" style={{ padding: 0, marginBottom: 12 }}>
      <span className="eyebrow">FLY ROSTER</span>
      <span className="muted">PER-FLY POD STATUS AND CONTROLS</span>
    </div>
    <p>One row per individual. Arrow keys move the selection; Home and End jump to the ends. Each row's controls act on that row's fly and its listed runtime session only, whichever fly is selected. Selecting a fly changes what is shown, never what runs.</p>
    {rows.length === 0 ? <p role="status">No individuals are listed.</p>
      : <div className="fly-roster-list" role="radiogroup" aria-label="Select a fly">
        {rows.map((row, index) => <FlyRosterRow key={row.individualId} row={row} index={index} disabled={disabled} bridgeConfigured={bridgeConfigured}
          onSelect={onSelect} onKeyDown={onKeyDown} radioRef={element => { radios.current[index] = element; }} onVisitorReply={onVisitorReply} />)}
      </div>}
    <p className="muted">{bridgeConfigured
      ? 'Visits expire without renewal. Returning or revoking one fly never touches another; a refused admission leaves existing visits undisturbed.'
      : 'The local visitor bridge is unavailable until explicitly configured; pod status stays readable.'}</p>
  </section>;
}
