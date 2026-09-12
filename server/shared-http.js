import { RuntimeError } from './runtime.js';

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const envelopeKeys = ['protocolVersion', 'individualId', 'sessionId', 'sequence'];
const send = (response, status, value) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
async function bodyFor(request) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new RuntimeError('Expected application/json.', 415);
  let bytes = 0, text = '';
  for await (const chunk of request) { bytes += chunk.length; if (bytes > 4096) throw new RuntimeError('Shared request exceeds 4096 bytes.', 413); text += chunk; }
  try { return JSON.parse(text); } catch { throw new RuntimeError('Invalid shared JSON.'); }
}
/** Caller owns origin protection, resource admission, public snapshots and individual command counters.
 * No route allocates residents. Only a complete authenticated frame batch advances the existing pair. */
export function createSharedHttp({ identities, snapshot = id => identities.snapshot(id), sequenceFor = () => 0,
  consumeSequences = () => {}, afterTransition = () => {}, afterFrames = () => {} }) {
  const sequences = new Map();
  const bundle = state => ({ shared: { ...state, commandSequence: sequences.get(state.sharedId) ?? 0 },
    members: state.participants.map(member => snapshot(member.individualId)) });
  function validateMembers(members, expectedIds = null) {
    if (!Array.isArray(members) || members.length !== 2 || new Set(members.map(item => item?.individualId)).size !== 2) throw new RuntimeError('Select exactly two distinct loaded fixture recipients.');
    for (const item of members) {
      if (!exact(item, envelopeKeys) || item.protocolVersion !== 1) throw new RuntimeError('Invalid recipient command envelope.', 409);
      const state = snapshot(item.individualId);
      if (state.sessionId !== item.sessionId || !Number.isSafeInteger(item.sequence) || item.sequence !== sequenceFor(item.individualId) + 1
        || !state.persistence?.resident || state.source !== 'fixture' || (expectedIds && !expectedIds.includes(item.individualId))) throw new RuntimeError('Stale or unavailable shared recipient; refresh both recipients.', 409);
    }
  }
  return async (request, response, url) => {
    const special = /^\/api\/shared\/(join|restore|checkpoints)$/.exec(url.pathname);
    const route = /^\/api\/shared\/([0-9a-f-]+)(?:\/(control|frames))?$/.exec(url.pathname);
    if (!special && !route) return false;
    try {
      if (!identities) throw new RuntimeError('Durable shared fixture sessions are unavailable.', 409);
      if (url.search) throw new RuntimeError('Shared endpoints accept no query parameters.');
      if (special?.[1] === 'checkpoints' && request.method === 'GET') { send(response, 200, { checkpoints: identities.sharedCheckpoints() }); return true; }
      if (route && !route[2] && request.method === 'GET') { send(response, 200, bundle(identities.sharedSnapshot(route[1]))); return true; }
      if (request.method !== 'POST' || (route && !route[2]) || special?.[1] === 'checkpoints') throw new RuntimeError('Unsupported shared method.', 405);
      const body = await bodyFor(request);
      if (special) {
        const action = special[1], keys = action === 'restore' ? ['protocolVersion', 'jointCheckpointId', 'members'] : ['protocolVersion', 'members'];
        if (!exact(body, keys) || body.protocolVersion !== 1) throw new RuntimeError('Invalid shared membership request.');
        let expected = null;
        if (action === 'restore') {
          const checkpoint = identities.sharedCheckpoints().find(item => item.jointCheckpointId === body.jointCheckpointId);
          if (!checkpoint || checkpoint.payload.members.length !== 2) throw new RuntimeError('Select a saved two-member joint checkpoint.', 409);
          expected = checkpoint.payload.members.map(item => item.individualId);
        }
        validateMembers(body.members, expected);
        // Validation of all recipient envelopes precedes any sequence consumption or runtime mutation.
        const previousSharedIds = body.members.map(member => snapshot(member.individualId).sharedSession?.sharedId).filter(Boolean);
        consumeSequences(body.members);
        const result = action === 'join' ? identities.sharedJoin(body.members.map(item => item.individualId)) : identities.sharedRestore(body.jointCheckpointId);
        const { controllerToken, ...state } = result;
        for (const previousId of previousSharedIds) sequences.delete(previousId);
        sequences.set(state.sharedId, 0);
        afterTransition(state.participants.map(item => item.individualId), action);
        send(response, 200, { ...bundle(state), controllerToken });
      } else {
        const [, id, action] = route, prior = identities.sharedSnapshot(id);
        if (action === 'frames') {
          const result = identities.sharedFrame(id, body);
          afterFrames(result.traces, id);
          send(response, 200, { ...bundle(identities.sharedSnapshot(id)), traces: result.traces });
        } else {
          if (!exact(body, ['protocolVersion', 'sharedId', 'worldEpoch', 'sequence', 'action']) || body.protocolVersion !== 1 || body.sharedId !== id
            || body.worldEpoch !== prior.worldEpoch || !Number.isSafeInteger(body.sequence) || body.sequence !== (sequences.get(id) ?? 0) + 1
            || !['start', 'pause', 'save', 'separate'].includes(body.action)) throw new RuntimeError('Stale or invalid shared control envelope.', 409);
          sequences.set(id, body.sequence);
          let state, checkpoint;
          if (body.action === 'save') { checkpoint = identities.sharedSave(id); state = identities.sharedSnapshot(id); }
          else state = body.action === 'separate' ? identities.sharedLeave(id) : identities.sharedControl(id, body.action);
          afterTransition(prior.participants.map(item => item.individualId), body.action);
          send(response, 200, { ...bundle(state), ...(checkpoint ? { checkpoint } : {}) });
          if (body.action === 'separate') sequences.delete(id);
        }
      }
    } catch (error) { send(response, error.statusCode ?? 500, { error: error.statusCode ? error.message : 'Shared fixture operation failed; refresh the paused session before retrying.' }); }
    return true;
  };
}
