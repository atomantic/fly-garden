import { useRef } from 'react';
import { rosterKeyTarget, rowVisitorActions } from './fly-roster-state.js';
import { useVisitorCommands } from './use-visitor-commands.js';
import VisitRequestForm from './VisitRequestForm.jsx';

const LANGUAGE_STATUS = {
  pending: 'interpreter request pending · stays with this fly',
  received: 'interpreter reply received · kept with this fly',
  failed: 'interpreter request failed · recorded for this fly',
};

/** One fly: its own pod status and its own Visit/Return controls, bound to this row's session only. */
function FlyRosterRow({ row, index, disabled, bridgeConfigured, panelled, onSelect, onKeyDown, radioRef, onMutation }) {
  const { target, canReturn, canVisit } = rowVisitorActions(row, { bridgeConfigured });
  const commands = useVisitorCommands(target, { onMutation });
  return <div className={`fly-roster-row pod-${row.pod.tone}`} data-individual={row.individualId} data-phase={row.pod.phase} data-selected={String(row.selected)}>
    <button type="button" role="radio" aria-checked={row.selected} tabIndex={row.selected ? 0 : -1} disabled={disabled}
      ref={radioRef} aria-label={`Select fly ${row.individualId}`} onClick={() => onSelect(row.individualId)} onKeyDown={event => onKeyDown(event, index)}>
      <strong>{row.individualId.slice(0, 8)}…</strong> · {row.resident ? 'resident' : 'saved unloaded'}
    </button>
    <p className="fly-roster-pod" role="status">◎ {row.pod.label}{row.pod.worldId ? ` · destination ${row.pod.worldId}` : ''} · {row.pod.owned ? 'owned by the bridge' : 'home controller available'} · {row.pod.running ? 'stepping' : 'paused'}{row.language ? ` · ${LANGUAGE_STATUS[row.language]}` : ''}</p>
    {panelled ? <p className="muted">This fly's visitor controls are in its panel below.</p> : <div className="actions">
      {canReturn && <button type="button" onClick={() => commands.perform('home')}>Return home (paused)</button>}
      {canVisit && (commands.capabilities
        ? <VisitRequestForm capabilities={commands.capabilities} world={commands.world} setWorld={commands.setWorld} disabled={commands.busy} onAdmit={() => commands.perform('admit')} />
        : <button type="button" disabled={commands.busy} onClick={() => commands.perform('discover')}>Check worlds</button>)}
      {!target && <span className="muted">{row.resident ? 'Runtime session unknown; refresh before a visit.' : 'Load paused before a visit.'}</span>}
    </div>}
    {commands.error && <p role="alert">{commands.error}</p>}
  </div>;
}

/** Keyboard-selectable roster with per-fly controls. Selecting a fly changes what is shown, never what runs. */
export default function FlyRoster({ rows, disabled = false, bridgeConfigured = false, panelId = null, onSelect, onMutation = () => {} }) {
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
    <p>One row per individual. Arrow keys move the selection; Home and End jump to the ends. Each row's controls act on that row's fly and its listed runtime session only, whichever fly is selected; a fly whose visitor panel is open keeps its controls there. Selecting a fly changes what is shown, never what runs.</p>
    <div className="fly-roster-list" role="radiogroup" aria-label="Select a fly">
      {rows.map((row, index) => <FlyRosterRow key={row.individualId} row={row} index={index} disabled={disabled} bridgeConfigured={bridgeConfigured}
        panelled={row.individualId === panelId} onSelect={onSelect} onKeyDown={onKeyDown} radioRef={element => { radios.current[index] = element; }} onMutation={onMutation} />)}
    </div>
    <p className="muted">{bridgeConfigured
      ? 'Visits expire without renewal. Returning or revoking one fly never touches another; a refused admission leaves existing visits undisturbed.'
      : 'The local visitor bridge is unavailable until explicitly configured; pod status stays readable.'}</p>
  </section>;
}
