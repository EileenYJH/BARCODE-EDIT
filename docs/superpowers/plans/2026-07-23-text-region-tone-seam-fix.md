# Text-Region Tone-Correction Seam Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a visible box/seam artifact around the separately-placed text region, caused by `local_tone_correct`'s ambient-lighting blur radius being derived from the current mask's own (small) size instead of the destination photo's own scale.

**Architecture:** Single-function change in `services/api/pipeline/blend.py`. `local_tone_correct`'s `sigma` currently comes from `max(10.0, min(mask_width, mask_height) * 0.3)`. Replace it with `max(20.0, min(image_height, image_width) * 0.25)` — a function of the destination image's dimensions, not the mask's. No other function changes.

**Tech Stack:** Python 3.14, opencv 5.0 (`cv2.GaussianBlur`, `cv2.inpaint`), pytest, numpy.

---

### Task 1: Add failing test reproducing the seam artifact

**Files:**
- Test: `services/api/tests/test_blend.py`

- [ ] **Step 1: Write the failing test**

Add this test to `services/api/tests/test_blend.py` (after the existing `test_seamless_blend_follows_destination_lighting_gradient`):

```python
def test_seamless_blend_ignores_nearby_unrelated_features_for_a_thin_wide_mask():
    # A real label's separately-placed text row (via text_corners) is thin
    # and wide (e.g. the existing 400x40 fixture in test_orchestrator.py),
    # unlike the roughly square-ish bars region. If a printed rule line or
    # border sits close to the text row (very plausible -- captions and
    # rule lines are often near the barcode's value text), local_tone_correct
    # must not let that nearby feature dominate the ambient estimate for the
    # whole strip -- confirmed via direct reproduction: coupling the blur's
    # sigma to the CURRENT mask's own (small) height let a thin dark rule
    # line immediately above/below the mask pull the corrected interior down
    # to ~99 on a uniform 200-value paper background, instead of ~200.
    dst = np.full((250, 500, 3), 200, dtype=np.uint8)  # uniform bright paper
    dst[95:100, :] = 90    # thin dark rule line just above the mask
    dst[140:145, :] = 90   # thin dark rule line just below the mask
    patch = np.full((250, 500, 3), 150, dtype=np.uint8)  # flat mid-gray "paper"
    mask = np.zeros((250, 500), np.uint8)
    cv2.rectangle(mask, (50, 100), (450, 140), 255, -1)  # wide-short: 400x40

    blended = seamless_blend(patch, dst, mask, mode="normal")
    center = blended[115:125, 200:300].mean()
    # today's mask-size-coupled sigma lands around ~99-110; the fix should
    # land much closer to the true 200 paper tone
    assert center > 150
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && .venv/Scripts/python.exe -m pytest tests/test_blend.py::test_seamless_blend_ignores_nearby_unrelated_features_for_a_thin_wide_mask -v`
Expected: FAIL — `assert center > 150` fails because `center` is close to 99 (well under 150).

- [ ] **Step 3: Commit**

```bash
git add services/api/tests/test_blend.py
git commit -m "test: reproduce tone-correction seam artifact for thin wide masks"
```

### Task 2: Fix `local_tone_correct` to derive sigma from the image, not the mask

**Files:**
- Modify: `services/api/pipeline/blend.py:4-34`

- [ ] **Step 1: Replace the sigma calculation**

In `services/api/pipeline/blend.py`, replace the `local_tone_correct` function body's sigma derivation. Current code:

```python
    ys, xs = np.where(mask > 0)
    if len(xs) == 0:
        return src_bgr.copy()
    size = min(xs.max() - xs.min(), ys.max() - ys.min())
    sigma = max(10.0, size * 0.3)
```

Replace with:

```python
    ys, xs = np.where(mask > 0)
    if len(xs) == 0:
        return src_bgr.copy()
    # sigma reflects the PHOTO's own scale, not the current mask's size --
    # ambient lighting is a property of the whole surface being photographed,
    # not of whichever region happens to be getting replaced. Coupling sigma
    # to the mask's own (possibly small) size let nearby unrelated printed
    # features dominate the ambient estimate for small/thin masks (confirmed
    # via direct reproduction: a thin rule line next to a wide-short text
    # mask pulled the corrected interior far from the true surrounding paper
    # tone). Confirmed this scale still tracks a real smooth lighting
    # gradient accurately for both a wide-short mask and the existing
    # squarish bars-shaped mask.
    img_h, img_w = dst_bgr.shape[:2]
    sigma = max(20.0, min(img_h, img_w) * 0.25)
```

Also update the function's docstring to describe this (append after the existing docstring text, before the closing `"""`):

```python
    Sigma is derived from the destination image's own dimensions, not the
    mask's -- see the comment at the sigma calculation below for why.
    """
```

- [ ] **Step 2: Run the new test to verify it passes**

Run: `cd services/api && .venv/Scripts/python.exe -m pytest tests/test_blend.py::test_seamless_blend_ignores_nearby_unrelated_features_for_a_thin_wide_mask -v`
Expected: PASS

- [ ] **Step 3: Run the full blend and orchestrator test suites to check for regressions**

Run: `cd services/api && .venv/Scripts/python.exe -m pytest tests/test_blend.py tests/test_orchestrator.py -v`
Expected: All PASS, including `test_seamless_blend_follows_destination_lighting_gradient` (the existing smooth-gradient test) and `test_replace_with_text_corners_places_bars_and_text_independently`.

- [ ] **Step 4: Run the full backend test suite**

Run: `cd services/api && .venv/Scripts/python.exe -m pytest tests/ -v`
Expected: All PASS (should be 19 tests: the 18 documented in memory plus this task's new one).

- [ ] **Step 5: Commit**

```bash
git add services/api/pipeline/blend.py
git commit -m "fix: derive tone-correction ambient sigma from image scale, not mask size"
```

### Task 3: Visual sanity check against the real split-placement path

**Files:** none modified — verification only.

- [ ] **Step 1: Render a before/after comparison image**

Run this from `services/api`:

```bash
.venv/Scripts/python.exe -c "
import numpy as np
import cv2
import sys
sys.path.insert(0, '.')
from pipeline.orchestrator import replace_barcode, ReplaceRequest
from pipeline.generate import GenerateOptions

scene = np.full((400, 900, 3), 220, np.uint8)
scene[85:90, 90:510] = 140   # a rule line near the text row, like a real label
bars_corners = np.float32([[100, 100], [500, 100], [500, 180], [100, 180]])
text_corners = np.float32([[100, 190], [500, 190], [500, 230], [100, 230]])
req = ReplaceRequest(
    image=scene, corners=bars_corners, symbology='code128',
    value='SPLITME1', options=GenerateOptions(show_text=True),
    blend_mode='normal', text_corners=text_corners,
)
res = replace_barcode(req)
cv2.imwrite('/tmp/seam_fix_check.png', res.result)
print('wrote /tmp/seam_fix_check.png')
"
```

- [ ] **Step 2: Read the output image with the Read tool and visually confirm no visible box/seam around the text region**

Per [[barcode-editor-blend-poisson-lesson]] — never trust a statistical proxy alone here; actually view the rendered PNG. Read `/tmp/seam_fix_check.png` and confirm the text region blends into the surrounding tone without a visible rectangular outline.

- [ ] **Step 3: If a seam is still visible, stop and report back before making further changes**

This task doesn't modify code — if the visual check reveals a remaining problem, report the specifics (where the seam appears, how it looks) rather than iterating further within this plan.
