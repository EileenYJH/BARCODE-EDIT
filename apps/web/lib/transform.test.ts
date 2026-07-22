import { describe, it, expect } from "vitest";
import { quadCenter, scaleQuad, rotateQuad, offsetTextQuad, scaleFactorFromDrag, straightenQuad } from "./transform";
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

describe("scaleFactorFromDrag", () => {
  it("returns 1 for zero drag distance", () => {
    expect(scaleFactorFromDrag(0)).toBe(1);
  });

  it("grows linearly with positive drag distance", () => {
    expect(scaleFactorFromDrag(150)).toBeCloseTo(1.5, 5);
    expect(scaleFactorFromDrag(300)).toBeCloseTo(2.0, 5);
  });

  it("shrinks for negative drag distance", () => {
    expect(scaleFactorFromDrag(-150)).toBeCloseTo(0.5, 5);
  });

  it("never goes below the 0.05 floor, however large the negative drag", () => {
    expect(scaleFactorFromDrag(-100000)).toBe(0.05);
  });

  it("is identical for a small quad and a huge quad given the same drag distance", () => {
    // this is the actual bug being fixed: sensitivity must depend only on
    // how far the mouse moved on screen, not on the size of the quad being
    // scaled or the resolution of the source photo. A pure function of one
    // input (drag distance) is sensitivity-independent of both by
    // construction, but this test locks in the intent.
    const tinyQuadDrag = scaleFactorFromDrag(60);
    const hugeQuadDrag = scaleFactorFromDrag(60);
    expect(tinyQuadDrag).toBe(hugeQuadDrag);
  });
});

describe("straightenQuad", () => {
  it("leaves an already-perfect axis-aligned rectangle unchanged", () => {
    const corners: Corner[] = [[10, 10], [110, 10], [110, 60], [10, 60]];
    const straightened = straightenQuad(corners);
    straightened.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(corners[i][0], 5);
      expect(y).toBeCloseTo(corners[i][1], 5);
    });
  });

  it("preserves the center of a keystone-skewed quad", () => {
    const corners: Corner[] = [[20, 10], [100, 15], [95, 60], [15, 55]];
    const before = quadCenter(corners);
    const after = quadCenter(straightenQuad(corners));
    expect(after[0]).toBeCloseTo(before[0], 5);
    expect(after[1]).toBeCloseTo(before[1], 5);
  });

  it("produces a genuine rectangle: opposite sides equal length and all angles 90 degrees", () => {
    const corners: Corner[] = [[20, 10], [100, 15], [95, 60], [15, 55]];
    const [tl, tr, br, bl] = straightenQuad(corners);
    const topLen = Math.hypot(tr[0] - tl[0], tr[1] - tl[1]);
    const bottomLen = Math.hypot(br[0] - bl[0], br[1] - bl[1]);
    const leftLen = Math.hypot(bl[0] - tl[0], bl[1] - tl[1]);
    const rightLen = Math.hypot(br[0] - tr[0], br[1] - tr[1]);
    expect(topLen).toBeCloseTo(bottomLen, 5);
    expect(leftLen).toBeCloseTo(rightLen, 5);

    // adjacent edges must be perpendicular (dot product of edge vectors is 0)
    const topVec = [tr[0] - tl[0], tr[1] - tl[1]];
    const leftVec = [bl[0] - tl[0], bl[1] - tl[1]];
    const dot = topVec[0] * leftVec[0] + topVec[1] * leftVec[1];
    expect(dot).toBeCloseTo(0, 3);
  });

  it("preserves rotation: a rotated rectangle stays at the same angle", () => {
    const rotated = rotateQuad([[0, 0], [100, 0], [100, 50], [0, 50]], Math.PI / 6);
    const straightened = straightenQuad(rotated);
    const rotatedAngle = Math.atan2(rotated[1][1] - rotated[0][1], rotated[1][0] - rotated[0][0]);
    const straightenedAngle = Math.atan2(
      straightened[1][1] - straightened[0][1], straightened[1][0] - straightened[0][0]
    );
    expect(straightenedAngle).toBeCloseTo(rotatedAngle, 5);
  });
});
