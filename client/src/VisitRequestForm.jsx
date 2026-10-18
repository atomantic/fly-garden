/** The world choice and paused admission request, shared by the visitor panel and each roster row. */
export default function VisitRequestForm({ capabilities, world, setWorld, disabled = false, onAdmit }) {
  return <>
    <label>World <select value={world} disabled={disabled} onChange={event => setWorld(event.target.value)}>
      {!capabilities.worldIds.length && <option value="">No approved worlds</option>}
      {capabilities.worldIds.map(id => <option key={id} value={id}>{id}</option>)}
    </select></label>
    <button type="button" disabled={disabled || !capabilities.available || !world} onClick={onAdmit}>Request visit (paused)</button>
  </>;
}
