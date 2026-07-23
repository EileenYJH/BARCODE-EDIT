# Text-Region Tone-Correction Seam Fix

## Problem

`blend.py`'s `local_tone_correct` estimates the destination's ambient lighting by inpainting the mask area, then Gaussian-blurring with a single isotropic `sigma`:

```python
size = min(xs.max() - xs.min(), ys.max() - ys.min())
sigma = max(10.0, size * 0.3)
```

`size` is the mask's *smaller* dimension. That's a fair proxy for the barcode-bars region, which is roughly square-ish. The separate text region (`text_corners`, from `separateTextPlacement`) is thin and wide (e.g. the existing test fixture is 400×40) — so `size` collapses to the height, giving `sigma≈12`. A blur that narrow only reaches ~36px past the mask edge. That's enough to pull in real destination pixels vertically, but the strip is 400px wide, so most of the interior's ambient estimate is derived from the inpainted (fabricated, textureless) fill rather than real surrounding pixels. The result reads as a visible seam/box around the pasted text, most noticeable near the left/right ends of the strip.

## Fix

Empirically (see below), the anisotropic-sigma idea does not actually fix the seam — the real problem is that `sigma` is derived from the *current mask's own size* at all. Ambient lighting is a property of the whole photograph, not of whatever region happens to need replacing; a thin mask (the text row) getting a small sigma "by accident" is what lets a nearby unrelated feature (a printed rule line, a border, adjacent text) dominate the ambient estimate for the mask's interior.

Verified via direct reproduction: a destination with a uniform 200-value paper tone but a thin darker rule line (value 90) immediately above/below a 400×40 mask. Today's formula (`sigma = max(10, min(w,h)*0.3) ≈ 12`) corrects the interior to **~99** — it should be ~200. Widening sigma per-axis (my first proposal) only reaches **~110** — still badly wrong, because vertical sigma is still bottlenecked by the mask's own 40px height.

**Fix:** base `sigma` on the destination image's own scale instead of the mask's:

```python
img_h, img_w = dst_bgr.shape[:2]
sigma = max(20.0, min(img_h, img_w) * 0.25)
ambient = cv2.GaussianBlur(dst_filled, (0, 0), sigma)
```

With this formula, the same rule-line scenario recovers to **~167** (still imperfect — the rule line is pathologically adjacent to the mask with zero gap — but a large improvement over ~99), while a smooth destination lighting gradient (the scenario `seamless_blend`'s existing test already covers) still tracks accurately (within ~3 units of the true local value) for both a wide-short mask and the existing squarish bars-shaped mask — confirming this doesn't regress the already-working bars path.

No other behavior changes: inpainting, the additive-shift formula, and `seamless_blend`'s feathering are untouched. This only changes how the ambient estimate's blur radius is chosen, and it's now a function of the image, not the mask.

## Scope

- `services/api/pipeline/blend.py` — `local_tone_correct` only.
- No change to `match_tone`, `seamless_blend`'s mask feathering, `warp.py`, or the orchestrator's call sites.

## Testing

- Existing tests in `test_orchestrator.py` (`test_replace_with_text_corners_places_bars_and_text_independently`) and `test_blend.py` must still pass unchanged.
- New unit test on `local_tone_correct` (`test_blend.py`): build a destination that's a uniform paper tone except for a thin darker rule line immediately above and below a wide-short (400×40) mask; assert the corrected interior lands close to the uniform paper tone, not the nearby rule line's value — this is the reproduced failure mode, and the fix should land substantially closer to the paper tone than today's formula does.
- Re-verify `test_seamless_blend_follows_destination_lighting_gradient` (already existing) still passes — the image-scale sigma must not regress tracking of a real, smooth destination lighting gradient.

## Out of Scope

- Any other item on the open-issues punch list (text-size control, quiet-zone measurement, font matching, texture/grain, border alignment) — tracked separately in memory, not touched here.
