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
          buffer[idx + 3] = 0;
        } else {
          buffer[idx] = r; buffer[idx + 1] = g; buffer[idx + 2] = b; buffer[idx + 3] = 255;
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
