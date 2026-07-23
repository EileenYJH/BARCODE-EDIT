import type { Stroke, Corner } from "./types";

export function rasterizeStroke(
  buffer: Uint8ClampedArray, width: number, height: number, stroke: Stroke
): void {
  const radius = stroke.size / 2;
  const [r, g, b] = stroke.tool === "eraser" ? [0, 0, 0] : hexToRgb(stroke.color);

  function stampCircle(cx: number, cy: number) {
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(width - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(height - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > radius * radius) continue;
        const idx = (y * width + x) * 4;
        if (stroke.tool === "eraser") {
          // Soft erase: each pass removes `opacity` fraction of whatever
          // alpha remains, so 1.0 clears in one stroke and lower values
          // need repeated passes to fully clear.
          buffer[idx + 3] = buffer[idx + 3] * (1 - stroke.opacity);
        } else {
          // Standard "over" alpha compositing, so overlapping/partial-opacity
          // brush strokes build up naturally instead of hard-overwriting.
          const srcA = stroke.opacity;
          const dstA = buffer[idx + 3] / 255;
          const outA = srcA + dstA * (1 - srcA);
          if (outA > 0) {
            buffer[idx] = (r * srcA + buffer[idx] * dstA * (1 - srcA)) / outA;
            buffer[idx + 1] = (g * srcA + buffer[idx + 1] * dstA * (1 - srcA)) / outA;
            buffer[idx + 2] = (b * srcA + buffer[idx + 2] * dstA * (1 - srcA)) / outA;
          }
          buffer[idx + 3] = outA * 255;
        }
      }
    }
  }

  function stampSegment(a: Corner, b: Corner) {
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(dist / (radius / 2 || 1)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      stampCircle(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    }
  }

  if (stroke.points.length === 0) return;
  if (stroke.points.length === 1) {
    stampCircle(stroke.points[0][0], stroke.points[0][1]);
    return;
  }
  for (let i = 0; i < stroke.points.length - 1; i++) {
    stampSegment(stroke.points[i], stroke.points[i + 1]);
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return [r, g, b];
}
