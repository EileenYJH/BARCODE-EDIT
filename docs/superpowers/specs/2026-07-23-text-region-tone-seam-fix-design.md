# Text-Region Tone-Correction Seam Fix

## Problem

`blend.py`'s `local_tone_correct` estimates the destination's ambient lighting by inpainting the mask area, then Gaussian-blurring with a single isotropic `sigma`:

```python
size = min(xs.max() - xs.min(), ys.max() - ys.min())
sigma = max(10.0, size * 0.3)
```

`size` is the mask's *smaller* dimension. That's a fair proxy for the barcode-bars region, which is roughly square-ish. The separate text region (`text_corners`, from `separateTextPlacement`) is thin and wide (e.g. the existing test fixture is 400×40) — so `size` collapses to the height, giving `sigma≈12`. A blur that narrow only reaches ~36px past the mask edge. That's enough to pull in real destination pixels vertically, but the strip is 400px wide, so most of the interior's ambient estimate is derived from the inpainted (fabricated, textureless) fill rather than real surrounding pixels. The result reads as a visible seam/box around the pasted text, most noticeable near the left/right ends of the strip.

## Fix

Make the blur anisotropic: derive separate `sigmaX`/`sigmaY` from the mask's actual width and height, instead of one isotropic sigma from `min(width, height)`. `cv2.GaussianBlur` already accepts distinct X/Y sigmas. A wide-short mask then gets a wide-reaching horizontal blur (grounded in real pixels left/right of the strip) and a shorter vertical blur (matching its real height) — so the ambient estimate stops being bottlenecked by the smaller dimension.

```python
w = xs.max() - xs.min()
h = ys.max() - ys.min()
sigma_x = max(10.0, w * 0.3)
sigma_y = max(10.0, h * 0.3)
ambient = cv2.GaussianBlur(dst_filled, (0, 0), sigmaX=sigma_x, sigmaY=sigma_y)
```

No other behavior changes: inpainting, the additive-shift formula, and `seamless_blend`'s feathering are untouched. This only changes how the ambient estimate's blur radius is chosen.

## Scope

- `services/api/pipeline/blend.py` — `local_tone_correct` only.
- No change to `match_tone`, `seamless_blend`'s mask feathering, `warp.py`, or the orchestrator's call sites.

## Testing

- Existing tests in `test_orchestrator.py` (`test_replace_with_text_corners_places_bars_and_text_independently`) must still pass unchanged.
- New unit test on `local_tone_correct` directly: build a synthetic destination with a horizontal lighting gradient (e.g. left side dark, right side bright) and a wide-short mask spanning both ends; assert the corrected output's left and right edges each track the destination's *local* ambient value at that edge (within a tolerance), rather than both converging toward one mid-strip average — this is the failure mode the isotropic-sigma bug produces and the anisotropic fix should resolve.
- A square-ish mask (matching today's barcode-bars shape) should produce sigma_x ≈ sigma_y ≈ today's value, i.e. no behavior change for the existing bars path.

## Out of Scope

- Any other item on the open-issues punch list (text-size control, quiet-zone measurement, font matching, texture/grain, border alignment) — tracked separately in memory, not touched here.
