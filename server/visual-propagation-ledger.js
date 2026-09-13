/** Static graph arithmetic only: never constructs or advances a neural runtime. */
export function contactLedger(graph, sourceIds, motor = {}) {
  const index = new Map(graph.ids.map((id, i) => [id, i]));
  if (new Set(sourceIds).size !== sourceIds.length || sourceIds.some(id => !index.has(id))) throw new Error('Invalid source IDs');
  if (Object.values(motor).some(id => !index.has(id))) throw new Error('Invalid motor IDs');
  const sources = new Set(sourceIds.map(id => index.get(id))), sums = new Float64Array(graph.ids.length);
  const sourceSigns = {}, sourceEdgesBySign = {}; let totalEdges = 0, contacts = 0;
  for (const source of sources) {
    const sign = graph.signs[source]; sourceSigns[sign] = (sourceSigns[sign] || 0) + 1;
    for (let e = graph.offsets[source]; e < graph.offsets[source + 1]; e++) {
      totalEdges++; contacts += graph.contacts[e]; sourceEdgesBySign[sign] = (sourceEdgesBySign[sign] || 0) + 1;
      sums[graph.targets[e]] += sign * graph.contacts[e];
    }
  }
  let minimum = 0, maximum = 0, minimumId = null, maximumId = null;
  for (let i = 0; i < sums.length; i++) {
    if (sources.has(i)) continue; // the just-fired input cells are refractory on arrival
    if (sums[i] < minimum) { minimum = sums[i]; minimumId = graph.ids[i]; }
    if (sums[i] > maximum) { maximum = sums[i]; maximumId = graph.ids[i]; }
  }
  return { sourceCount: sources.size, sourceSigns, sourceEdgesBySign, totalEdges, contacts,
    minimum: { signedContacts: minimum, neuronId: minimumId }, maximum: { signedContacts: maximum, neuronId: maximumId },
    motor: Object.fromEntries(Object.entries(motor).map(([side, id]) => [side, { neuronId: id, signedContacts: sums[index.get(id)], refractoryInput: sources.has(index.get(id)) }])) };
}
/** Closed form after a single subthreshold volley; caller must establish no later spikes/input. */
export function decayedVolley(signedContacts, elapsedTicks, model) {
  if (!Number.isSafeInteger(elapsedTicks) || elapsedTicks < 0) throw new Error('Invalid elapsed ticks');
  return signedContacts * model.contactGain * Math.exp(-elapsedTicks * model.dtMs / model.tauMs);
}
