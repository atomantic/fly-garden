/** Browser elapsed times and decoded asset lengths, never wire transfer or heap estimates. */
export function atlasLoadMetrics({ profile, startedAt, assetsReadyAt, finishedAt, declaredBytes, receivedBytes }) {
  if (!['male-cns-v1', 'banc-v888'].includes(profile)
    || ![startedAt, assetsReadyAt, finishedAt].every(Number.isFinite)
    || startedAt < 0 || assetsReadyAt < startedAt || finishedAt < assetsReadyAt
    || !Number.isSafeInteger(declaredBytes) || declaredBytes <= 0 || declaredBytes > 4 * 64 * 1024 * 1024
    || receivedBytes !== declaredBytes) throw new Error('Invalid atlas load measurement');
  return { profile, elapsedMs: finishedAt - startedAt, metadataAndAssetsMs: assetsReadyAt - startedAt,
    parseAndValidationMs: finishedAt - assetsReadyAt, declaredAssetBytes: declaredBytes, receivedAssetBytes: receivedBytes };
}
export function matchingAtlasLoadMetrics(data, profile) {
  return data?.profile === profile && data.loadMetrics?.profile === profile ? data.loadMetrics : null;
}
