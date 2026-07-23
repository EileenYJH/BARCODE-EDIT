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

const SCALE_DRAG_SENSITIVITY_PX = 300; // dragging the handle this many
                                        // canvas pixels away from its start
                                        // roughly doubles the quad's size

export function scaleFactorFromDrag(deltaCanvasPx: number): number {
  // Deliberately a function of ONE input: how far the mouse moved on
  // screen. Earlier this divided by the quad's own average corner-to-center
  // distance and by the photo's display scale (screen px per image px),
  // which meant a "normal" drag felt wildly different depending on the
  // photo's resolution and the box's own size -- a small text-placement box
  // on a modestly-sized photo would blow up or collapse from a tiny mouse
  // movement, while the same drag barely nudged a big box. Sensitivity
  // should feel the same regardless of either.
  return Math.max(0.05, 1 + deltaCanvasPx / SCALE_DRAG_SENSITIVITY_PX);
}

export function quadRotation(corners: Corner[]): number {
  // average the top and bottom edges' directions as vectors (not just their
  // angles) so the two average correctly even near the +-pi wraparound
  const [tl, tr, br, bl] = corners;
  const topAngle = Math.atan2(tr[1] - tl[1], tr[0] - tl[0]);
  const bottomAngle = Math.atan2(br[1] - bl[1], br[0] - bl[0]);
  const avgDx = Math.cos(topAngle) + Math.cos(bottomAngle);
  const avgDy = Math.sin(topAngle) + Math.sin(bottomAngle);
  return Math.atan2(avgDy, avgDx);
}

export function straightenQuad(corners: Corner[]): Corner[] {
  // Snaps a keystone/skewed quad back to a perfect rectangle, keeping its
  // center, average size, and average rotation -- so a user fighting with
  // 4 independently-draggable corners can recover a clean rectangle without
  // having to eyeball all 4 points back into alignment by hand.
  const [tl, tr, br, bl] = corners;
  const center = quadCenter(corners);

  const topWidth = Math.hypot(tr[0] - tl[0], tr[1] - tl[1]);
  const bottomWidth = Math.hypot(br[0] - bl[0], br[1] - bl[1]);
  const width = (topWidth + bottomWidth) / 2;

  const leftHeight = Math.hypot(bl[0] - tl[0], bl[1] - tl[1]);
  const rightHeight = Math.hypot(br[0] - tr[0], br[1] - tr[1]);
  const height = (leftHeight + rightHeight) / 2;

  const angle = quadRotation(corners);

  const cos = Math.cos(angle), sin = Math.sin(angle);
  const hw = width / 2, hh = height / 2;
  const local: Corner[] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  return local.map(([x, y]) => [
    center[0] + x * cos - y * sin,
    center[1] + x * sin + y * cos,
  ] as Corner);
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
