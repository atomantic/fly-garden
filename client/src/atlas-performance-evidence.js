/** Pure reductions for published atlas display/interaction evidence.
 *
 * Nothing here renders, fetches, times or starts anything. A browser measures the samples; these
 * functions only reduce readings it already took, so the reduction that produces a published
 * figure is unit-testable without a browser and cannot drift from the numbers in the docs.
 *
 * The honesty rule that applies to neural activity applies to measurement too: a reading the
 * browser refused to expose is reported as unavailable, never as zero.
 */

const finite = value => typeof value === 'number' && Number.isFinite(value);

/** Reduce repeated millisecond timings of one interaction into a published figure. */
export function summarizeLatency(samples) {
  if (!Array.isArray(samples) || samples.length < 1 || samples.length > 10000
    || !samples.every(value => finite(value) && value >= 0)) {
    throw new Error('Expected 1-10000 finite, non-negative millisecond samples');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return {
    count: sorted.length,
    minMs: sorted[0],
    medianMs: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    maxMs: sorted[sorted.length - 1],
  };
}

/**
 * Reduce labelled heap readings into one peak figure.
 *
 * `usedBytes` is `null` for any reading the browser declined to expose. Those labels are reported
 * as unmeasured; they are never counted as a zero-byte reading, and if no reading at all came back
 * the result is explicitly unavailable rather than a peak of 0.
 */
export function summarizeHeap(readings) {
  if (!Array.isArray(readings) || readings.length < 1 || readings.length > 100
    || !readings.every(reading => reading && typeof reading.label === 'string' && reading.label.length > 0
      && reading.label.length <= 200
      && (reading.usedBytes === null || (Number.isSafeInteger(reading.usedBytes) && reading.usedBytes > 0)))) {
    throw new Error('Expected 1-100 labelled readings whose usedBytes is a positive integer or null');
  }
  const measured = readings.filter(reading => reading.usedBytes !== null);
  const unmeasured = readings.filter(reading => reading.usedBytes === null).map(reading => reading.label);
  if (!measured.length) {
    return { available: false, reason: 'This browser exposed no JavaScript heap reading; heap use is unmeasured, not zero.', peak: null, unmeasured, readings };
  }
  const peak = measured.reduce((highest, reading) => (reading.usedBytes > highest.usedBytes ? reading : highest));
  return { available: true, reason: '', peak: { label: peak.label, usedBytes: peak.usedBytes }, unmeasured, readings };
}
