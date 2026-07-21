# Editor Depth — Milestone 2a (History, Warp Refinement, Comparison) Design

**Date:** 2026-07-22
**Status:** Approved (design)
**Scope:** First slice of Milestone 2 ("Editor depth") from the M1 roadmap.
Frontend-only (`apps/web`); no backend changes beyond re-calling the existing
`/api/replace` endpoint.

---

## 1. Context & Scope

M1 shipped a working but minimal flow: upload → auto-detected corners →
Replace → result (with basic layer show/hide+opacity and a swipe comparison).
Two things are missing that matter for real use: **you can't undo anything**,
and **once you Replace, you can't go back and nudge the placement** — the
corner handles simply disappear.

M2 in the original roadmap bundled undo/redo, a fuller warp tool, richer
comparison modes, a full paint toolset (brush/healing/clone stamp), and
PSD-like export. That's multiple independent subsystems. This spec covers
**M2a only**: undo/redo history, a more usable warp/placement tool, and two
new comparison panels (fade, difference heatmap). Paint tools and layered
export are **M2b**, a separate future spec.

### In scope (M2a)
- Snapshot-based undo/redo history with discrete commit points.
- "Adjust placement" mode: after a Replace, return to corner-handle editing
  over the original image, re-run Replace with updated corners.
- Move-whole-quad (translate all 4 corners together).
- Reset corners to the original auto-detected quad.
- Numeric (x, y) corner input fields.
- Fade comparison panel (opacity crossfade).
- Difference heatmap panel (client-side canvas pixel diff, no backend call).

### Explicitly out of scope (later slices)
- Brush, healing brush, clone stamp, selection tools (M2b).
- PSD-like layered export (M2b).
- Any backend/API changes — M2a is a pure frontend enhancement over the
  existing `/api/detect` and `/api/replace` endpoints.
- A dedicated "split view" mode — the existing swipe comparison already is a
  movable split (a draggable divider between before/after), which satisfies
  that spec item; no separate static side-by-side view is added.

### Success criteria
From the result screen, the user can: undo back through their edits (corner
moves, settings changes, replace runs) and redo forward; click "Adjust
placement" to bring back corner handles over the original image, drag the
whole quad or a single corner or type exact coordinates, reset to the
detected quad, and re-run Replace to get a new result; and compare
original vs. result via fade slider or difference heatmap in addition to the
existing swipe.

---

## 2. Data Model

### 2.1 History snapshot

Added to `apps/web/lib/types.ts` (reuses the existing `Corner` and
`BarcodeOptions`/`ReplaceResponse` types — no new base types needed):
```typescript
export interface EditorSnapshot {
  corners: Corner[] | null;
  symbology: string;
  value: string;
  options: BarcodeOptions;
  blendMode: string;
  result: ReplaceResponse | null;
  layers: Record<string, { visible: boolean; opacity: number }>;
}
```
A snapshot captures everything that can meaningfully change except the
source `image` (fixed for the session) and `detectedCorners` (immutable
reference, see below).

### 2.2 Store additions (`apps/web/lib/store.ts`)

New state:
- `detectedCorners: Corner[] | null` — set once when `/api/detect` returns,
  never mutated afterward.
- `adjusting: boolean` — true while corner handles are shown/editable; true
  by default (pre-first-replace), false once a Replace succeeds, settable via
  `setAdjusting`.
- `history: EditorSnapshot[]`, `historyIndex: number` — snapshot stack.

New actions:
- `commit()` — takes the current relevant fields, if `historyIndex` is not at
  the end of `history`, truncates everything after it (discards redo
  branch), pushes a new snapshot, advances `historyIndex` to point at it.
- `undo()` — if `historyIndex > 0`, decrement it and apply that snapshot's
  fields back into state (without touching `image`, `detectedCorners`,
  `adjusting`, or the history arrays themselves).
- `redo()` — if `historyIndex < history.length - 1`, increment and apply.
- `canUndo` / `canRedo` — derived booleans (`historyIndex > 0` /
  `historyIndex < history.length - 1`), read via selectors rather than stored.
- `setDetectedCorners(c)`, `setAdjusting(v)`.
- `moveQuad(delta: [number, number])` — translate all 4 corners by delta
  (used by the move-quad drag; called continuously during drag, but the
  drag-end handler is what calls `commit()`).
- `resetCorners()` — `setCorners(detectedCorners)`, followed by `commit()`.

`setImage` additionally resets `detectedCorners`, `adjusting` (to `true`),
and clears `history`/`historyIndex` — a new image starts a fresh history.

Existing actions (`setCorners`, `updateCorner`, `setField`, `setOption`,
`setResult`, `setLayer`) are unchanged in signature; callers decide when to
follow them with `commit()`.

---

## 3. Component Changes

### 3.1 `EditorCanvas.tsx`

- Corner handles render when `adjusting` is true (instead of the current
  `!result` check), regardless of whether a result exists — so they can
  reappear in adjust mode.
- The image shown while `adjusting` is true is always the **original**
  image (not the result), so the user edits against the real source.
- Add an invisible polygon (Konva `Line` with `closed` and a transparent
  fill, `onMouseDown`/drag handlers) covering the quad interior: dragging it
  calls `moveQuad(delta)` continuously, and `onDragEnd` calls `commit()`.
  This sits below the 4 corner `Circle` handles so individual corners remain
  independently draggable on top of it.
- Each corner `Circle`'s `onDragEnd` (new) calls `commit()` (the existing
  `onDragMove` continues to call `updateCorner` live, uncommitted).

### 3.2 New `apps/web/components/AdjustPanel.tsx`

Rendered in the left sidebar. Contents:
- **"Adjust placement" button** — visible only when `result` exists and
  `adjusting` is false; sets `adjusting = true`.
- **"Confirm placement" button** — visible only when `adjusting` is true and
  a `result` already exists (i.e., re-adjusting, not the first placement);
  triggers the same replace mutation as the main Replace button, then sets
  `adjusting = false` on success.
- **"Reset to detected" button** — visible whenever `adjusting` is true and
  `detectedCorners` is non-null; calls `resetCorners()`.
- **Numeric corner inputs** — 4 rows of two `Input type="number"` (x, y),
  visible whenever `adjusting` is true and `corners` is non-null; `onChange`
  calls `updateCorner(i, [x, y])` live, `onBlur` calls `commit()`.

### 3.3 History controls

Added to the existing left sidebar (near the Replace button) in `page.tsx`:
two icon buttons (Undo, Redo) using shadcn `Button` with `disabled` bound to
`!canUndo` / `!canRedo`, calling `undo()` / `redo()`. A `useEffect` in
`page.tsx` (or a small `HistoryKeyboard.tsx` component) attaches a
`keydown` listener for `Ctrl+Z` (undo) and `Ctrl+Shift+Z` / `Ctrl+Y` (redo),
cleaned up on unmount.

### 3.4 `BarcodeSettings.tsx` changes

- `Select onValueChange` for symbology: after `setField("symbology", v)`,
  call `commit()` immediately (already discrete).
- `Input onChange` for value: keep live `setField("value", ...)`; add
  `onBlur` calling `commit()`.
- `Switch onCheckedChange` for show_text: call `setOption` then `commit()`
  immediately (discrete toggle).

### 3.5 `LayerPanel.tsx` changes

- `Switch onCheckedChange` (visibility): call `setLayer` then `commit()`
  immediately.
- `Slider` (opacity): keep live `onValueChange` calling `setLayer`; add an
  `onValueCommitted`-equivalent handler (the installed base-ui `Slider`
  exposes a commit callback — if unavailable, wire `onPointerUp` on the
  slider's wrapper `div` to call `commit()`) so dragging doesn't spam history.

### 3.6 `page.tsx` Replace mutation

On `onSuccess`, after `s.setResult(r)`, call `s.setAdjusting(false)` then
`s.commit()` — a successful Replace becomes one history entry with
`adjusting` implicitly false in the restored view (adjusting is not part of
the snapshot, so undo/redo doesn't fight with adjust-mode state; entering
adjust mode is a UI-only toggle, not an undoable action itself).

### 3.7 New `apps/web/components/FadeComparison.tsx`

Renders only when `result` exists. Two stacked `<img>` (original behind,
result in front... or vice versa — result is base, original overlaid),
sized identically via a wrapping `div` with `position: relative`; a
`Slider` (0–100) drives the overlaid image's `opacity` via inline style.

### 3.8 New `apps/web/components/DifferenceHeatmap.tsx`

Renders only when `result` exists.
- A `useEffect` (dependent on `image`/`result.result`) loads both into
  offscreen `Image` objects, draws each to an offscreen `<canvas>` at the
  same dimensions, reads both `ImageData` via `getContext('2d').getImageData`,
  and computes per-pixel `diff = |r1-r2| + |g1-g2| + |b1-b2|` (summed
  channel difference, 0–765).
- Maps `diff` to a color via a simple 4-stop ramp (black → red → yellow →
  white) and writes the result into a third `ImageData`, drawn onto a
  visible `<canvas ref>`.
- Recomputes only when its effect dependencies change (not on every
  render); a loading state is shown briefly for large images.

---

## 4. Testing

Frontend component/unit tests (Vitest + React Testing Library — new dev
deps, since M1 had no frontend test runner):
- **Store**: `commit/undo/redo` — pushing 3 snapshots then undoing twice then
  redoing once restores the expected snapshot's fields; `commit()` after an
  `undo()` truncates the discarded redo branch; `canUndo`/`canRedo` flip
  correctly at the boundaries.
- **`resetCorners`**: after `updateCorner` mutates corners away from
  `detectedCorners`, `resetCorners()` restores them and adds one history
  entry (not more).
- **`moveQuad`**: translating all 4 corners by a delta preserves their
  relative shape (pairwise distances unchanged) and shifts the centroid by
  exactly the delta.
- **`DifferenceHeatmap` pixel math**: a pure helper function
  `computeHeatmap(imgData1, imgData2): ImageData` extracted from the
  component (so it's testable without a DOM canvas round-trip) — verify
  identical images produce an all-black result, and a fully different image
  (e.g. all-white vs all-black) produces the ramp's brightest color.

Manual verification (documented, run once implemented): upload → detect →
adjust corners via drag, numeric input, and move-quad → Replace → Adjust
placement again → Confirm → verify new result → Undo twice → verify state
reverts → Redo → verify it reapplies → check fade slider and heatmap render
correctly.

---

## 5. Later Slices (not built here)

- **M2b**: brush, healing brush, clone stamp, selection tools (lasso/pen),
  PSD-like layered export.
- Everything else from the original M1 roadmap (M3 GPU realism tier, M4
  production infra, M5 extras) is unchanged and still pending.
