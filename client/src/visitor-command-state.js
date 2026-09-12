import { mergeRuntimeSnapshot } from './runtime-state.js';

/** A toolbar response cannot select a recipient or reintroduce a superseded runtime. */
export function mergeToolbarVisitorReply(previous, next, request, current) {
  if (!previous || !next || request.generation !== current.generation || request.individualId !== current.selectedId
    || previous.individualId !== request.individualId || previous.sessionId !== request.sessionId
    || next.individualId !== request.individualId || next.sessionId !== request.sessionId) return previous;
  return mergeRuntimeSnapshot(previous, next);
}
