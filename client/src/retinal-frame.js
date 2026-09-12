// WebGL readback starts at the bottom; adapter RGB rows start at the top.
export function topDownRetinalRGB(rgba, width = 8, height = 4) {
  if (!(rgba instanceof Uint8Array) || rgba.length !== width * height * 4) throw new Error('Invalid controller raster');
  const rgb = [];
  for (let y = height - 1; y >= 0; y--) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4; rgb.push(rgba[index], rgba[index + 1], rgba[index + 2]);
  }
  return rgb;
}
export function environmentKey(state) {
  const e = state?.environmentAdapter;
  return e?.attached ? `${state.individualId}/${state.sessionId}/${e.environmentEpoch}` : null;
}
