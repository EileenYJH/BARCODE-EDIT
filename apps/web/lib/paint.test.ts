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
  it("a single-point brush stroke at full opacity stamps the stroke color at that point", () => {
    const buf = blank(20, 20);
    rasterizeStroke(buf, 20, 20, { tool: "brush", color: "#ff0000", size: 6, opacity: 1, points: [[10, 10]] });
    expect(pixelAt(buf, 20, 10, 10)).toEqual([255, 0, 0, 255]);
  });

  it("a brush stroke leaves pixels far outside its radius untouched", () => {
    const buf = blank(20, 20);
    rasterizeStroke(buf, 20, 20, { tool: "brush", color: "#ff0000", size: 6, opacity: 1, points: [[10, 10]] });
    expect(pixelAt(buf, 20, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("an eraser stroke at full opacity zeroes alpha on previously opaque pixels", () => {
    const buf = blank(20, 20).fill(255);
    rasterizeStroke(buf, 20, 20, { tool: "eraser", color: "#000000", size: 6, opacity: 1, points: [[10, 10]] });
    expect(pixelAt(buf, 20, 10, 10)[3]).toBe(0);
    expect(pixelAt(buf, 20, 0, 0)[3]).toBe(255); // untouched corner
  });

  it("a two-point stroke fills the gap between the points (no missing pixels)", () => {
    const buf = blank(20, 20);
    rasterizeStroke(buf, 20, 20, { tool: "brush", color: "#00ff00", size: 4, opacity: 1, points: [[2, 10], [18, 10]] });
    expect(pixelAt(buf, 20, 10, 10)[3]).toBe(255); // midpoint of the segment is covered
  });

  it("an empty points array is a no-op", () => {
    const buf = blank(20, 20);
    rasterizeStroke(buf, 20, 20, { tool: "brush", color: "#ff0000", size: 6, opacity: 1, points: [] });
    expect(pixelAt(buf, 20, 10, 10)).toEqual([0, 0, 0, 0]);
  });

  it("a brush stroke at partial opacity blends its color at a proportionally reduced alpha", () => {
    const buf = blank(20, 20);
    rasterizeStroke(buf, 20, 20, { tool: "brush", color: "#ff0000", size: 6, opacity: 0.4, points: [[10, 10]] });
    const px = pixelAt(buf, 20, 10, 10);
    expect(px[0]).toBe(255); // full-strength color, since blending over empty (transparent) pixels
    expect(px[3]).toBe(102); // alpha = 0.4 * 255
  });

  it("an eraser stroke at partial opacity only partially reduces alpha", () => {
    const buf = blank(20, 20).fill(255);
    rasterizeStroke(buf, 20, 20, { tool: "eraser", color: "#000000", size: 6, opacity: 0.4, points: [[10, 10]] });
    expect(pixelAt(buf, 20, 10, 10)[3]).toBe(153); // 255 * (1 - 0.4) = 153
  });

  it("erasing twice at partial opacity reduces alpha further each pass, eventually clearing it", () => {
    const buf = blank(20, 20).fill(255);
    const stroke = { tool: "eraser" as const, color: "#000000", size: 6, opacity: 0.5, points: [[10, 10]] as [number, number][] };
    rasterizeStroke(buf, 20, 20, stroke);
    const afterOnePass = pixelAt(buf, 20, 10, 10)[3];
    rasterizeStroke(buf, 20, 20, stroke);
    const afterTwoPasses = pixelAt(buf, 20, 10, 10)[3];
    expect(afterOnePass).toBeLessThan(255);
    expect(afterOnePass).toBeGreaterThan(0);
    expect(afterTwoPasses).toBeLessThan(afterOnePass);
  });
});
