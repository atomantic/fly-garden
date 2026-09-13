/**
 * Preregistered analysis for `benign-landmark-association-v1`.
 *
 * Implements exactly the `analysis` block of the protocol: seed-paired
 * retention-native-minus-baseline differences, paired block bootstrap over the
 * eight matched seed indices, 10,000 resamples, two-sided 98.75% percentile
 * intervals, Bonferroni allocation over four confirmatory contrasts, a minimum
 * effect of 0.15, and no dataset pooling.
 *
 * Negative trial scores exist only here, in analysis. They never reach the
 * simulation and never drive an aversive signal. Datasets are reported
 * separately; a difference between two specimen-derived models is never a
 * biological-sex effect.
 */
const CONFIRMATORY_CONTRASTS = Object.freeze(['frozen-neural-and-readout', 'balanced-shuffled-cue-plasticity']);
const fail = message => { throw new Error(message); };

/** SplitMix64 stream from the protocol's named `analysis` seed. Deterministic and reproducible. */
export function createSeededRandom(seed) {
  if (typeof seed !== 'bigint' || seed < 0n || seed > 0xffffffffffffffffn) fail('Analysis requires an unsigned 64-bit derived seed');
  let state = seed;
  const MASK = 0xffffffffffffffffn;
  return () => {
    state = (state + 0x9e3779b97f4a7c15n) & MASK;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
    z = (z ^ (z >> 31n)) & MASK;
    // 53 mantissa bits keeps the draw exactly representable.
    return Number(z >> 11n) / 2 ** 53;
  };
}

const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * `scores[condition][seedIndex] = { baseline, retentionNative }` mean trial
 * scores. Every seed must be present for every condition; a missing seed makes
 * the evaluation incomplete rather than being dropped or imputed.
 */
export function analyzeDataset({ dataset, seedIndices, scores, analysisSeed, resamples = 10000, confidence = 0.9875, minimumEffect = 0.15 }) {
  if (typeof dataset !== 'string' || !dataset) fail('Analysis requires an explicit dataset');
  if (!Array.isArray(seedIndices) || seedIndices.length < 2) fail('Analysis requires the matched seed index block');
  const conditions = ['paired-local-plasticity', ...CONFIRMATORY_CONTRASTS];
  for (const condition of conditions) {
    if (!scores[condition] || seedIndices.some(seed => !scores[condition][seed]
      || !Number.isFinite(scores[condition][seed].baseline) || !Number.isFinite(scores[condition][seed].retentionNative))) {
      return { dataset, status: 'incomplete', reason: `Missing matched seed scores for ${condition}; never dropped or imputed as successful`, contrasts: [] };
    }
  }
  const change = condition => seedIndices.map(seed => scores[condition][seed].retentionNative - scores[condition][seed].baseline);
  const treatment = change('paired-local-plasticity');
  const random = createSeededRandom(analysisSeed);
  const low = (1 - confidence) / 2;
  const high = 1 - low;

  const contrasts = CONFIRMATORY_CONTRASTS.map(control => {
    const paired = treatment.map((value, i) => value - change(control)[i]);
    const point = mean(paired);
    const draws = [];
    for (let r = 0; r < resamples; r++) {
      // Resample the matched seed indices as whole blocks, with replacement.
      let total = 0;
      for (let i = 0; i < paired.length; i++) total += paired[Math.min(paired.length - 1, Math.floor(random() * paired.length))];
      draws.push(total / paired.length);
    }
    draws.sort((a, b) => a - b);
    const quantile = p => draws[Math.min(draws.length - 1, Math.max(0, Math.ceil(p * draws.length) - 1))];
    const interval = [quantile(low), quantile(high)];
    return {
      control,
      perSeedDifference: paired,
      pointEffect: point,
      interval,
      twoSidedConfidence: confidence,
      resamples,
      meetsMinimumEffect: point >= minimumEffect,
      lowerBoundAboveZero: interval[0] > 0,
    };
  });

  return {
    dataset,
    status: 'complete',
    seedIndices: [...seedIndices],
    perSeedChange: Object.fromEntries(conditions.map(condition => [condition, change(condition)])),
    contrasts,
    passes: contrasts.every(contrast => contrast.meetsMinimumEffect && contrast.lowerBoundAboveZero),
    familyWiseAllocation: { alpha: 0.05, confirmatoryContrasts: 4, perContrastTwoSided: confidence, correction: 'Bonferroni' },
    poolDatasets: false,
    disclosure: 'Per-specimen engineering result. Not pooled, and never a biological-sex comparison.',
  };
}
