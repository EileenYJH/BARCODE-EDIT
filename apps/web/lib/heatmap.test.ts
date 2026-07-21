import { describe, it, expect } from "vitest";
import { computeHeatmap } from "./heatmap";

function solid(w: number, h: number, r: number, g: number, b: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return data;
}

describe("computeHeatmap", () => {
  it("identical images produce an all-black result", () => {
    const a = solid(2, 2, 120, 80, 200);
    const out = computeHeatmap(a, a, 2, 2);
    for (let i = 0; i < out.length; i += 4) {
      expect(out[i]).toBe(0);
      expect(out[i + 1]).toBe(0);
      expect(out[i + 2]).toBe(0);
    }
  });

  it("maximally different images produce the ramp's brightest color", () => {
    const black = solid(2, 2, 0, 0, 0);
    const white = solid(2, 2, 255, 255, 255);
    const out = computeHeatmap(black, white, 2, 2);
    for (let i = 0; i < out.length; i += 4) {
      expect(out[i]).toBe(255);
      expect(out[i + 1]).toBe(255);
      expect(out[i + 2]).toBe(255);
    }
  });

  it("throws on mismatched dimensions", () => {
    const a = solid(2, 2, 0, 0, 0);
    const b = solid(3, 2, 0, 0, 0);
    expect(() => computeHeatmap(a, b, 2, 2)).toThrow();
  });
});
