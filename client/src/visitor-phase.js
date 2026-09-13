/** Single source of truth for managed-visitor phase presentation.
 *
 * The teleport pod is a decorative illustration of a disclosed engineered bridge.
 * Pod motion is therefore permitted for exactly one phase — `visiting`, which is
 * reached only after the host has acknowledged admission. No earlier phase may
 * animate or use arrival wording, because a moving pod would imply that a body
 * was granted before the host said so.
 */
const PRESENTATION = {
  home: { label: 'HOST BRIDGE NOT CONNECTED', tone: 'idle', motion: false },
  admission: { label: 'ADMISSION REQUESTED · NOT ACKNOWLEDGED', tone: 'pending', motion: false },
  departing: { label: 'DEPARTURE REQUESTED · AWAITING HOST ACKNOWLEDGMENT', tone: 'pending', motion: false },
  visiting: { label: 'HOST ACKNOWLEDGED · SCOPED VISITOR BODY HELD', tone: 'active', motion: true },
  returning: { label: 'RETURN REQUESTED · REMOTE CLEANUP PENDING', tone: 'pending', motion: false },
  reconnecting: { label: 'CLEANUP UNCONFIRMED · RETRYING REMOTE RETURN', tone: 'fault', motion: false },
  disconnected: { label: 'DISCONNECTED · OWNERSHIP HELD PAUSED', tone: 'fault', motion: false },
  'timed-out': { label: 'TIMED OUT · OWNERSHIP HELD PAUSED', tone: 'fault', motion: false },
  blocked: { label: 'ADMISSION REFUSED · NO HOST BODY', tone: 'fault', motion: false },
};

export const VISITOR_PHASES = Object.freeze(Object.keys(PRESENTATION));

/** Phases where the local fixture is still owned by the bridge and cannot be driven at home. */
export const podPhase = visitor => typeof visitor?.phase === 'string' && Object.hasOwn(PRESENTATION, visitor.phase)
  ? visitor.phase : 'home';

export function podPresentation(visitor) {
  const phase = podPhase(visitor), base = PRESENTATION[phase];
  const destination = phase === 'home' || typeof visitor?.worldId !== 'string' || !visitor.worldId ? null : visitor.worldId;
  return {
    phase,
    tone: base.tone,
    // Defence in depth: motion is gated on the acknowledged phase itself, not only on the table.
    motion: base.motion === true && phase === 'visiting',
    label: base.label,
    destination,
    running: Boolean(visitor?.running),
    detail: destination ? `${base.label} · DESTINATION ${destination}` : base.label,
  };
}

/** Compact roster line so both flies' pod states are readable without changing selection. */
export function podRosterEntry(entry) {
  const pod = podPresentation(entry);
  return { individualId: typeof entry?.individualId === 'string' ? entry.individualId : '',
    phase: pod.phase, tone: pod.tone, label: pod.label,
    owned: Boolean(entry?.owned), running: Boolean(entry?.running) };
}
