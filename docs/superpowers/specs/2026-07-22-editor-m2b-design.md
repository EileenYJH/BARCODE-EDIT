# Editor Depth — Milestone 2b (Layer-Based Retouching & Placement Refinement) Design

**Date:** 2026-07-22
**Status:** Approved (design)
**Scope:** Second slice of Milestone 2 ("Editor depth"), continuing from
[2026-07-22-editor-m2a-design.md](2026-07-22-editor-m2a-design.md). Frontend-only
(`apps/web`); no backend changes. This is the "M2b" the M2a spec forward-referenced
(brush/eraser + layer-based retouching), scoped down from that spec's original
"healing brush, clone stamp, selection tools, PSD-like layered export" list — see
§5 for what's deliberately cut.

---

## 1. Context & Scope

M2a added undo/redo, a fuller placement/warp tool, and richer comparison panels.
Two things are still missing for a Photoshop-like feel: (1) placement (the 4-corner
quad) is fiddly to resize precisely, and (2) once a Replace is baked, there's no way
to touch up the result — fix a rough blend edge, or paint a small correction — short
of re-running the whole placement from scratch.

A key resolved tension from brainstorming: the backend's Poisson seamless-clone
blend only looks right at the exact position/size it was baked for — a genuinely
movable/scalable *post-bake* layer would either show a visible seam or require a
live re-bake per drag. The design below avoids that tradeoff entirely:

- **Pre-bake sizing** gets easier via a transform box, but it still edits the same
  4 corners that feed the *existing, unchanged* backend bake — full Poisson quality,
  every time.
- **Post-bake repositioning** already exists — M2a's "Adjust placement → Confirm
  placement" flow re-bakes fresh at the new position. No new architecture needed.
- **Brush/eraser** are touch-up tools on the *finished* composite, not a way to move
  the barcode. They never fight with Poisson blending because they don't move
  anything — they paint on top or reveal what's underneath.

### In scope (M2b)
- **Transform box**: scale (from center) and rotate handles overlaid on the existing
  corner-quad during placement, as an easier alternative to dragging individual
  corners. Recomputes the same 4 `corners` — the bake is unaffected.
- **Layer stack** for post-bake editing: Original (bottom) → Result (baked
  composite, with an erasable reveal mask) → Retouch (top, transparent, brush-only).
- **Brush**: paints colored strokes onto the Retouch layer.
- **Eraser**: dual-target — erases Retouch strokes when Retouch is the active
  layer; punches into Result's reveal mask (exposing Original) when Result is
  active.
- Undo/redo integration: each completed stroke is one commit, consistent with
  M2a's "discrete actions only" rule.
- Export (PNG) flattens Original → masked Result → Retouch into the downloaded
  image.

### Explicitly out of scope (see §5 for the full list)
- Multiple/reorderable retouch layers, clone/stamp, healing brush, selection tools.
- Any change to the backend bake pipeline or SVG export (SVG export stays
  barcode-only, exactly as in M1/M2a).

### Success criteria
During placement, the user can drag a corner handle (existing), drag the whole
quad (existing, M2a), or use the new scale/rotate handles to resize/rotate the
whole placement rectangle at once. After a Replace, the user can switch to
Retouch mode, pick Brush or Eraser, pick whether they're painting on the Retouch
layer or revealing the Original through the Result layer, and paint — with each
stroke undoable individually. Downloading the PNG includes all retouching.

---

## 2. Data Model

### 2.1 New types (`apps/web/lib/types.ts`)

```typescript
export type ActiveLayer = "retouch" | "result";

export interface Stroke {
  tool: "brush" | "eraser";
  color: string;   // hex; irrelevant for eraser strokes but kept for simplicity
  size: number;     // brush/eraser diameter in image-space px
  points: Corner[]; // path the stroke followed, in image-space coordinates
}
```

`EditorSnapshot` (added in M2a) gains two fields:
```typescript
export interface EditorSnapshot {
  // ...existing fields unchanged...
  retouchStrokes: Stroke[];
  resultMaskStrokes: Stroke[]; // eraser strokes that reveal Original through Result
}
```
Strokes are small (a path of points, not raster data), so — consistent with every
other `EditorSnapshot` field — they're snapshotted by value on every `commit()`.
Undo/redo restoring a snapshot's `retouchStrokes`/`resultMaskStrokes` arrays
directly (no separate replay-count bookkeeping needed) is what makes a stroke
individually undoable.

### 2.2 Store additions (`apps/web/lib/store.ts`)

New state:
- `retouching: boolean` — true while the paint toolset is active. Mutually
  exclusive with `adjusting` (entering one exits the other) to keep the canvas UI
  unambiguous — corner/transform handles and a paint cursor are never shown at once.
- `activeLayer: ActiveLayer` — which layer Brush/Eraser currently target. Default
  `"retouch"`.
- `tool: "brush" | "eraser"` — default `"brush"`.
- `brushSize: number` (default e.g. 12px), `brushColor: string` (default e.g.
  `#000000`) — Eraser reuses `brushSize` as its own diameter; no separate eraser
  size setting (YAGNI — one size control, not two).
- `retouchStrokes: Stroke[]`, `resultMaskStrokes: Stroke[]` — same fields as the
  snapshot, live in current state; growing/shrinking as strokes are added or
  undone.

New actions:
- `setRetouching(v)` — when turning on, also sets `adjusting = false`. Conversely,
  `setAdjusting` (existing, M2a) is extended to set `retouching = false` when
  turning on — so switching into either mode always exits the other.
- `setActiveLayer(l)`, `setTool(t)`, `setBrushSize(n)`, `setBrushColor(c)`.
- `addStroke(stroke: Stroke)` — appends to `retouchStrokes` if
  `stroke.tool === "brush"` (brush is Retouch-only, per §1), or to whichever
  array matches `activeLayer` if `stroke.tool === "eraser"` (eraser on `"retouch"`
  appends to `retouchStrokes` as an erase-marked stroke; eraser on `"result"`
  appends to `resultMaskStrokes`). Calls `commit()` itself — a completed stroke
  is always a whole, atomic, undoable action, the same self-committing pattern
  `resetCorners()` already established in M2a.

`setImage` additionally resets `retouching` (to `false`), `retouchStrokes`, and
`resultMaskStrokes` (to `[]`) — a new image starts fresh, same as it already does
for `history`/`adjusting`/`detectedCorners`.

### 2.3 Rasterizing strokes (`apps/web/lib/paint.ts`, new)

Pure, DOM-free (testable in jsdom without a real canvas, following the same
pattern `lib/heatmap.ts` established in M2a):

```typescript
export function rasterizeStroke(
  buffer: Uint8ClampedArray, width: number, height: number, stroke: Stroke
): void
```
Mutates `buffer` in place: for a `"brush"` stroke, stamps a filled circle of
`stroke.color` at `stroke.size` diameter along every point in `stroke.points`
(connecting consecutive points with filled-circle stamps so a fast drag doesn't
leave gaps). For an `"eraser"` stroke, stamps the same shape but writes alpha=0
instead of a color (works identically whether `buffer` represents the Retouch
layer's own RGBA canvas or the Result layer's single-channel reveal mask — the
function only cares about "paint" vs "erase", not which conceptual layer it's
being applied to).

---

## 3. Component Changes

### 3.1 Transform box — `EditorCanvas.tsx`

Alongside the existing corner `Circle` handles and move-quad `Line` (both from
M2a, unchanged), add — only while `adjusting` is true:
- A best-fit oriented bounding box of the current 4 corners (center, width,
  height, rotation — computed once per render from the corners, not stored
  separately).
- **4 scale handles** at the box's corners: dragging one scales the whole
  quad from its center by the ratio of (new distance from center) / (old
  distance from center), applied uniformly to all 4 corners. `onDragEnd`
  calls `commit()`.
- **1 rotate handle** offset above the box's top edge: dragging it rotates
  all 4 corners around the box's center by the angle delta. `onDragEnd` calls
  `commit()`.

This is purely an alternate *input method* for the same `corners` array — it
does not change what gets sent to `/api/replace`, so the backend bake (and its
Poisson-blend quality) is completely unaffected. Individual corner drag and
whole-quad move (M2a) remain available at the same time for cases with real
perspective skew that a rigid scale/rotate can't express.

### 3.2 Retouch mode — `EditorCanvas.tsx`

While `retouching` is true: render the current composite (Original + masked
Result + Retouch, via the same compositing logic as export, §3.4) on an
interactive `<canvas>` (not Konva — direct pointer-event drawing is simpler for
freehand paint than shape-based Konva nodes). Pointer handlers:
- `pointerdown` starts a new stroke (empty `points` array using `tool`,
  `brushColor`, `brushSize` from the store).
- `pointermove` (while a stroke is active) appends the current image-space
  point, and calls `rasterizeStroke` against a live preview buffer so the
  stroke is visible while drawing.
- `pointerup` finalizes the stroke and calls `addStroke(stroke)` (which commits).

### 3.3 New `apps/web/components/ToolPanel.tsx`

Rendered in the left sidebar, visible only when `retouching` is true:
- Tool toggle: Brush / Eraser (`setTool`).
- Active layer toggle: Retouch / Result (`setActiveLayer`) — disabled/hidden
  when `tool === "brush"`, since brush is always Retouch-only (§2.2).
- Brush size slider, brush color input (color input hidden when `tool ===
  "eraser"`, since erasing doesn't use a color).

### 3.4 Compositing (`apps/web/lib/composite.ts`, new)

A `compositeLayers(original, result, resultMask, retouchLayer): ImageData`-shaped
function (real canvas-based, used both by the live Retouch-mode canvas and by
export) that:
1. Draws `original`.
2. Draws `result` on top, masked by `resultMask`'s per-pixel alpha (starts fully
   opaque; eraser-on-Result strokes reduce it via `rasterizeStroke`).
3. Draws the `retouchLayer` (brush strokes + eraser-on-Retouch strokes) on top.

`resultMask` and `retouchLayer` are each derived by starting from a blank
(fully-opaque / fully-transparent, respectively) buffer and replaying the
relevant `Stroke[]` through `rasterizeStroke` — recomputed whenever
`retouchStrokes`/`resultMaskStrokes` change (including on undo/redo, since
those arrays are exactly what gets restored).

### 3.5 `ExportBar.tsx` changes

"Download PNG" now runs the image through `compositeLayers` (drawing to an
offscreen canvas, then `toDataURL`/`toBlob`) instead of downloading
`result.result` directly, so retouching is included. **"Download SVG" is
unchanged** — it continues to export just the generated barcode's own vector
form (as established in M1), unaffected by retouching, since freehand paint
strokes have no meaningful vector representation here.

### 3.6 `page.tsx` wiring

- A button that toggles between "Retouch" (visible when `result` exists and
  `retouching` is false; calls `setRetouching(true)`) and "Done" (visible when
  `retouching` is true; calls `setRetouching(false)`) — same single-button
  swap pattern as M2a's existing "Adjust placement" button. Both this button
  and "Adjust placement" can show together whenever a result exists and
  neither mode is active, or during Retouch mode (clicking "Adjust placement"
  then exits Retouch, per the mutual exclusivity in §2.2) — never during
  Adjust mode itself, since `adjusting` and `retouching` can't both be true.
- Render `ToolPanel` alongside the existing sidebar panels.

---

## 4. Testing

Frontend unit tests (Vitest + RTL, same setup as M2a):
- **`rasterizeStroke`**: a brush stroke with a single point stamps a circle of
  the expected color/size into a blank buffer at the expected pixel; an eraser
  stroke over previously-opaque pixels zeroes their alpha; a two-point stroke
  fills the gap between points (no missing pixels along a straight short
  segment).
- **Store**: `addStroke` for `tool: "brush"` always lands in `retouchStrokes`
  regardless of `activeLayer`; `addStroke` for `tool: "eraser"` lands in
  `retouchStrokes` or `resultMaskStrokes` depending on `activeLayer`; each call
  produces exactly one history commit; undo restores the previous stroke
  array (one stroke fewer), redo reapplies it.
- **`setRetouching(true)`** sets `adjusting` to `false` (mutual exclusivity).
- **Transform box math**: given a known axis-aligned quad and a scale-handle
  drag distance, the resulting 4 corners are the expected uniformly-scaled
  positions (pairwise distances scale by the exact ratio, center unchanged);
  same for a rotate-handle drag (corners rotate by the exact angle around the
  center, distances from center unchanged).

No unit test for the interactive `<canvas>` pointer-event wiring in
`EditorCanvas.tsx` itself, or for `compositeLayers`'s real canvas/Image loading
— same documented gap as M2a's `EditorCanvas`/`DifferenceHeatmap`, covered
instead by manual verification once implemented, plus the pure `rasterizeStroke`
tests covering the actual pixel math those components depend on.

Manual verification (once implemented): Replace → Retouch mode → paint a brush
stroke → switch to Eraser + Result active layer → erase part of the result to
reveal Original underneath → switch Eraser back to Retouch active layer → erase
part of the brush stroke → Undo three times → verify each stroke reverts one at
a time → Redo → verify reapplication → Download PNG → confirm retouching is
present in the file → Download SVG → confirm it's still just the barcode vector,
unaffected. Separately: drag a scale handle → confirm the quad resizes
uniformly from center; drag the rotate handle → confirm it spins around center;
Replace → confirm the bake is unaffected (same Poisson quality as before).

---

## 5. Later Slices (not built here)

Cut from M2a's original "M2b" forward-reference to keep this milestone tight:
- Multiple or reorderable retouch layers, layer renaming.
- Clone/stamp tool, healing brush, eyedropper/color-picker-from-image.
- Selection tools (lasso/marquee) — brush/eraser apply directly via drag, no
  selection-constrained painting.
- Brush pressure/texture/opacity variation — one solid round brush, one size
  control, that's it.
- Partial-stroke undo (undoing mid-stroke) — a stroke is atomic once finished.
- PSD-like layered export — "Download PNG" flattens everything into one image;
  there's no way to export the layer stack itself for editing in another tool.
- Any backend/API change — M2b, like M2a, is a pure frontend enhancement.

Everything else from the original M1 roadmap (M3 GPU realism tier, M4
production infra, M5 extras) is unchanged and still pending.
