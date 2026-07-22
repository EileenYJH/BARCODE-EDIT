import { describe, it, expect } from "vitest";
import { quadCenter, scaleQuad, rotateQuad, offsetTextQuad } from "./transform";
import type { Corner } from "./types";

describe("quadCenter", () => {
  it("returns the average of the 4 corners", () => {
    const corners: Corner[] = [[0, 0], [100, 0], [100, 100], [0, 100]];
    expect(quadCenter(corners)).toEqual([50, 50]);
  });
});

describe("scaleQuad", () => {
  it("scales every corner's distance from center by the given factor", () => {
    const corners: Corner[] = [[0, 0], [100, 0], [100, 100], [0, 100]];
    const scaled = scaleQuad(corners, 2);
    expect(scaled).toEqual([[-50, -50], [150, -50], [150, 150], [-50, 150]]);
  });

  it("leaves the center unchanged", () => {
    const corners: Corner[] = [[0, 0], [100, 0], [100, 100], [0, 100]];
    const scaled = scaleQuad(corners, 2);
    expect(quadCenter(scaled)).toEqual([50, 50]);
  });

  it("factor 1 is a no-op", () => {
    const corners: Corner[] = [[10, 20], [130, 15], [125, 140], [5, 145]];
    expect(scaleQuad(corners, 1)).toEqual(corners);
  });
});

describe("rotateQuad", () => {
  it("rotates a square 90 degrees around its center, preserving each corner's distance from center", () => {
    const corners: Corner[] = [[0, 0], [100, 0], [100, 100], [0, 100]];
    const rotated = rotateQuad(corners, Math.PI / 2);
    const center = quadCenter(corners);
    const before = corners.map(([x, y]) => Math.hypot(x - center[0], y - center[1]));
    const after = rotated.map(([x, y]) => Math.hypot(x - center[0], y - center[1]));
    before.forEach((d, i) => expect(after[i]).toBeCloseTo(d, 5));
  });

  it("leaves the center unchanged", () => {
    const corners: Corner[] = [[10, 20], [130, 15], [125, 140], [5, 145]];
    const rotated = rotateQuad(corners, 0.3);
    const before = quadCenter(corners);
    const after = quadCenter(rotated);
    expect(after[0]).toBeCloseTo(before[0], 5);
    expect(after[1]).toBeCloseTo(before[1], 5);
  });

  it("angle 0 is a no-op", () => {
    const corners: Corner[] = [[10, 20], [130, 15], [125, 140], [5, 145]];
    const rotated = rotateQuad(corners, 0);
    rotated.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(corners[i][0], 5);
      expect(y).toBeCloseTo(corners[i][1], 5);
    });
  });
});

describe("offsetTextQuad", () => {
  it("starts at the bars quad's bottom edge, matching its width", () => {
    const bars: Corner[] = [[0, 0], [200, 0], [200, 50], [0, 50]];
    const text = offsetTextQuad(bars);
    expect(text[0]).toEqual([0, 50]);   // tl = bars' bl
    expect(text[1]).toEqual([200, 50]); // tr = bars' br
  });

  it("extends downward by 40% of the bars quad's height", () => {
    const bars: Corner[] = [[0, 0], [200, 0], [200, 50], [0, 50]];
    const text = offsetTextQuad(bars);
    expect(text[2]).toEqual([200, 70]); // br: 50 + 0.4*(50-0)
    expect(text[3]).toEqual([0, 70]);   // bl
  });

  it("preserves rotation/skew: the text quad's edges stay parallel to the bars quad's own edges", () => {
    // a genuine (non-parallelogram) trapezoid -- left and right edges point
    // in different directions, so a bug that reused one edge's vector for
    // both sides would fail this
    const bars: Corner[] = [[10, 10], [110, 20], [105, 60], [0, 55]];
    const text = offsetTextQuad(bars);
    const barsLeftDir = [bars[3][0] - bars[0][0], bars[3][1] - bars[0][1]];
    const textLeftDir = [text[3][0] - text[0][0], text[3][1] - text[0][1]];
    const barsLeftLen = Math.hypot(barsLeftDir[0], barsLeftDir[1]);
    const textLeftLen = Math.hypot(textLeftDir[0], textLeftDir[1]);
    expect(textLeftDir[0] / textLeftLen).toBeCloseTo(barsLeftDir[0] / barsLeftLen, 5);
    expect(textLeftDir[1] / textLeftLen).toBeCloseTo(barsLeftDir[1] / barsLeftLen, 5);

    const barsRightDir = [bars[2][0] - bars[1][0], bars[2][1] - bars[1][1]];
    const textRightDir = [text[2][0] - text[1][0], text[2][1] - text[1][1]];
    const barsRightLen = Math.hypot(barsRightDir[0], barsRightDir[1]);
    const textRightLen = Math.hypot(textRightDir[0], textRightDir[1]);
    expect(textRightDir[0] / textRightLen).toBeCloseTo(barsRightDir[0] / barsRightLen, 5);
    expect(textRightDir[1] / textRightLen).toBeCloseTo(barsRightDir[1] / barsRightLen, 5);
  });
});
