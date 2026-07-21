function rampColor(t: number): [number, number, number] {
  // black(0) -> red(1/3) -> yellow(2/3) -> white(1)
  if (t < 1 / 3) {
    const u = t / (1 / 3);
    return [Math.round(255 * u), 0, 0];
  } else if (t < 2 / 3) {
    const u = (t - 1 / 3) / (1 / 3);
    return [255, Math.round(255 * u), 0];
  } else {
    const u = (t - 2 / 3) / (1 / 3);
    return [255, 255, Math.round(255 * u)];
  }
}

export function computeHeatmap(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  height: number
): Uint8ClampedArray {
  if (a.length !== b.length || a.length !== width * height * 4) {
    throw new Error("computeHeatmap: mismatched dimensions");
  }
  const out = new Uint8ClampedArray(a.length);
  for (let i = 0; i < a.length; i += 4) {
    const diff = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    const t = Math.min(1, diff / 765);
    const [r, g, bch] = rampColor(t);
    out[i] = r; out[i + 1] = g; out[i + 2] = bch; out[i + 3] = 255;
  }
  return out;
}
