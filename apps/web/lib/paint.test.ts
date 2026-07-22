import { describe, it, expect } from "vitest";
import { rasterizeStroke } from "./paint";

function blank(w: number, h: number): Uint8ClampedArray {
  return new Uint8ClampedArray(w * h * 4);
}

function pixelAt(buf: Uint8ClampedArray, w: number, x: number, y: number) {
  const i = (y * w + x) * 4;
  return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
}

describe("rasterizeStroke", () => {
  it("a single-point brush stroke stamps the stroke color at that point", () => {
    const buf = blank(20, 20);
    rasterizeStroke(buf, 20, 20, { tool: "brush", color: "#ff0000", size: 6, points: [[10, 10]] });
    expect(pixelAt(buf, 20, 10, 10)).toEqual([255, 0, 0, 255]);
  });

  it("a brush stroke leaves pixels far outside its radius untouched", () => {
    const buf = blank(20, 20);
    rasterizeStroke(buf, 20, 20, { tool: "brush", color: "#ff0000", size: 6, points: [[10, 10]] });
    expect(pixelAt(buf, 20, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("an eraser stroke zeroes alpha on previously opaque pixels", () => {
    const buf = blank(20, 20).fill(255);
    rasterizeStroke(buf, 20, 20, { tool: "eraser", color: "#000000", size: 6, points: [[10, 10]] });
    expect(pixelAt(buf, 20, 10, 10)[3]).toBe(0);
    expect(pixelAt(buf, 20, 0, 0)[3]).toBe(255); // untouched corner
  });

  it("a two-point stroke fills the gap between the points (no missing pixels)", () => {
    const buf = blank(20, 20);
    rasterizeStroke(buf, 20, 20, { tool: "brush", color: "#00ff00", size: 4, points: [[2, 10], [18, 10]] });
    expect(pixelAt(buf, 20, 10, 10)[3]).toBe(255); // midpoint of the segment is covered
  });

  it("an empty points array is a no-op", () => {
    const buf = blank(20, 20);
    rasterizeStroke(buf, 20, 20, { tool: "brush", color: "#ff0000", size: 6, points: [] });
    expect(pixelAt(buf, 20, 10, 10)).toEqual([0, 0, 0, 0]);
  });
});
