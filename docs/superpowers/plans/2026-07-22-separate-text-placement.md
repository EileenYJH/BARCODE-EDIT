# Separate Text Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user optionally split barcode placement into two independent quads -- bars and value text -- so an existing printed caption (like "S/N:") can stay untouched while only the value text after it gets replaced.

**Architecture:** Backend: reuse the existing bars+text bitmap generation, split it into a bars crop and a text crop (found by comparing bitmap height with/without text at the same module_height/dpi), warp+tone-match+composite each independently through the existing per-region pipeline. Frontend: extract the existing single-quad drag/scale/rotate transform box into a reusable component, render a second instance for the text quad when a new toggle is on.

**Tech Stack:** Python/FastAPI/OpenCV (backend), Next.js/React/Zustand/react-konva/Vitest (frontend). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-22-separate-text-placement-design.md`

---

### Task 1: generate.py -- split bars from text

**Files:**
- Modify: `services/api/pipeline/generate.py`
- Test: `services/api/tests/test_generate.py`

- [ ] **Step 1: Write the failing tests**

Add to `services/api/tests/test_generate.py` (after the existing imports, anywhere among the other tests):

```python
def test_generate_barcode_split_returns_bars_and_text_bitmaps_separately():
    full, bars, text = generate_barcode_split("code128", "HELLO123", GenerateOptions(show_text=True), target_aspect=2.5)
    assert text is not None
    assert bars.shape[1] == full.bitmap.shape[1]  # same width
    assert text.shape[1] == full.bitmap.shape[1]
    assert bars.shape[0] + text.shape[0] == full.bitmap.shape[0]
    assert (text < 200).any()  # the rendered text itself

def test_generate_barcode_split_returns_none_text_when_show_text_is_off():
    full, bars, text = generate_barcode_split("code128", "HELLO123", GenerateOptions(show_text=False), target_aspect=2.5)
    assert text is None
    assert bars.shape == full.bitmap.shape

def test_generate_barcode_split_returns_none_text_for_qr():
    full, bars, text = generate_barcode_split("qr", "https://example.com", GenerateOptions(show_text=True), target_aspect=1.0)
    assert text is None
    assert bars.shape == full.bitmap.shape
```

Add `generate_barcode_split` to the existing import line at the top of the file:

```python
from pipeline.generate import generate_barcode, generate_barcode_fit, generate_barcode_split, GenerateOptions, GenerateError
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/api && .venv/Scripts/python.exe -m pytest tests/test_generate.py -v -k split`
Expected: FAIL with `ImportError: cannot import name 'generate_barcode_split'`

- [ ] **Step 3: Refactor generate.py**

Replace the full contents of `services/api/pipeline/generate.py` with:

```python
from dataclasses import dataclass, replace
from io import BytesIO
from typing import Optional, Tuple
import numpy as np
import cv2
from PIL import Image
import barcode
from barcode.writer import ImageWriter, SVGWriter
import qrcode
import qrcode.image.svg

class GenerateError(ValueError):
    pass

@dataclass
class GenerateOptions:
    show_text: bool = True
    quiet_zone: float = 6.5      # mm, python-barcode units
    module_width: float = 0.2    # mm
    module_height: float = 15.0  # mm

@dataclass
class GenerateResult:
    bitmap: np.ndarray  # BGR uint8, white background
    svg: str

_LINEAR = {"ean13": "ean13", "ean8": "ean8", "upca": "upca",
           "code128": "code128", "code39": "code39"}
_RENDER_DPI = 450  # 1.5x python-barcode's ImageWriter default (300); a floor
                    # for callers that don't know the eventual placement size

def _pil_to_bgr(img: Image.Image) -> np.ndarray:
    rgb = np.array(img.convert("RGB"))
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

def _proportional_font_size(module_height: float) -> float:
    """python-barcode's ImageWriter defaults to a fixed 10pt font regardless
    of module_height, so text stays the same absolute size while bars grow
    or shrink -- looking oversized on short bars and undersized on tall ones.
    Scale it to the library's own default ratio (10pt at 15mm), clamped to a
    sane range so extreme module_height values (from generate_barcode_fit's
    aspect-matching) can't blow the text up past legible/non-overlapping
    bounds or shrink it to nothing.
    """
    return max(6.0, min(14.0, 10.0 * module_height / 15.0))

def _generate_linear(symb: str, value: str, opts: GenerateOptions, dpi: float = _RENDER_DPI) -> GenerateResult:
    try:
        cls = barcode.get_barcode_class(_LINEAR[symb])
    except Exception as e:
        raise GenerateError(str(e))
    # dpi (not module_width/height/quiet_zone) is how callers rescale pixel
    # resolution: it scales the whole rendered page uniformly, including
    # text, without touching any of the mm-based options that
    # _proportional_font_size and the aspect-fit solve above are tuned
    # against. Rescaling module_width/height/quiet_zone directly instead
    # would shift module_height into a different font-size clamping regime
    # than what the aspect-fit solve assumed, throwing off the exact aspect
    # ratio it just solved for (confirmed: this broke an aspect-ratio test).
    common = {"write_text": opts.show_text, "quiet_zone": opts.quiet_zone,
              "module_width": opts.module_width, "module_height": opts.module_height,
              "font_size": _proportional_font_size(opts.module_height),
              "dpi": dpi}
    try:
        png_buf = BytesIO()
        obj = cls(value, writer=ImageWriter())
        obj.write(png_buf, options=common)
        png_buf.seek(0)
        bitmap = _pil_to_bgr(Image.open(png_buf))
        svg_buf = BytesIO()
        obj_svg = cls(value, writer=SVGWriter())
        obj_svg.write(svg_buf, options=common)
        svg = svg_buf.getvalue().decode("utf-8")
    except Exception as e:
        raise GenerateError(f"{symb}: {e}")
    return GenerateResult(bitmap=bitmap, svg=svg)

def _generate_qr(value: str, opts: GenerateOptions) -> GenerateResult:
    try:
        qr = qrcode.QRCode(border=max(1, int(round(opts.quiet_zone / 2))))
        qr.add_data(value)
        qr.make(fit=True)
        pil = qr.make_image(fill_color="black", back_color="white")
        bitmap = _pil_to_bgr(pil.get_image() if hasattr(pil, "get_image") else pil)
        svg_img = qrcode.make(value, image_factory=qrcode.image.svg.SvgImage)
        svg_buf = BytesIO()
        svg_img.save(svg_buf)
        svg = svg_buf.getvalue().decode("utf-8")
    except Exception as e:
        raise GenerateError(f"qr: {e}")
    return GenerateResult(bitmap=bitmap, svg=svg)

def generate_barcode(symbology: str, value: str, opts: GenerateOptions) -> GenerateResult:
    symb = symbology.lower().replace("-", "")
    if symb == "qr":
        return _generate_qr(value, opts)
    if symb in _LINEAR:
        return _generate_linear(symb, value, opts)
    raise GenerateError(f"unsupported symbology: {symbology}")

def _solve_fitted_opts(symbology: str, value: str, opts: GenerateOptions,
                        target_aspect: float,
                        target_width_px: float = None) -> Tuple[GenerateOptions, float]:
    """Shared by generate_barcode_fit and generate_barcode_split: solves the
    module_height that matches target_aspect, and the dpi that sizes the
    bitmap to target_width_px (if given). Returns (fitted_opts, dpi) that,
    passed to _generate_linear, reproduce the exact bitmap either caller
    would use -- kept in one place so both callers stay in agreement about
    what "the bars, at the size that fits this placement" actually means.
    """
    symb = symbology.lower().replace("-", "")

    # module_height affects only pixel height (confirmed empirically: pixel
    # width tracks module_width/quiet_zone only), but with a fixed additive
    # offset (quiet-zone margins etc.), not pure proportionality within a
    # given font size. `_proportional_font_size` is itself piecewise in
    # module_height (linear in the middle, clamped constant at each end), so
    # height-vs-module_height is only *exactly* linear within one of those
    # three regimes at a time -- not across all of them. Probe within
    # whichever regime the answer actually lands in, so the two-point fit
    # stays exact rather than averaging across a clamp boundary.
    def solve(h1: float, h2: float) -> float:
        probe1 = generate_barcode(symbology, value, replace(opts, module_height=h1))
        probe2 = generate_barcode(symbology, value, replace(opts, module_height=h2))
        ph1, pw = probe1.bitmap.shape[:2]
        ph2, _ = probe2.bitmap.shape[:2]
        slope = (ph2 - ph1) / (h2 - h1)
        if slope == 0:
            return h1
        intercept = ph1 - slope * h1
        target_height_px = pw / target_aspect
        return max((target_height_px - intercept) / slope, 0.1)

    UNCLAMPED_LO, UNCLAMPED_HI = 9.0, 21.0  # where _proportional_font_size clamps
    module_height = solve(12.0, 18.0)  # first pass, probing the unclamped regime
    if module_height < UNCLAMPED_LO:
        module_height = solve(4.0, 7.0)  # re-probe entirely inside the clamped-low regime
    elif module_height > UNCLAMPED_HI:
        module_height = solve(25.0, 40.0)  # re-probe entirely inside the clamped-high regime

    fitted_opts = replace(opts, module_height=module_height)

    dpi = _RENDER_DPI
    if target_width_px and target_width_px > 0:
        probe = _generate_linear(symb, value, fitted_opts)
        bw = probe.bitmap.shape[1]
        oversample = 1.5  # headroom above the target so the eventual warp
                           # is a mild upscale at worst, never a big one
        scale = (target_width_px * oversample) / bw
        if abs(scale - 1.0) > 0.05:
            dpi = _RENDER_DPI * scale

    return fitted_opts, dpi

def generate_barcode_fit(symbology: str, value: str, opts: GenerateOptions,
                          target_aspect: float,
                          target_width_px: float = None) -> GenerateResult:
    """Like generate_barcode, but for linear symbologies solves for the
    module_height that makes the generated bitmap's own aspect ratio match
    target_aspect (the real shape of the quad it will be warped onto).

    Without this, the bitmap keeps whatever aspect ratio opts.module_width/
    module_height/quiet_zone happen to produce, and warp_onto's full-bleed
    stretch onto a differently-shaped quad squeezes bars unevenly (looks
    denser/thinner in one direction, sometimes visibly wavy). QR is skipped:
    it's inherently square, and its target quad's shape is already exactly
    reproduced by the perspective warp itself.

    target_width_px, if given (the actual on-photo placement's pixel width),
    additionally rescales the bitmap to roughly match that size with modest
    headroom. A fixed oversample factor can't work for every placement: too
    small relative to a large close-up blurs on the upscale, too large
    relative to a small placement forces an extreme downscale that aliases
    the bars' fine periodic pattern badly enough to break scanning entirely
    (confirmed empirically). Scaling relative to the actual target keeps the
    eventual warp a mild up- or down-scale either way.
    """
    symb = symbology.lower().replace("-", "")
    if symb not in _LINEAR or target_aspect <= 0:
        return generate_barcode(symbology, value, opts)
    fitted_opts, dpi = _solve_fitted_opts(symbology, value, opts, target_aspect, target_width_px)
    return _generate_linear(symb, value, fitted_opts, dpi)

def generate_barcode_split(symbology: str, value: str, opts: GenerateOptions,
                            target_aspect: float,
                            target_width_px: float = None
                            ) -> Tuple[GenerateResult, np.ndarray, Optional[np.ndarray]]:
    """Like generate_barcode_fit, but additionally splits the bitmap into its
    bars portion and its text portion, for placing each onto independent
    placement quads (so an existing printed caption next to the barcode,
    like "S/N:", can be left untouched while only the value text after it is
    replaced).

    Returns (full_result, bars_bitmap, text_bitmap). text_bitmap is None when
    there's no text to split out (QR, or show_text off) -- bars_bitmap is
    then the whole bitmap, same as generate_barcode_fit's result.
    """
    symb = symbology.lower().replace("-", "")
    if symb not in _LINEAR or target_aspect <= 0 or not opts.show_text:
        full = generate_barcode_fit(symbology, value, opts, target_aspect, target_width_px)
        return full, full.bitmap, None

    fitted_opts, dpi = _solve_fitted_opts(symbology, value, opts, target_aspect, target_width_px)
    full = _generate_linear(symb, value, fitted_opts, dpi)
    # generate the SAME bars at the SAME module_height/dpi but without text,
    # to find exactly how many of the full bitmap's rows are bars (the rest,
    # at the bottom, is the text row python-barcode adds beneath them)
    no_text = _generate_linear(symb, value, replace(fitted_opts, show_text=False), dpi)
    bars_h = no_text.bitmap.shape[0]
    bars_bitmap = full.bitmap[:bars_h]
    text_bitmap = full.bitmap[bars_h:]
    return full, bars_bitmap, text_bitmap
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/api && .venv/Scripts/python.exe -m pytest tests/test_generate.py -v`
Expected: all PASS (including the 3 new ones and all pre-existing ones -- `generate_barcode_fit`'s behavior is unchanged, just refactored through `_solve_fitted_opts`)

- [ ] **Step 5: Run the full backend suite**

Run: `cd services/api && .venv/Scripts/python.exe -m pytest tests -q`
Expected: all PASS (this only touches generate.py; nothing else imports its private internals)

- [ ] **Step 6: Commit**

```bash
git add services/api/pipeline/generate.py services/api/tests/test_generate.py
git commit -m "feat(api): add generate_barcode_split to separate bars from value text"
```

---

### Task 2: orchestrator.py -- independent bars and text placement

**Files:**
- Modify: `services/api/pipeline/orchestrator.py`
- Test: `services/api/tests/test_orchestrator.py`

- [ ] **Step 1: Write the failing test**

Add to `services/api/tests/test_orchestrator.py`:

```python
def test_replace_with_text_corners_places_bars_and_text_independently():
    scene = np.full((400, 900, 3), 220, np.uint8)
    bars_corners = np.float32([[100, 100], [500, 100], [500, 180], [100, 180]])
    text_corners = np.float32([[100, 190], [500, 190], [500, 230], [100, 230]])
    req = ReplaceRequest(
        image=scene, corners=bars_corners, symbology="code128",
        value="SPLITME1", options=GenerateOptions(show_text=True),
        blend_mode="normal", text_corners=text_corners,
    )
    res = replace_barcode(req)
    assert res.result.shape == scene.shape

    bars_mask = np.zeros(scene.shape[:2], np.uint8)
    cv2.fillPoly(bars_mask, [bars_corners.astype(np.int32)], 255)
    text_mask = np.zeros(scene.shape[:2], np.uint8)
    cv2.fillPoly(text_mask, [text_corners.astype(np.int32)], 255)
    # both regions changed from the original scene
    assert np.abs(res.result[bars_mask > 0].astype(int) - scene[bars_mask > 0].astype(int)).mean() > 5
    assert np.abs(res.result[text_mask > 0].astype(int) - scene[text_mask > 0].astype(int)).mean() > 5
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && .venv/Scripts/python.exe -m pytest tests/test_orchestrator.py -v -k text_corners`
Expected: FAIL with `TypeError: __init__() got an unexpected keyword argument 'text_corners'`

- [ ] **Step 3: Refactor orchestrator.py**

Replace the full contents of `services/api/pipeline/orchestrator.py` with:

```python
from dataclasses import dataclass, field
from typing import Dict, Optional
import numpy as np
import cv2
from pipeline.generate import generate_barcode_fit, generate_barcode_split, GenerateOptions, GenerateResult
from pipeline.warp import warp_onto, quad_aspect_ratio, quad_dimensions
from pipeline.tone import match_tone
from pipeline.blend import seamless_blend, local_tone_correct

@dataclass
class ReplaceRequest:
    image: np.ndarray          # BGR
    corners: np.ndarray        # (4,2) tl,tr,br,bl -- the barcode's bars
    symbology: str
    value: str
    options: GenerateOptions = field(default_factory=GenerateOptions)
    blend_mode: str = "normal"
    text_corners: Optional[np.ndarray] = None  # (4,2), if the value text is
                                                # placed independently of the bars

@dataclass
class ReplaceResult:
    result: np.ndarray
    svg: str
    layers: Dict[str, np.ndarray]

def _place_region(bitmap: np.ndarray, corners: np.ndarray, dst_image: np.ndarray,
                   canvas_hw, blend_mode: str = "normal"):
    """Warp bitmap onto corners, tone-match and locally correct it against
    dst_image, and composite it in. Returns (composited_image, alpha_mask,
    corrected_layer) -- corrected_layer is what actually got composited,
    used to build the new_barcode preview layer.
    """
    warped, alpha = warp_onto(bitmap, corners, canvas_hw)
    ys, xs = np.where(alpha > 0)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    target_region = dst_image[y0:y1 + 1, x0:x1 + 1]
    toned = match_tone(warped, alpha, target_region)
    composited = seamless_blend(toned, dst_image, alpha, mode=blend_mode)
    corrected = local_tone_correct(toned, dst_image, alpha)
    return composited, alpha, corrected

def replace_barcode(req: ReplaceRequest) -> ReplaceResult:
    h, w = req.image.shape[:2]
    target_aspect = quad_aspect_ratio(req.corners)
    target_width_px, _ = quad_dimensions(req.corners)

    if req.text_corners is not None:
        gen, bars_bitmap, text_bitmap = generate_barcode_split(
            req.symbology, req.value, req.options, target_aspect, target_width_px=target_width_px)
    else:
        gen = generate_barcode_fit(req.symbology, req.value, req.options,
                                    target_aspect, target_width_px=target_width_px)
        bars_bitmap, text_bitmap = gen.bitmap, None

    result, alpha, corrected = _place_region(bars_bitmap, req.corners, req.image, (h, w), req.blend_mode)
    new_barcode_layer = np.zeros_like(req.image)
    new_barcode_layer[alpha > 0] = corrected[alpha > 0]

    if text_bitmap is not None and req.text_corners is not None:
        result, text_alpha, text_corrected = _place_region(
            text_bitmap, req.text_corners, result, (h, w), req.blend_mode)
        new_barcode_layer[text_alpha > 0] = text_corrected[text_alpha > 0]
        alpha = cv2.bitwise_or(alpha, text_alpha)

    return ReplaceResult(
        result=result,
        svg=gen.svg,
        layers={
            "original": req.image.copy(),
            "new_barcode": new_barcode_layer,
            "mask": cv2.cvtColor(alpha, cv2.COLOR_GRAY2BGR),
        },
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/api && .venv/Scripts/python.exe -m pytest tests/test_orchestrator.py -v`
Expected: all PASS, including every pre-existing test (the no-`text_corners` path is unchanged behavior, just refactored through `_place_region`)

- [ ] **Step 5: Run the full backend suite**

Run: `cd services/api && .venv/Scripts/python.exe -m pytest tests -q`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add services/api/pipeline/orchestrator.py services/api/tests/test_orchestrator.py
git commit -m "feat(api): support independent bars and text placement quads"
```

---

### Task 3: API schema + route -- thread text_corners through

**Files:**
- Modify: `services/api/schemas.py`
- Modify: `services/api/routes.py`
- Test: `services/api/tests/test_routes.py`

- [ ] **Step 1: Write the failing test**

Add to `services/api/tests/test_routes.py`:

```python
def test_replace_endpoint_places_bars_and_text_independently():
    scene = np.full((400, 900, 3), 220, np.uint8)
    bars_corners = [[100, 100], [500, 100], [500, 180], [100, 180]]
    text_corners = [[100, 190], [500, 190], [500, 230], [100, 230]]
    payload = {
        "image": ndarray_to_b64(scene),
        "corners": bars_corners,
        "symbology": "code128",
        "value": "SPLITME1",
        "options": {"show_text": True},
        "blend_mode": "normal",
        "text_corners": text_corners,
    }
    r = client.post("/api/replace", json=payload)
    assert r.status_code == 200
    result = b64_to_ndarray(r.json()["result"])
    bars_mask = np.zeros(scene.shape[:2], np.uint8)
    cv2.fillPoly(bars_mask, [np.array(bars_corners, dtype=np.int32)], 255)
    text_mask = np.zeros(scene.shape[:2], np.uint8)
    cv2.fillPoly(text_mask, [np.array(text_corners, dtype=np.int32)], 255)
    # both regions changed from the original scene -- proves text_corners
    # actually reached the orchestrator and got its own placement, not just
    # that the request was accepted
    assert np.abs(result[bars_mask > 0].astype(int) - scene[bars_mask > 0].astype(int)).mean() > 5
    assert np.abs(result[text_mask > 0].astype(int) - scene[text_mask > 0].astype(int)).mean() > 5

def test_replace_endpoint_rejects_out_of_bounds_text_corners():
    scene, corners, meta = make_scene(warp=False)
    payload = {
        "image": ndarray_to_b64(scene),
        "corners": corners.tolist(),
        "symbology": "code128", "value": "NEWVALUE",
        "options": {"show_text": True}, "blend_mode": "normal",
        "text_corners": [[10, 10], [20, 10], [20, 20000], [10, 20]],
    }
    r = client.post("/api/replace", json=payload)
    assert r.status_code == 422
```

Add `numpy` and `cv2` imports, and `b64_to_ndarray`, to the top of `services/api/tests/test_routes.py` (needed for the new test's pixel-level assertions):

```python
import numpy as np
import cv2
from fastapi.testclient import TestClient
from main import app
from imgio import ndarray_to_b64, b64_to_ndarray
from tests.fixtures import make_scene
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/api && .venv/Scripts/python.exe -m pytest tests/test_routes.py -v -k "independently or text_corners"`
Expected: FAIL on both. Today, `text_corners` isn't a declared field on `ReplaceRequestIn`, so pydantic silently drops it -- the request still succeeds (200) but only the bars region changes, so `test_replace_endpoint_places_bars_and_text_independently`'s text-region assertion fails; `test_replace_endpoint_rejects_out_of_bounds_text_corners` fails because the out-of-bounds value is silently ignored too (200, not 422).

- [ ] **Step 3: Update schemas.py**

In `services/api/schemas.py`, replace the `ReplaceRequestIn` class with:

```python
class ReplaceRequestIn(BaseModel):
    image: str
    corners: List[List[float]] = Field(..., min_length=4, max_length=4)
    symbology: str
    value: str
    options: OptionsIn = OptionsIn()
    blend_mode: str = "normal"
    text_corners: Optional[List[List[float]]] = Field(None, min_length=4, max_length=4)
```

- [ ] **Step 4: Update routes.py**

Replace the full contents of `services/api/routes.py` with:

```python
import numpy as np
from fastapi import APIRouter, HTTPException
from imgio import b64_to_ndarray, ndarray_to_b64
from schemas import (DetectRequest, DetectResponse, DetectionOut,
                     ReplaceRequestIn, ReplaceResponse)
from pipeline.detect import detect_barcodes
from pipeline.generate import GenerateOptions, GenerateError
from pipeline.orchestrator import replace_barcode, ReplaceRequest

router = APIRouter(prefix="/api")

@router.post("/detect", response_model=DetectResponse)
def detect(req: DetectRequest):
    try:
        img = b64_to_ndarray(req.image)
    except ValueError:
        raise HTTPException(status_code=415, detail="unreadable image")
    dets = detect_barcodes(img)
    return DetectResponse(detections=[
        DetectionOut(corners=d.corners.tolist(), type=d.type, value=d.value,
                     confidence=d.confidence, bbox=list(d.bbox))
        for d in dets
    ])

def _validate_corners_in_bounds(corners: np.ndarray, w: int, h: int, label: str):
    if (corners[:, 0].min() < 0 or corners[:, 1].min() < 0 or
            corners[:, 0].max() > w or corners[:, 1].max() > h):
        raise HTTPException(status_code=422, detail=f"{label} out of bounds")

@router.post("/replace", response_model=ReplaceResponse)
def replace(req: ReplaceRequestIn):
    try:
        img = b64_to_ndarray(req.image)
    except ValueError:
        raise HTTPException(status_code=415, detail="unreadable image")
    h, w = img.shape[:2]
    corners = np.float32(req.corners)
    _validate_corners_in_bounds(corners, w, h, "corners")
    text_corners = None
    if req.text_corners is not None:
        text_corners = np.float32(req.text_corners)
        _validate_corners_in_bounds(text_corners, w, h, "text_corners")
    opts = GenerateOptions(**req.options.model_dump())
    try:
        res = replace_barcode(ReplaceRequest(
            image=img, corners=corners, symbology=req.symbology,
            value=req.value, options=opts, blend_mode=req.blend_mode,
            text_corners=text_corners,
        ))
    except GenerateError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return ReplaceResponse(
        result=ndarray_to_b64(res.result),
        svg=res.svg,
        layers={k: ndarray_to_b64(v) for k, v in res.layers.items()},
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd services/api && .venv/Scripts/python.exe -m pytest tests/test_routes.py -v`
Expected: all PASS

- [ ] **Step 6: Run the full backend suite**

Run: `cd services/api && .venv/Scripts/python.exe -m pytest tests -q`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add services/api/schemas.py services/api/routes.py services/api/tests/test_routes.py
git commit -m "feat(api): accept optional text_corners on the replace endpoint"
```

---

### Task 4: transform.ts -- offsetTextQuad

**Files:**
- Modify: `apps/web/lib/transform.ts`
- Test: `apps/web/lib/transform.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/lib/transform.test.ts`:

```typescript
import { quadCenter, scaleQuad, rotateQuad, offsetTextQuad } from "./transform";
```

(replacing the existing `import { quadCenter, scaleQuad, rotateQuad } from "./transform";` line)

```typescript
describe("offsetTextQuad", () => {
  it("starts at the bars quad's bottom edge, matching its width", () => {
    const bars: Corner[] = [[0, 0], [200, 0], [200, 50], [0, 50]];
    const text = offsetTextQuad(bars);
    expect(text[0]).toEqual([0, 50]);   // tl = bars' bl
    expect(text[1]).toEqual([200, 50]); // tr = bars' br
  });

  it("extends downward by 40% of the bars quad's height", () => {
    const bars: Corner[] = [[0, 0], [200, 0], [200, 50], [0, 50]];
    const text = offsetTextQuad(bars);
    expect(text[2]).toEqual([200, 70]); // br: 50 + 0.4*(50-0)
    expect(text[3]).toEqual([0, 70]);   // bl
  });

  it("preserves rotation/skew: the text quad's left edge stays parallel to the bars quad's", () => {
    const bars: Corner[] = [[10, 10], [110, 20], [105, 60], [5, 50]];
    const text = offsetTextQuad(bars);
    const barsLeftDir = [bars[3][0] - bars[0][0], bars[3][1] - bars[0][1]];
    const textLeftDir = [text[3][0] - text[0][0], text[3][1] - text[0][1]];
    const barsLeftLen = Math.hypot(barsLeftDir[0], barsLeftDir[1]);
    const textLeftLen = Math.hypot(textLeftDir[0], textLeftDir[1]);
    expect(textLeftDir[0] / textLeftLen).toBeCloseTo(barsLeftDir[0] / barsLeftLen, 5);
    expect(textLeftDir[1] / textLeftLen).toBeCloseTo(barsLeftDir[1] / barsLeftLen, 5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/transform.test.ts`
Expected: FAIL with `offsetTextQuad is not a function` / import error

- [ ] **Step 3: Implement offsetTextQuad**

Add to the end of `apps/web/lib/transform.ts`:

```typescript
export function offsetTextQuad(barsCorners: Corner[]): Corner[] {
  const [tl, tr, br, bl] = barsCorners;
  const leftEdge: Corner = [bl[0] - tl[0], bl[1] - tl[1]];
  const rightEdge: Corner = [br[0] - tr[0], br[1] - tr[1]];
  const HEIGHT_FRACTION = 0.4;
  const newBl: Corner = [bl[0] + leftEdge[0] * HEIGHT_FRACTION, bl[1] + leftEdge[1] * HEIGHT_FRACTION];
  const newBr: Corner = [br[0] + rightEdge[0] * HEIGHT_FRACTION, br[1] + rightEdge[1] * HEIGHT_FRACTION];
  return [bl, br, newBr, newBl];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/transform.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/transform.ts apps/web/lib/transform.test.ts
git commit -m "feat(web): add offsetTextQuad for the text placement quad's default position"
```

---

### Task 5: types.ts -- textCorners in EditorSnapshot

**Files:**
- Modify: `apps/web/lib/types.ts`

- [ ] **Step 1: Update EditorSnapshot**

In `apps/web/lib/types.ts`, replace the `EditorSnapshot` interface with:

```typescript
export interface EditorSnapshot {
  corners: Corner[] | null;
  textCorners: Corner[] | null;
  symbology: string;
  value: string;
  options: BarcodeOptions;
  blendMode: string;
  result: ReplaceResponse | null;
  retouchStrokes: Stroke[];
  resultMaskStrokes: Stroke[];
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/types.ts
git commit -m "feat(web): add textCorners to EditorSnapshot"
```

(No test to run here in isolation -- `store.ts`, which this type feeds, is covered in Task 6. This will not type-check cleanly until Task 6 lands; that's expected for a type-only intermediate step.)

---

### Task 6: store.ts -- text quad state and actions

**Files:**
- Modify: `apps/web/lib/store.ts`
- Modify: `apps/web/lib/store.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/web/lib/store.test.ts`, update the `reset()` helper to include the two new fields:

```typescript
function reset() {
  useEditor.setState({
    image: null,
    corners: null,
    textCorners: null,
    separateTextPlacement: false,
    detectedCorners: null,
    adjusting: true,
    retouching: false,
    activeLayer: "retouch",
    tool: "brush",
    brushSize: 12,
    brushColor: "#000000",
    brushOpacity: 1,
    symbology: "code128",
    value: "",
    options: { show_text: true, quiet_zone: 6.5, module_width: 0.2, module_height: 15 },
    blendMode: "normal",
    result: null,
    retouchStrokes: [],
    resultMaskStrokes: [],
    history: [],
    historyIndex: -1,
  });
}
```

Add a new describe block anywhere after the existing ones:

```typescript
describe("separate text placement", () => {
  beforeEach(reset);

  it("turning it on with no existing text quad auto-offsets below the bars quad", () => {
    useEditor.getState().setCorners([[0, 0], [200, 0], [200, 50], [0, 50]]);
    useEditor.getState().setSeparateTextPlacement(true);
    expect(useEditor.getState().separateTextPlacement).toBe(true);
    expect(useEditor.getState().textCorners).toEqual([[0, 50], [200, 50], [200, 70], [0, 70]]);
  });

  it("turning it on again does not overwrite an already-adjusted text quad", () => {
    useEditor.getState().setCorners([[0, 0], [200, 0], [200, 50], [0, 50]]);
    useEditor.getState().setSeparateTextPlacement(true);
    useEditor.getState().setTextCorners([[10, 60], [210, 60], [210, 80], [10, 80]]);
    useEditor.getState().setSeparateTextPlacement(false);
    useEditor.getState().setSeparateTextPlacement(true);
    expect(useEditor.getState().textCorners).toEqual([[10, 60], [210, 60], [210, 80], [10, 80]]);
  });

  it("moveTextQuad translates all text corners by the same delta", () => {
    useEditor.getState().setTextCorners([[10, 10], [30, 10], [30, 30], [10, 30]]);
    useEditor.getState().moveTextQuad([5, -3]);
    expect(useEditor.getState().textCorners).toEqual([[15, 7], [35, 7], [35, 27], [15, 27]]);
  });

  it("setImage resets text placement state", () => {
    useEditor.getState().setCorners([[0, 0], [200, 0], [200, 50], [0, 50]]);
    useEditor.getState().setSeparateTextPlacement(true);
    useEditor.getState().setImage("data:image/png;base64,zzz");
    expect(useEditor.getState().textCorners).toBeNull();
    expect(useEditor.getState().separateTextPlacement).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/store.test.ts`
Expected: FAIL -- `setSeparateTextPlacement`/`setTextCorners`/`moveTextQuad` are not functions

- [ ] **Step 3: Implement store.ts changes**

Replace the full contents of `apps/web/lib/store.ts` with:

```typescript
import { create } from "zustand";
import type { Corner, BarcodeOptions, ReplaceResponse, EditorSnapshot, ActiveLayer, Stroke } from "./types";
import { offsetTextQuad } from "./transform";

interface EditorState {
  image: string | null;
  corners: Corner[] | null;
  textCorners: Corner[] | null;
  separateTextPlacement: boolean;
  detectedCorners: Corner[] | null;
  adjusting: boolean;
  retouching: boolean;
  activeLayer: ActiveLayer;
  tool: "brush" | "eraser";
  brushSize: number;
  brushColor: string;
  brushOpacity: number;
  symbology: string;
  value: string;
  options: BarcodeOptions;
  blendMode: string;
  result: ReplaceResponse | null;
  retouchStrokes: Stroke[];
  resultMaskStrokes: Stroke[];
  history: EditorSnapshot[];
  historyIndex: number;
  setImage: (img: string | null) => void;
  setCorners: (c: Corner[] | null) => void;
  updateCorner: (i: number, c: Corner) => void;
  setTextCorners: (c: Corner[] | null) => void;
  updateTextCorner: (i: number, c: Corner) => void;
  moveTextQuad: (delta: Corner) => void;
  setSeparateTextPlacement: (v: boolean) => void;
  setDetectedCorners: (c: Corner[] | null) => void;
  setAdjusting: (v: boolean) => void;
  setRetouching: (v: boolean) => void;
  setActiveLayer: (l: ActiveLayer) => void;
  setTool: (t: "brush" | "eraser") => void;
  setBrushSize: (n: number) => void;
  setBrushColor: (c: string) => void;
  setBrushOpacity: (n: number) => void;
  addStroke: (stroke: Stroke) => void;
  moveQuad: (delta: Corner) => void;
  resetCorners: () => void;
  setField: <K extends keyof EditorState>(k: K, v: EditorState[K]) => void;
  setOption: <K extends keyof BarcodeOptions>(k: K, v: BarcodeOptions[K]) => void;
  setResult: (r: ReplaceResponse | null) => void;
  commit: () => void;
  undo: () => void;
  redo: () => void;
}

export const useEditor = create<EditorState>((set, get) => ({
  image: null,
  corners: null,
  textCorners: null,
  separateTextPlacement: false,
  detectedCorners: null,
  adjusting: true,
  retouching: false,
  activeLayer: "retouch",
  tool: "brush",
  brushSize: 12,
  brushColor: "#000000",
  brushOpacity: 1,
  symbology: "code128",
  value: "",
  options: { show_text: true, quiet_zone: 6.5, module_width: 0.2, module_height: 15 },
  blendMode: "normal",
  result: null,
  retouchStrokes: [],
  resultMaskStrokes: [],
  history: [],
  historyIndex: -1,
  setImage: (img) => set({
    image: img, corners: null, result: null,
    textCorners: null, separateTextPlacement: false,
    detectedCorners: null, adjusting: true, retouching: false,
    retouchStrokes: [], resultMaskStrokes: [],
    history: [], historyIndex: -1,
  }),
  setCorners: (c) => set({ corners: c }),
  updateCorner: (i, c) => set((s) => {
    if (!s.corners) return s;
    const next = s.corners.slice();
    next[i] = c;
    return { corners: next };
  }),
  setTextCorners: (c) => set({ textCorners: c }),
  updateTextCorner: (i, c) => set((s) => {
    if (!s.textCorners) return s;
    const next = s.textCorners.slice();
    next[i] = c;
    return { textCorners: next };
  }),
  moveTextQuad: (delta) => set((s) => {
    if (!s.textCorners) return s;
    const [dx, dy] = delta;
    return { textCorners: s.textCorners.map(([x, y]) => [x + dx, y + dy] as Corner) };
  }),
  setSeparateTextPlacement: (v) => set((s) => {
    if (v && !s.textCorners && s.corners) {
      return { separateTextPlacement: true, textCorners: offsetTextQuad(s.corners) };
    }
    return { separateTextPlacement: v };
  }),
  setDetectedCorners: (c) => set({ detectedCorners: c }),
  setAdjusting: (v) => set(v ? { adjusting: true, retouching: false } : { adjusting: false }),
  setRetouching: (v) => set(v ? { retouching: true, adjusting: false } : { retouching: false }),
  setActiveLayer: (l) => set({ activeLayer: l }),
  setTool: (t) => set({ tool: t }),
  setBrushSize: (n) => set({ brushSize: n }),
  setBrushColor: (c) => set({ brushColor: c }),
  setBrushOpacity: (n) => set({ brushOpacity: n }),
  addStroke: (stroke) => {
    set((s) => {
      if (stroke.tool === "brush") {
        return { retouchStrokes: [...s.retouchStrokes, stroke] };
      }
      return s.activeLayer === "retouch"
        ? { retouchStrokes: [...s.retouchStrokes, stroke] }
        : { resultMaskStrokes: [...s.resultMaskStrokes, stroke] };
    });
    get().commit();
  },
  moveQuad: (delta) => set((s) => {
    if (!s.corners) return s;
    const [dx, dy] = delta;
    return { corners: s.corners.map(([x, y]) => [x + dx, y + dy] as Corner) };
  }),
  resetCorners: () => {
    set((s) => (s.detectedCorners ? { corners: s.detectedCorners } : s));
    get().commit();
  },
  setField: (k, v) => set({ [k]: v } as Partial<EditorState>),
  setOption: (k, v) => set((s) => ({ options: { ...s.options, [k]: v } })),
  setResult: (r) => set({ result: r }),
  commit: () => set((s) => {
    const snapshot: EditorSnapshot = {
      corners: s.corners, textCorners: s.textCorners, symbology: s.symbology, value: s.value,
      options: s.options, blendMode: s.blendMode, result: s.result,
      retouchStrokes: s.retouchStrokes, resultMaskStrokes: s.resultMaskStrokes,
    };
    const truncated = s.history.slice(0, s.historyIndex + 1);
    const history = [...truncated, snapshot];
    return { history, historyIndex: history.length - 1 };
  }),
  undo: () => set((s) => {
    if (s.historyIndex <= 0) return s;
    const idx = s.historyIndex - 1;
    return { historyIndex: idx, ...s.history[idx] };
  }),
  redo: () => set((s) => {
    if (s.historyIndex >= s.history.length - 1) return s;
    const idx = s.historyIndex + 1;
    return { historyIndex: idx, ...s.history[idx] };
  }),
}));

export const selectCanUndo = (s: EditorState) => s.historyIndex > 0;
export const selectCanRedo = (s: EditorState) => s.historyIndex < s.history.length - 1;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/store.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/store.ts apps/web/lib/store.test.ts
git commit -m "feat(web): add text quad state and actions to the editor store"
```

---

### Task 7: api.ts -- thread text_corners through the replace call

**Files:**
- Modify: `apps/web/lib/api.ts`

- [ ] **Step 1: Update the replace() signature**

In `apps/web/lib/api.ts`, replace the `replace` function with:

```typescript
export async function replace(params: {
  image: string;
  corners: number[][];
  symbology: string;
  value: string;
  options: BarcodeOptions;
  blend_mode: string;
  text_corners?: number[][];
}): Promise<ReplaceResponse> {
  const r = await fetch(`${BASE}/api/replace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    throw new Error(detail.detail ?? `replace failed: ${r.status}`);
  }
  return r.json();
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/api.ts
git commit -m "feat(web): accept optional text_corners in the replace API client"
```

(No dedicated test file exists for `api.ts` today -- consistent with the existing project pattern of not unit-testing this thin fetch wrapper.)

---

### Task 8: EditorCanvas.tsx -- second transform box for the text quad

**Files:**
- Modify: `apps/web/components/EditorCanvas.tsx`

- [ ] **Step 1: Replace the full contents of EditorCanvas.tsx**

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Image as KImage, Line, Circle, Rect } from "react-konva";
import type Konva from "konva";
import { useEditor } from "@/lib/store";
import { quadCenter, scaleQuad, rotateQuad } from "@/lib/transform";
import type { Corner } from "@/lib/types";

interface DragStart {
  corners: Corner[];
  center: Corner;
  startValue: number; // distance-from-center for scale, angle-from-center for rotate
  referenceDist: number; // scale only: average corner-to-center distance, used to normalize sensitivity
}

interface QuadTransformBoxProps {
  corners: Corner[];
  scale: number;
  color: string;
  onUpdateCorner: (i: number, c: Corner) => void;
  onMoveQuad: (delta: Corner) => void;
  onSetCorners: (c: Corner[]) => void;
  onCommit: () => void;
}

function QuadTransformBox({ corners, scale, color, onUpdateCorner, onMoveQuad, onSetCorners, onCommit }: QuadTransformBoxProps) {
  const dragStart = useRef<DragStart | null>(null);
  const flat = corners.flatMap((c) => [c[0] * scale, c[1] * scale]);

  function handleQuadDragMove(e: Konva.KonvaEventObject<DragEvent>) {
    const node = e.target;
    const dx = node.x() / scale;
    const dy = node.y() / scale;
    node.position({ x: 0, y: 0 });
    onMoveQuad([dx, dy]);
  }

  function handleScaleDragStart(e: Konva.KonvaEventObject<DragEvent>) {
    const center = quadCenter(corners);
    const pos = e.target.getAbsolutePosition();
    const startValue = Math.hypot(pos.x - center[0] * scale, pos.y - center[1] * scale);
    // Average corner-to-center distance, not the handle's own (possibly small)
    // starting distance -- an edge-midpoint handle can sit close to center on a
    // wide/short quad, and dividing by that tiny distance turned small mouse
    // movements into huge scale swings. This is a stable denominator instead.
    const referenceDist = corners.reduce(
      (sum, c) => sum + Math.hypot(c[0] - center[0], c[1] - center[1]), 0
    ) / corners.length || 1;
    dragStart.current = { corners, center, startValue, referenceDist };
  }

  function handleScaleDragMove(e: Konva.KonvaEventObject<DragEvent>) {
    if (!dragStart.current) return;
    const { corners: startCorners, center, startValue, referenceDist } = dragStart.current;
    const pos = e.target.getAbsolutePosition();
    const currentDist = Math.hypot(pos.x - center[0] * scale, pos.y - center[1] * scale);
    const deltaImageSpace = (currentDist - startValue) / scale;
    const factor = Math.max(0.05, 1 + deltaImageSpace / referenceDist);
    onSetCorners(scaleQuad(startCorners, factor));
  }

  function handleTransformDragEnd() {
    dragStart.current = null;
    onCommit();
  }

  function handleRotateDragStart(e: Konva.KonvaEventObject<DragEvent>) {
    const center = quadCenter(corners);
    const pos = e.target.getAbsolutePosition();
    const startValue = Math.atan2(pos.y - center[1] * scale, pos.x - center[0] * scale);
    dragStart.current = { corners, center, startValue, referenceDist: 1 }; // unused for rotate
  }

  function handleRotateDragMove(e: Konva.KonvaEventObject<DragEvent>) {
    if (!dragStart.current) return;
    const { corners: startCorners, center, startValue: startAngle } = dragStart.current;
    const pos = e.target.getAbsolutePosition();
    const currentAngle = Math.atan2(pos.y - center[1] * scale, pos.x - center[0] * scale);
    onSetCorners(rotateQuad(startCorners, currentAngle - startAngle));
  }

  const center = quadCenter(corners);
  const edgeMidpoints: Corner[] = [
    [(corners[0][0] + corners[1][0]) / 2, (corners[0][1] + corners[1][1]) / 2],
    [(corners[1][0] + corners[2][0]) / 2, (corners[1][1] + corners[2][1]) / 2],
    [(corners[2][0] + corners[3][0]) / 2, (corners[2][1] + corners[3][1]) / 2],
    [(corners[3][0] + corners[0][0]) / 2, (corners[3][1] + corners[0][1]) / 2],
  ];
  const rotateHandlePos: Corner = [
    edgeMidpoints[0][0] + (edgeMidpoints[0][0] - center[0]) * 0.4,
    edgeMidpoints[0][1] + (edgeMidpoints[0][1] - center[1]) * 0.4,
  ];

  return (
    <>
      <Line
        points={[...flat, flat[0], flat[1]]}
        stroke={color}
        strokeWidth={2}
        closed
        fill="rgba(34,211,238,0.08)"
        draggable
        onDragMove={handleQuadDragMove}
        onDragEnd={() => onCommit()}
      />
      {corners.map((c, i) => (
        <Circle key={i} x={c[0] * scale} y={c[1] * scale} radius={7}
                fill={color} draggable
                onDragMove={(e) => onUpdateCorner(i, [e.target.x() / scale, e.target.y() / scale])}
                onDragEnd={() => onCommit()} />
      ))}
      {edgeMidpoints.map((m, i) => (
        <Rect key={`scale-${i}`} x={m[0] * scale - 5} y={m[1] * scale - 5} width={10} height={10}
              fill="#f97316" draggable
              onDragStart={handleScaleDragStart}
              onDragMove={handleScaleDragMove}
              onDragEnd={handleTransformDragEnd} />
      ))}
      <Circle x={rotateHandlePos[0] * scale} y={rotateHandlePos[1] * scale} radius={6}
              fill="#f97316" draggable
              onDragStart={handleRotateDragStart}
              onDragMove={handleRotateDragMove}
              onDragEnd={handleTransformDragEnd} />
    </>
  );
}

export function EditorCanvas() {
  const {
    image, corners, adjusting, updateCorner, moveQuad, setCorners, commit, result,
    textCorners, separateTextPlacement, updateTextCorner, moveTextQuad, setTextCorners,
  } = useEditor();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const shown = adjusting ? image : (result?.result ?? image);

  useEffect(() => {
    if (!shown) { setImg(null); return; }
    const i = new window.Image();
    i.src = shown;
    i.onload = () => setImg(i);
  }, [shown]);

  if (!img) return <div className="flex h-full items-center justify-center text-muted-foreground">Upload an image to begin</div>;

  const scale = Math.min(900 / img.width, 600 / img.height, 1);
  const w = img.width * scale, h = img.height * scale;

  return (
    <Stage width={w} height={h} className="border rounded">
      <Layer>
        <KImage image={img} width={w} height={h} />
        {corners && adjusting && (
          <QuadTransformBox corners={corners} scale={scale} color="#22d3ee"
            onUpdateCorner={updateCorner} onMoveQuad={moveQuad} onSetCorners={setCorners} onCommit={commit} />
        )}
        {textCorners && separateTextPlacement && adjusting && (
          <QuadTransformBox corners={textCorners} scale={scale} color="#a855f7"
            onUpdateCorner={updateTextCorner} onMoveQuad={moveTextQuad} onSetCorners={setTextCorners} onCommit={commit} />
        )}
      </Layer>
    </Stage>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors from `components/EditorCanvas.tsx` (ignore any pre-existing unrelated errors under `.next/dev/types/` -- those are stale generated files, not source errors)

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/EditorCanvas.tsx
git commit -m "feat(web): extract QuadTransformBox, render a second box for the text quad"
```

(No automated test for this file -- react-konva's canvas rendering isn't exercisable in jsdom, consistent with the existing project pattern. Manual verification happens in Task 12.)

---

### Task 9: BarcodeSettings.tsx -- "Separate text placement" toggle

**Files:**
- Modify: `apps/web/components/BarcodeSettings.tsx`
- Test: `apps/web/components/BarcodeSettings.test.tsx`

- [ ] **Step 1: Write the failing tests**

Replace the `reset()` helper in `apps/web/components/BarcodeSettings.test.tsx` with:

```typescript
function reset() {
  useEditor.setState({
    symbology: "code128", value: "",
    options: { show_text: true, quiet_zone: 6.5, module_width: 0.2, module_height: 15 },
    corners: [[0, 0], [200, 0], [200, 50], [0, 50]],
    textCorners: null,
    separateTextPlacement: false,
    history: [], historyIndex: -1,
  });
}
```

Add to the `describe("BarcodeSettings history commits", ...)` block:

```typescript
  it("shows the separate text placement toggle only when show_text is on and symbology is not qr", () => {
    render(<BarcodeSettings />);
    expect(screen.getByText(/separate text placement/i)).toBeInTheDocument();

    useEditor.getState().setOption("show_text", false);
    expect(screen.queryByText(/separate text placement/i)).toBeNull();
  });

  it("commits when separate text placement is toggled", () => {
    render(<BarcodeSettings />);
    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[1]); // [0] is "Show text", [1] is "Separate text placement"
    expect(useEditor.getState().history).toHaveLength(1);
    expect(useEditor.getState().separateTextPlacement).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run components/BarcodeSettings.test.tsx`
Expected: FAIL -- `getByText(/separate text placement/i)` finds nothing

- [ ] **Step 3: Update BarcodeSettings.tsx**

Replace the full contents of `apps/web/components/BarcodeSettings.tsx` with:

```tsx
"use client";
import { useEditor } from "@/lib/store";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const SYMBOLOGIES = ["ean13", "ean8", "upca", "code128", "code39", "qr"];

export function BarcodeSettings() {
  const {
    symbology, value, options, separateTextPlacement,
    setField, setOption, setSeparateTextPlacement, commit,
  } = useEditor();
  return (
    <div className="space-y-3">
      <div>
        <Label>Symbology</Label>
        <Select value={symbology} onValueChange={(v) => { if (v !== null) { setField("symbology", v); commit(); } }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {SYMBOLOGIES.map((s) => <SelectItem key={s} value={s}>{s.toUpperCase()}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Value</Label>
        <Input value={value} onChange={(e) => setField("value", e.target.value)}
               onBlur={() => commit()}
               placeholder="e.g. 5901234123457" />
      </div>
      <div className="flex items-center justify-between">
        <Label>Show text</Label>
        <Switch checked={options.show_text}
                onCheckedChange={(v) => { setOption("show_text", v); commit(); }} />
      </div>
      {options.show_text && symbology !== "qr" && (
        <div className="flex items-center justify-between">
          <Label>Separate text placement</Label>
          <Switch checked={separateTextPlacement}
                  onCheckedChange={(v) => { setSeparateTextPlacement(v); commit(); }} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run components/BarcodeSettings.test.tsx`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/BarcodeSettings.tsx apps/web/components/BarcodeSettings.test.tsx
git commit -m "feat(web): add separate text placement toggle to BarcodeSettings"
```

---

### Task 10: AdjustPanel.tsx -- second corner grid for the text quad

**Files:**
- Modify: `apps/web/components/AdjustPanel.tsx`
- Test: `apps/web/components/AdjustPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/components/AdjustPanel.test.tsx`, inside the `describe("AdjustPanel", ...)` block:

```typescript
  it("shows a second placement grid for text corners when separateTextPlacement is on", () => {
    useEditor.setState({ separateTextPlacement: true, textCorners: [[1, 1], [2, 1], [2, 2], [1, 2]] });
    render(<AdjustPanel onConfirm={() => {}} isPending={false} />);
    const inputs = screen.getAllByRole("spinbutton");
    expect(inputs).toHaveLength(16); // 4 bars corners + 4 text corners, x2 each
  });

  it("hides the text placement grid when separateTextPlacement is off", () => {
    useEditor.setState({ separateTextPlacement: false, textCorners: null });
    render(<AdjustPanel onConfirm={() => {}} isPending={false} />);
    const inputs = screen.getAllByRole("spinbutton");
    expect(inputs).toHaveLength(8);
  });

  it("editing a text corner input updates textCorners", () => {
    useEditor.setState({ separateTextPlacement: true, textCorners: [[1, 1], [2, 1], [2, 2], [1, 2]] });
    render(<AdjustPanel onConfirm={() => {}} isPending={false} />);
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[8], { target: { value: "50" } }); // first text-corner input
    expect(useEditor.getState().textCorners![0][0]).toBe(50);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run components/AdjustPanel.test.tsx`
Expected: FAIL -- only 8 inputs render regardless of `separateTextPlacement`/`textCorners`

- [ ] **Step 3: Update AdjustPanel.tsx**

Replace the full contents of `apps/web/components/AdjustPanel.tsx` with:

```tsx
"use client";
import { useEditor } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Corner } from "@/lib/types";

interface AdjustPanelProps {
  onConfirm: () => void;
  isPending: boolean;
}

export function AdjustPanel({ onConfirm, isPending }: AdjustPanelProps) {
  const {
    corners, detectedCorners, adjusting, result, updateCorner, commit, resetCorners,
    textCorners, separateTextPlacement, updateTextCorner,
  } = useEditor();

  if (!adjusting || !corners) return null;

  function handleNumberChange(i: number, axis: 0 | 1, raw: string) {
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    const c: Corner = [...corners![i]] as Corner;
    c[axis] = n;
    updateCorner(i, c);
  }

  function handleTextNumberChange(i: number, axis: 0 | 1, raw: string) {
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    const c: Corner = [...textCorners![i]] as Corner;
    c[axis] = n;
    updateTextCorner(i, c);
  }

  return (
    <div className="space-y-3">
      <Label>Placement</Label>
      <div className="grid grid-cols-2 gap-2">
        {corners.map((c, i) => (
          <div key={i} className="contents">
            <Input type="number" value={c[0]}
                   onChange={(e) => handleNumberChange(i, 0, e.target.value)}
                   onBlur={() => commit()} />
            <Input type="number" value={c[1]}
                   onChange={(e) => handleNumberChange(i, 1, e.target.value)}
                   onBlur={() => commit()} />
          </div>
        ))}
      </div>
      {separateTextPlacement && textCorners && (
        <>
          <Label>Value text placement</Label>
          <div className="grid grid-cols-2 gap-2">
            {textCorners.map((c, i) => (
              <div key={i} className="contents">
                <Input type="number" value={c[0]}
                       onChange={(e) => handleTextNumberChange(i, 0, e.target.value)}
                       onBlur={() => commit()} />
                <Input type="number" value={c[1]}
                       onChange={(e) => handleTextNumberChange(i, 1, e.target.value)}
                       onBlur={() => commit()} />
              </div>
            ))}
          </div>
        </>
      )}
      <div className="flex gap-2">
        {detectedCorners && (
          <Button variant="outline" size="sm" onClick={resetCorners}>
            Reset to detected
          </Button>
        )}
        {result && (
          <Button size="sm" disabled={isPending} onClick={onConfirm}>
            {isPending ? "Confirming..." : "Confirm placement"}
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run components/AdjustPanel.test.tsx`
Expected: all PASS

- [ ] **Step 5: Run the full frontend suite**

Run: `cd apps/web && npx vitest run`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/AdjustPanel.tsx apps/web/components/AdjustPanel.test.tsx
git commit -m "feat(web): add text corner inputs to AdjustPanel"
```

---

### Task 11: page.tsx -- wire text_corners into the replace call

**Files:**
- Modify: `apps/web/app/page.tsx`

- [ ] **Step 1: Update the mutation call**

In `apps/web/app/page.tsx`, replace the `mutationFn` inside the `useMutation` call with:

```tsx
    mutationFn: () => replace({
      image: s.image!, corners: s.corners!, symbology: s.symbology,
      value: s.value, options: s.options, blend_mode: s.blendMode,
      text_corners: s.separateTextPlacement && s.textCorners ? s.textCorners : undefined,
    }),
```

(This is the only change to this file -- everything else stays the same.)

- [ ] **Step 2: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors from `app/page.tsx` (ignore pre-existing unrelated errors under `.next/dev/types/`)

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/page.tsx
git commit -m "feat(web): pass text_corners to the replace API call when enabled"
```

---

### Task 12: Manual end-to-end verification

- [ ] **Step 1: Start both dev servers**

Kill any stale `node`/`uvicorn` processes and clear `.next` cache first (established project pattern -- stale builds under a switched branch cause confusing errors), then start fresh:
- API: `cd services/api && .venv/Scripts/python.exe -m uvicorn main:app --port 8000`
- Web: `cd apps/web && npm run dev`

- [ ] **Step 2: Verify the toggle's visibility rules**

Upload an image, set symbology to `code128` with "Show text" on. Confirm "Separate text placement" appears. Turn "Show text" off -- confirm it disappears. Turn "Show text" back on, switch symbology to `qr` -- confirm it disappears. Switch back to `code128`.

- [ ] **Step 3: Verify the text quad's default position and independent dragging**

Turn "Separate text placement" on. Confirm a second (purple) quad appears, offset below the bars quad, matching its width and skew. Drag the text quad's corners/edges/rotate handle -- confirm only the text quad moves, not the bars quad. Confirm the AdjustPanel's second corner-input grid updates to match.

- [ ] **Step 4: Verify a real replace with a preserved caption**

Using a label with printed text before the barcode's own value (e.g. "S/N:" followed by the old value), position the bars quad over just the bars and the text quad over just the old value text (leaving "S/N:" outside both quads). Click "Replace barcode". Confirm: the caption ("S/N:") is untouched, the bars show the new value's bar pattern, and the value text shows the new value -- all with no visible seam, matching the tone-correction quality already verified for the single-quad flow.

- [ ] **Step 5: Verify turning the toggle off falls back to single-quad behavior**

Turn "Separate text placement" off and replace again. Confirm the result matches today's existing single-quad behavior (bars + text placed together as one region, no regression).

- [ ] **Step 6: Verify undo/redo tracks the text quad**

With "Separate text placement" on, drag the text quad, then Undo -- confirm the text quad's position reverts. Redo -- confirm it re-applies.
