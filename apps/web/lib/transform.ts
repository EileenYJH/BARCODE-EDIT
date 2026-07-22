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

export function offsetTextQuad(barsCorners: Corner[]): Corner[] {
  const [tl, tr, br, bl] = barsCorners;
  const leftEdge: Corner = [bl[0] - tl[0], bl[1] - tl[1]];
  const rightEdge: Corner = [br[0] - tr[0], br[1] - tr[1]];
  const HEIGHT_FRACTION = 0.4;
  const newBl: Corner = [bl[0] + leftEdge[0] * HEIGHT_FRACTION, bl[1] + leftEdge[1] * HEIGHT_FRACTION];
  const newBr: Corner = [br[0] + rightEdge[0] * HEIGHT_FRACTION, br[1] + rightEdge[1] * HEIGHT_FRACTION];
  return [bl, br, newBr, newBl];
}
