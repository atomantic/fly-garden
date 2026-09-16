import { readConnectomeState } from './connectome-lab-state.js';
const uint=value=>Number.isSafeInteger(value)&&value>=0;
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const neuronSampleScope = ({individualId,dataset,neuronId,graphManifestSha256}) => JSON.stringify([individualId,dataset,neuronId,graphManifestSha256]);
export function matchingSampleResident(value,scope) {
  const state=readConnectomeState(value);
  if(state.individualId!==scope.individualId||state.dataset!==scope.dataset||!state.resident
    || !['paused','running','resting'].includes(state.status)||!sha(state.graphSha256)
    ||typeof state.model?.id!=='string'||!Number.isFinite(state.model.dtMs)||state.model.dtMs<=0||!uint(state.model.refractorySteps)
    ||!sha(scope.graphManifestSha256)||state.provenance?.manifestSha256!==scope.graphManifestSha256)
    throw new Error('A resident worker from this exact anatomical graph is required. Load the selected connectome paused in Connectome lab first.');
  return state;
}
/** One validator for every sample size: the single-cell inspector and the bounded atlas overlay
 * both require the exact requested IDs, in the requested order, from this exact worker session. */
export function readNeuronSamples(value,state,scope,neuronIds) {
  const window=value?.timeWindow;
  if(!Array.isArray(neuronIds)||!neuronIds.length)throw new Error('A neuron sample requires at least one exact ID.');
  if(!value||value.protocolVersion!==1||value.kind!=='connectome-neuron-sample'||value.source!=='connectome'
    ||value.individualId!==scope.individualId||value.dataset!==scope.dataset||value.graphSha256!==state.graphSha256
    ||value.sessionEpoch!==state.sessionEpoch||value.modelId!==state.model?.id
    ||value.provenance?.manifestSha256!==scope.graphManifestSha256
    ||!uint(value.tick)||!uint(value.simTimeMs)||value.simTimeMs!==value.tick*state.model.dtMs
    ||!uint(value.commandSequence)||!['paused','running','resting'].includes(value.status)
    ||!window||window.kind!=='instantaneous'||window.startTick!==value.tick||window.endTick!==value.tick
    ||window.startSimTimeMs!==value.simTimeMs||window.endSimTimeMs!==value.simTimeMs
    ||!Array.isArray(value.samples)||value.samples.length!==neuronIds.length)throw new Error('Neuron sample source or time window does not match this selection.');
  value.samples.forEach((entry,at)=>{
    if(!entry||entry.neuronId!==neuronIds[at]||!Number.isFinite(entry.potential)||![0,1].includes(entry.firing)
      ||!uint(entry.refractoryStepsRemaining)||entry.refractoryStepsRemaining>state.model.refractorySteps)
      throw new Error('Neuron sample values are invalid; no activity is substituted.');
  });
  return value;
}
export const readNeuronSample=(value,state,scope)=>readNeuronSamples(value,state,scope,[scope.neuronId]);
export function confirmNeuronSample(sample,latest,scope) {
  matchingSampleResident(latest,scope);
  if(latest.sessionEpoch!==sample.sessionEpoch||latest.graphSha256!==sample.graphSha256
    ||latest.commandSequence<sample.commandSequence||!latest.neural||latest.neural.tick<sample.tick)
    throw new Error('The worker session changed while reading. Request a new sample.');
  return sample;
}

export const currentNeuronSampleRequest=(request,current)=>request.key===current.key&&request.generation===current.generation;
