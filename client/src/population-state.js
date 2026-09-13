export function populationRequestCurrent(generation, current) { return generation === current.generation && !current.stopped; }
export function readPopulation(value) {
  const uint = n => Number.isSafeInteger(n) && n >= 0;
  const settings = value?.settings;
  if (!settings || ['maxResidentFlies', 'maxAggregateMemoryBytes', 'minFreeMemoryBytes'].some(key => !uint(settings[key]) || settings[key] < 1)
    || ['residentCount', 'runningCount', 'savedUnloadedCount', 'excessResidents'].some(key => !uint(value[key]))
    || ['aggregateMemoryBytes', 'availableMemoryBytes'].some(key => value[key] !== null && !uint(value[key]))
    || !['unknown', 'hard-limit', 'within-budget'].includes(value.pressure)
    || typeof value.disclosure !== 'string' || value.admission && typeof value.admission.reason !== 'string') throw new Error('Population status is incompatible.');
  return value;
}
