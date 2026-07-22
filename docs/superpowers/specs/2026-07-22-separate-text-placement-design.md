# Separate Text Placement Design

## Problem

Today, one placement quad drives one generated bitmap: `python-barcode` renders bars and their human-readable text together in a single image, and that whole image gets perspective-warped onto the single quad the user adjusts.

Some real labels have a fixed caption printed separately from the barcode's own text (e.g. "S/N:" printed by the manufacturer, with the barcode's own value text immediately following it). Replacing the barcode today either overwrites that caption too (if the placement quad is wide enough to reach it) or leaves it oddly disconnected from the new value. There's no way to say "keep this printed caption, only replace the value text after it."

## Goal

Let the user optionally split placement into two independently-adjustable quads: one for the bars, one for just the value text. The bars quad works exactly as it does today. The text quad, when enabled, warps and blends only the value text onto wherever the user positions it — leaving anything outside both quads (like a printed "S/N:" caption) untouched.

## Scope

- Applies only to linear symbologies with `show_text` on (QR has no separate text caption in this codebase's generation, so the toggle doesn't apply to it).
- No OCR or auto-detection of where an existing caption ends — the user manually positions the text quad, the same way placement is manually adjusted today.
- Off by default; existing single-quad behavior is unchanged when the toggle is off.

## Data Model

**Store (`apps/web/lib/store.ts`, `lib/types.ts`):**
- `textCorners: Corner[] | null` — the second quad's corners, or `null` when the feature is off.
- `separateTextPlacement: boolean` — whether the text quad is active.
- Both included in `EditorSnapshot` so undo/redo tracks the text quad alongside the bars quad.
- No `detectedTextCorners` — there is no auto-detection counterpart for the text quad.

**API (`schemas.py` → `routes.py` → `pipeline/orchestrator.py`):**
- `ReplaceRequest` (schema and dataclass) gains `text_corners: Optional[List[Corner]] = None`.
- Omitting it (the default) reproduces today's exact behavior — no change to existing callers.

## Generation & Blending

When `text_corners` is provided:

1. Generate the bars+text bitmap exactly as today, fit to the bars quad's aspect/size (existing `generate_barcode_fit` call, unchanged).
2. Split that bitmap into two crops:
   - **Bars crop**: everything above the text row (found the same way `test_font_size_scales_down_with_small_module_height` already measures "text overhead" — compare bitmap height with `show_text=True` vs `show_text=False` at the same options; the difference is the text row's height, cropped from the bottom).
   - **Text crop**: just that bottom text-row strip.
3. Warp the bars crop onto the bars quad, and the text crop onto the text quad, independently — each through the existing `warp_onto` → `match_tone` → `local_tone_correct` → composite pipeline, unchanged per-call.
4. Composite both onto the destination image. The final `mask` layer (already exposed in `ReplaceResult.layers`) becomes the union of both regions' masks, so the existing difference-heatmap/comparison UI keeps working without changes.

The text crop is not re-fit to the text quad's own aspect ratio — it's warped as-is, tolerating some stretch. It's for visual placement only (not scanned), unlike the bars, whose exact proportions matter for decoding.

## UI/UX

- **`BarcodeSettings.tsx`**: new "Separate text placement" toggle, visible only when `options.show_text` is true and `symbology !== "qr"`.
- **`EditorCanvas.tsx`**: when the toggle is on, a second quad renders using the same drag-corner + scale/rotate transform-box system already built for the bars quad (M2b).
  - **Initial position**: when first toggled on, the text quad auto-offsets below the bars quad — same width, positioned starting at the bars quad's bottom edge with zero gap, height 40% of the bars quad's own height, matching its rotation/skew. The user drags from there into the exact position over the existing text.
- **`AdjustPanel.tsx`**: a second set of 4 corner number inputs for the text quad, mirroring the existing bars-corner inputs.
- Turning the toggle off hides the text quad and the request omits `text_corners`, falling back to single-quad behavior.

## Out of Scope

- OCR-based auto-detection of an existing caption's boundary.
- Matching the kept caption's font/style for the new value text (a separate, pre-existing font-matching limitation, not part of this feature).
- Any change to QR code handling.
