import { describe, it, expect } from "vitest";
import { quadCenter, scaleQuad, rotateQuad } from "./transform";
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
