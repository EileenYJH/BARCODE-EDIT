import type { Corner } from "./types";

export function quadCenter(corners: Corner[]): Corner {
  const cx = corners.reduce((s, c) => s + c[0], 0) / corners.length;
  const cy = corners.reduce((s, c) => s + c[1], 0) / corners.length;
  return [cx, cy];
}

export function scaleQuad(corners: Corner[], factor: number): Corner[] {
  const [cx, cy] = quadCenter(corners);
  return corners.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor] as Corner);
}

export function rotateQuad(corners: Corner[], angleRad: number): Corner[] {
  const [cx, cy] = quadCenter(corners);
  const cos = Math.cos(angleRad), sin = Math.sin(angleRad);
  return corners.map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos] as Corner;
  });
}
