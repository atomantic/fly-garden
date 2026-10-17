import { useEffect, useRef, useState } from 'react';
import { postVisitorCommand, visitorJson } from './visitor-api.js';

/** Visitor commands for exactly one individual and runtime session.
 *
 * The target is fixed by the caller (the selected fly's panel, or one roster row), so a reply can
 * never be applied to a different fly, and changing the browser selection cannot retarget a request
 * already in flight. A changed individual or session discards discovery and aborts any request. */
export function useVisitorCommands(target, { onMutation = () => {}, onBusyChange = () => {} } = {}) {
  const [capabilities, setCapabilities] = useState(null), [world, setWorld] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const active = useRef(null), generation = useRef(0), mounted = useRef(true);
  const busyRef = useRef(onBusyChange), mutationRef = useRef(onMutation);
  busyRef.current = onBusyChange; mutationRef.current = onMutation;
  const key = target ? `${target.individualId}/${target.sessionId}` : null;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; active.current?.abort(); busyRef.current(false); }; }, []);
  useEffect(() => () => {
    generation.current++; active.current?.abort(); active.current = null;
    if (mounted.current) { setCapabilities(null); setWorld(''); setError(''); setBusy(false); busyRef.current(false); }
  }, [key]);
  async function perform(operation) {
    if (!target || busy && !['home', 'pause', 'rest'].includes(operation)) return;
    const { individualId, sessionId } = target;
    const ticket = ++generation.current, controller = new AbortController();
    active.current?.abort(); active.current = controller; setBusy(true); busyRef.current(true); setError('');
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      if (operation === 'discover') {
        const value = await visitorJson(`/api/individuals/${encodeURIComponent(individualId)}/visitor?capabilities=1`, { signal: controller.signal });
        if (!mounted.current || ticket !== generation.current) return;
        const next = value.capabilities;
        if (!next || !Array.isArray(next.worldIds) || !next.worldIds.every(id => typeof id === 'string')) throw new Error(next?.reason || 'Host capability discovery unavailable.');
        setCapabilities(next); setWorld(current => next.worldIds.includes(current) ? current : next.worldIds[0] ?? '');
      } else {
        const value = await postVisitorCommand({ individualId, sessionId }, operation, operation === 'admit' ? { worldId: world } : {}, controller.signal);
        if (!mounted.current || ticket !== generation.current) return;
        if (value.state?.individualId !== individualId || value.state?.sessionId !== sessionId) throw new Error('Visitor reply belongs to a different runtime session.');
        mutationRef.current(value.state, value.visitor ?? value.state.visitor ?? null);
      }
    } catch (e) {
      if (mounted.current && ticket === generation.current) setError(controller.signal.aborted
        ? 'Visitor response unavailable. Check the current phase; an unconfirmed admission or return may still hold this individual paused.' : e.message);
    } finally {
      clearTimeout(timer);
      if (mounted.current && ticket === generation.current) { setBusy(false); busyRef.current(false); active.current = null; }
    }
  }
  return { capabilities, world, setWorld, busy, error, perform };
}
