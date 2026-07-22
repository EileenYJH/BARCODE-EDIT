# Independent Text Font-Size Control

## Problem

When `separateTextPlacement` is on, the text box (`textCorners`) is a fully free quad — drag any of its 4 corners, or use the scale-handle, and the rendered text bitmap gets `warp_onto`-stretched to fill exactly whatever shape you drew. There's no way to say "make the text bigger" without also changing the box's shape, which distorts the text's proportions (squashed/stretched letters).

## Goal

Let the user control the text's size directly via a percentage input, independent of the box's position/rotation. The box itself becomes move+rotate only — no free corner-drag, no scale-handle — its size is derived from the font-size percentage instead.

## Backend

`python-barcode`'s renderer already takes bars sizing (`module_width`/`module_height`) and `font_size` as independent parameters. Today's code derives `font_size` from `module_height` via `_proportional_font_size` — this feature adds an independent multiplier on top of that, it doesn't replace it.

- `GenerateOptions` (`services/api/pipeline/generate.py`) gains `text_font_scale: float = 1.0`.
- `_generate_linear`'s font size line becomes: `_proportional_font_size(opts.module_height) * opts.text_font_scale`.
- Default `1.0` reproduces today's exact output for every existing caller — no behavior change unless a caller explicitly sets it.
- No change needed to `generate_barcode_split`'s bars/text crop logic: `bars_h` is measured from a **text-off** render (`bars_only_opts = replace(opts, show_text=False)`), which is unaffected by `text_font_scale`. The text portion below that line just comes out taller/shorter based on the scaled font size before being cropped — the split boundary itself doesn't move.
- `text_font_scale` is part of `options` (alongside `show_text`, `quiet_zone`, `module_width`, `module_height`) — no new top-level field on `ReplaceRequest`/the API schema beyond adding it to the existing options object.

## Frontend

**Box behavior (`EditorCanvas.tsx`):**
- `QuadTransformBoxProps` gains `resizable?: boolean` (default `true` — the bars box is unaffected).
- When `resizable={false}` (text box only): don't render the 4 corner-drag `Circle`s or the 4 edge-midpoint scale `Rect`s. Keep the draggable body (`Line`, for move) and the rotate handle (`Circle`) exactly as today.

**State (`lib/store.ts`, `lib/types.ts`):**
- `textFontScale: number` added to `EditorState` and `EditorSnapshot`, default `1.0`.
- New action `setTextFontScale(pct: number)`:
  - Sets `textFontScale: pct`.
  - Rescales `textCorners` via the existing `scaleQuad(textCorners, pct / oldTextFontScale)`, centered on the quad's own center (reuses the exact math the scale-handle already uses) — so the on-canvas box visually tracks the percentage value without needing a backend round-trip.
  - No-ops if `textCorners` is null.
- `resetCorners()`: change `textCorners: s.separateTextPlacement ? offsetTextQuad(s.detectedCorners) : s.textCorners` to `textCorners: s.separateTextPlacement ? scaleQuad(offsetTextQuad(s.detectedCorners), s.textFontScale) : s.textCorners` — so resetting the bars quad's position doesn't silently discard the user's chosen text size (the box would otherwise snap back to the 100%-scale size while the panel still showed the old percentage).

**UI (`AdjustPanel.tsx`):**
- New "Text size" percentage number input, visible under the same condition as the existing text-corner inputs (`separateTextPlacement` on). Range 50%–200%, matching the existing corner-input styling. Calls `setTextFontScale` on change.

**API call (`lib/api.ts`):**
- `text_font_scale` included in the `options` object sent to `/replace`, same place `show_text`/`quiet_zone`/etc. already go.

## Scope

- Only affects the split-placement path (`text_corners` provided). The single-quad path technically accepts `text_font_scale` too (since it's just an options field), but the UI never shows the control unless `separateTextPlacement` is on, and the default `1.0` means no behavior change either way.
- No change to `warp_onto`, `match_tone`, or `local_tone_correct` — this only changes what size bitmap gets generated and what size quad it's warped onto; the warp/blend pipeline downstream is untouched.

## Out of Scope

- Font family/tracking/baseline matching (separate, pre-existing gap, tracked in `barcode-editor-open-issues` memory).
- Any change to the bars box's own resize behavior (unaffected — `resizable` defaults `true`).
- Live backend re-render on every font-size keystroke/drag — the box preview is a frontend-only geometric approximation (uniform scale around center); the actual pixel-accurate render happens server-side on Replace, same as today's box-drag behavior already works.
