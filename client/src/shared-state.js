/** Pure public-state merge. Tokens are never accepted or returned by this helper. */
export function mergeSharedBundle(previous, incoming, kind = 'poll') {
  if (!incoming?.shared || !Array.isArray(incoming.members)) return previous;
  const { controllerToken: _private, ...safe } = incoming;
  if (!previous) return kind === 'frame' ? previous : safe;
  const old = previous.shared, next = safe.shared;
  if (old.sharedId !== next.sharedId) return kind === 'frame' ? previous : safe;
  if (kind === 'frame' && old.worldEpoch !== next.worldEpoch) return previous;
  if (next.commandSequence < old.commandSequence) return previous;
  if (next.tick < old.tick) {
    if (next.commandSequence === old.commandSequence) return previous;
    // A newer quiet/control envelope owns lifecycle state, but never rewinds an already
    // committed trajectory. Save metadata can likewise arrive after a newer frame.
    const shared = { ...next, tick: old.tick, worldTimeMs: old.worldTimeMs,
      participants: next.participants.map(member => {
        const prior = old.participants.find(item => item.individualId === member.individualId && item.sessionId === member.sessionId);
        return prior ? { ...member, simTimeMs: prior.simTimeMs, pose: prior.pose } : member;
      }) };
    return { ...safe, shared, members: safe.members.map(member => {
      const prior = previous.members.find(item => item.individualId === member.individualId && item.sessionId === member.sessionId);
      return prior && prior.tick > member.tick ? { ...member, ...prior, status: member.status,
        sharedSession: member.sharedSession ? shared : null, environmentAdapter: member.environmentAdapter,
        encounterDynamics: member.encounterDynamics, commandSequence: Math.max(prior.commandSequence, member.commandSequence) } : member;
    }) };
  }
  return safe;
}
export function currentSharedRequest(context, { generation, selectedId, sharedId }) {
  return Boolean(context && context.generation === generation && context.selectedId === selectedId && context.sharedId === sharedId);
}

/** Reuse the current group and renderer only for a member of this exact runtime session.
 * A different individual, restored session or separated group cannot inherit its lease. */
export function selectedSharedMember(bundle, individualId) {
  if (!bundle || bundle.shared.status === 'separated') return null;
  const participant = bundle.shared.participants.find(item => item.individualId === individualId);
  if (!participant) return null;
  return bundle.members.find(member => member.individualId === individualId && member.sessionId === participant.sessionId
    && member.sharedSession?.sharedId === bundle.shared.sharedId) ?? null;
}
