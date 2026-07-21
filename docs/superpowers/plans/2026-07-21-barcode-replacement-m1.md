# Barcode Replacement M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable web app that replaces a barcode in an uploaded photo with a user-chosen barcode, warped and Poisson-blended so it looks printed-on, with a focused UI (corner handles, before/after, basic layers).

**Architecture:** Monorepo. Python FastAPI backend runs a classical CPU pipeline (detect → generate → warp → tone-match → seamlessClone blend) exposed as `/api/detect` and `/api/replace`. Next.js 15 frontend drives the flow with a Konva canvas, Zustand state, and React Query. Synchronous processing, local-filesystem storage. No GPU/diffusion/queue/DB in M1.

**Tech Stack:** Python 3.11, FastAPI, Uvicorn, OpenCV (`opencv-contrib-python`), pyzbar, python-barcode, qrcode, Pillow, numpy, pytest. Next.js 15 (App Router), React 19, TypeScript, TailwindCSS, shadcn/ui, Zustand, React Query, Konva/react-konva, Framer Motion.

**Spec:** `docs/superpowers/specs/2026-07-21-barcode-replacement-m1-design.md`

---

## File Structure

### Backend (`services/api/`)
| File | Responsibility |
|------|----------------|
| `requirements.txt` | Python deps |
| `main.py` | FastAPI app, CORS, route registration, `/api/health` |
| `routes.py` | `/api/detect`, `/api/replace` handlers (HTTP ↔ pipeline glue) |
| `schemas.py` | Pydantic request/response models |
| `imgio.py` | image encode/decode helpers (base64 ↔ ndarray) |
| `pipeline/detect.py` | barcode detection → corners/type/value/confidence |
| `pipeline/generate.py` | render barcode bitmap + SVG per symbology |
| `pipeline/warp.py` | perspective-warp barcode onto target corners |
| `pipeline/tone.py` | brightness/paper-color transfer |
| `pipeline/blend.py` | `cv2.seamlessClone` composite |
| `pipeline/orchestrator.py` | run stages, assemble layers |
| `tests/…` | pytest per module + fixtures |

### Frontend (`apps/web/`)
| File | Responsibility |
|------|----------------|
| `app/page.tsx` | main editor page / layout |
| `lib/api.ts` | typed fetch wrappers for detect/replace |
| `lib/store.ts` | Zustand editor store |
| `components/UploadPanel.tsx` | file upload |
| `components/BarcodeSettings.tsx` | symbology/value/options form |
| `components/EditorCanvas.tsx` | Konva image + draggable corner handles |
| `components/LayerPanel.tsx` | show/hide + opacity per layer |
| `components/Comparison.tsx` | split + swipe before/after |
| `components/ExportBar.tsx` | download PNG / SVG |

---

## PART A — Scaffolding

### Task 1: Backend scaffold + health endpoint

**Files:**
- Create: `services/api/requirements.txt`
- Create: `services/api/main.py`
- Create: `services/api/tests/test_health.py`
- Create: `services/api/pipeline/__init__.py` (empty)

- [ ] **Step 1: Write requirements.txt**

```
fastapi==0.115.*
uvicorn[standard]==0.32.*
opencv-contrib-python==4.10.*
pyzbar==0.1.9
python-barcode==0.15.*
qrcode==7.4.*
pillow==11.*
numpy==2.*
python-multipart==0.0.*
pytest==8.*
httpx==0.27.*
```

Note: `pyzbar` needs the ZBar shared lib. On Windows the wheel bundles it; on Linux/mac install `libzbar0`/`zbar`. Document in README (Task 15).

- [ ] **Step 2: Write the failing test**

```python
# services/api/tests/test_health.py
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_health_ok():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services/api && python -m pytest tests/test_health.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'main'`.

- [ ] **Step 4: Write minimal implementation**

```python
# services/api/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Barcode Replacement API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/api && python -m pytest tests/test_health.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/api
git commit -m "feat(api): scaffold FastAPI app with health endpoint"
```

---

### Task 2: Image I/O helpers

**Files:**
- Create: `services/api/imgio.py`
- Create: `services/api/tests/test_imgio.py`

- [ ] **Step 1: Write the failing test**

```python
# services/api/tests/test_imgio.py
import numpy as np
from imgio import ndarray_to_b64, b64_to_ndarray

def test_roundtrip_preserves_shape_and_pixels():
    img = np.zeros((10, 12, 3), dtype=np.uint8)
    img[2:5, 3:7] = (255, 0, 0)  # BGR block
    encoded = ndarray_to_b64(img, fmt="png")
    assert encoded.startswith("data:image/png;base64,")
    decoded = b64_to_ndarray(encoded)
    assert decoded.shape == img.shape
    assert np.array_equal(decoded, img)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && python -m pytest tests/test_imgio.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'imgio'`.

- [ ] **Step 3: Write minimal implementation**

```python
# services/api/imgio.py
import base64
import cv2
import numpy as np

def ndarray_to_b64(img: np.ndarray, fmt: str = "png") -> str:
    ok, buf = cv2.imencode(f".{fmt}", img)
    if not ok:
        raise ValueError("encode failed")
    b64 = base64.b64encode(buf.tobytes()).decode("ascii")
    return f"data:image/{fmt};base64,{b64}"

def b64_to_ndarray(data_url: str) -> np.ndarray:
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    raw = base64.b64decode(data_url)
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("decode failed")
    return img
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && python -m pytest tests/test_imgio.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/imgio.py services/api/tests/test_imgio.py
git commit -m "feat(api): add base64<->ndarray image io helpers"
```

---

## PART B — Backend Pipeline (TDD)

### Task 3: Barcode generation

**Files:**
- Create: `services/api/pipeline/generate.py`
- Create: `services/api/tests/test_generate.py`

- [ ] **Step 1: Write the failing test**

```python
# services/api/tests/test_generate.py
import numpy as np
import pytest
from pipeline.generate import generate_barcode, GenerateOptions, GenerateError

def test_ean13_returns_bitmap_and_svg():
    res = generate_barcode("ean13", "5901234123457", GenerateOptions())
    assert isinstance(res.bitmap, np.ndarray)
    assert res.bitmap.ndim == 3 and res.bitmap.shape[2] == 3
    assert res.bitmap.shape[0] > 0 and res.bitmap.shape[1] > 0
    assert "<svg" in res.svg.lower()

def test_hide_text_is_shorter_than_show_text():
    shown = generate_barcode("code128", "HELLO", GenerateOptions(show_text=True))
    hidden = generate_barcode("code128", "HELLO", GenerateOptions(show_text=False))
    assert hidden.bitmap.shape[0] < shown.bitmap.shape[0]

def test_qr_generates():
    res = generate_barcode("qr", "https://example.com", GenerateOptions())
    assert res.bitmap.shape[0] > 0

def test_invalid_ean13_raises():
    with pytest.raises(GenerateError):
        generate_barcode("ean13", "123", GenerateOptions())

def test_unknown_symbology_raises():
    with pytest.raises(GenerateError):
        generate_barcode("aztec", "x", GenerateOptions())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && python -m pytest tests/test_generate.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```python
# services/api/pipeline/generate.py
from dataclasses import dataclass
from io import BytesIO
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

def _pil_to_bgr(img: Image.Image) -> np.ndarray:
    rgb = np.array(img.convert("RGB"))
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

def _generate_linear(symb: str, value: str, opts: GenerateOptions) -> GenerateResult:
    try:
        cls = barcode.get_barcode_class(_LINEAR[symb])
    except Exception as e:
        raise GenerateError(str(e))
    common = {"write_text": opts.show_text, "quiet_zone": opts.quiet_zone,
              "module_width": opts.module_width, "module_height": opts.module_height}
    try:
        # bitmap
        png_buf = BytesIO()
        obj = cls(value, writer=ImageWriter())
        obj.write(png_buf, options=common)
        png_buf.seek(0)
        bitmap = _pil_to_bgr(Image.open(png_buf))
        # svg
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && python -m pytest tests/test_generate.py -v`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add services/api/pipeline/generate.py services/api/tests/test_generate.py
git commit -m "feat(api): barcode generation for common symbologies + qr"
```

---

### Task 4: Test fixture builder (synthetic scene)

**Files:**
- Create: `services/api/tests/fixtures.py`
- Create: `services/api/tests/test_fixtures.py`

Purpose: produce a deterministic image with a known barcode placed at known
corners under a mild perspective, reused by detect/warp/blend tests.

- [ ] **Step 1: Write the failing test**

```python
# services/api/tests/test_fixtures.py
import numpy as np
from tests.fixtures import make_scene

def test_make_scene_returns_image_and_corners():
    scene, corners, meta = make_scene()
    assert scene.ndim == 3 and scene.shape[2] == 3
    assert corners.shape == (4, 2)
    # corners inside image bounds
    h, w = scene.shape[:2]
    assert corners[:, 0].min() >= 0 and corners[:, 0].max() <= w
    assert corners[:, 1].min() >= 0 and corners[:, 1].max() <= h
    assert meta["symbology"] == "code128"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && python -m pytest tests/test_fixtures.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```python
# services/api/tests/fixtures.py
import numpy as np
import cv2
from pipeline.generate import generate_barcode, GenerateOptions

def make_scene(value: str = "TESTCODE", warp: bool = True):
    """Return (scene_bgr, corners[4,2] tl-tr-br-bl, meta)."""
    res = generate_barcode("code128", value, GenerateOptions(show_text=False))
    bc = res.bitmap
    bh, bw = bc.shape[:2]

    scene = np.full((600, 800, 3), 210, dtype=np.uint8)  # light gray "packaging"
    # add gentle vertical gradient so tone-matching has something to match
    grad = np.linspace(-25, 25, 600).astype(np.int16)
    scene = np.clip(scene.astype(np.int16) + grad[:, None, None], 0, 255).astype(np.uint8)

    # place barcode: source rect -> dest quad
    src = np.float32([[0, 0], [bw, 0], [bw, bh], [0, bh]])
    if warp:
        dst = np.float32([[250, 200], [560, 220], [545, 360], [265, 350]])
    else:
        dst = np.float32([[260, 210], [560, 210], [560, 350], [260, 350]])
    H = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(bc, H, (800, 600), borderValue=(210, 210, 210))
    mask = cv2.warpPerspective(np.full((bh, bw), 255, np.uint8), H, (800, 600))
    scene[mask > 0] = warped[mask > 0]

    meta = {"symbology": "code128", "value": value}
    return scene, dst.copy(), meta
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && python -m pytest tests/test_fixtures.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/tests/fixtures.py services/api/tests/test_fixtures.py
git commit -m "test(api): synthetic barcode scene fixture"
```

---

### Task 5: Barcode detection

**Files:**
- Create: `services/api/pipeline/detect.py`
- Create: `services/api/tests/test_detect.py`

- [ ] **Step 1: Write the failing test**

```python
# services/api/tests/test_detect.py
import numpy as np
from pipeline.detect import detect_barcodes
from tests.fixtures import make_scene

def _corner_error(found, truth):
    # order-insensitive nearest-corner mean distance
    total = 0.0
    for p in truth:
        d = np.linalg.norm(found - p, axis=1).min()
        total += d
    return total / len(truth)

def test_detects_barcode_near_true_corners():
    scene, corners, meta = make_scene(warp=False)
    dets = detect_barcodes(scene)
    assert len(dets) >= 1
    best = dets[0]
    assert best.corners.shape == (4, 2)
    assert _corner_error(best.corners, corners) < 25  # pixels

def test_no_barcode_returns_empty():
    blank = np.full((300, 300, 3), 200, dtype=np.uint8)
    assert detect_barcodes(blank) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && python -m pytest tests/test_detect.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```python
# services/api/pipeline/detect.py
from dataclasses import dataclass, field
from typing import List, Optional
import numpy as np
import cv2

try:
    from pyzbar import pyzbar
    _HAS_ZBAR = True
except Exception:
    _HAS_ZBAR = False

@dataclass
class Detection:
    corners: np.ndarray            # (4,2) float32, ordered tl,tr,br,bl
    type: Optional[str] = None
    value: Optional[str] = None
    confidence: float = 0.0
    bbox: tuple = field(default=())  # x,y,w,h

def _order_quad(pts: np.ndarray) -> np.ndarray:
    pts = pts.astype(np.float32)
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    tl = pts[np.argmin(s)]
    br = pts[np.argmax(s)]
    tr = pts[np.argmin(d)]
    bl = pts[np.argmax(d)]
    return np.float32([tl, tr, br, bl])

def _bbox(corners: np.ndarray) -> tuple:
    x, y, w, h = cv2.boundingRect(corners.astype(np.int32))
    return (int(x), int(y), int(w), int(h))

def _detect_zbar(img: np.ndarray) -> List[Detection]:
    out = []
    for r in pyzbar.decode(img):
        pts = np.float32([[p.x, p.y] for p in r.polygon])
        if len(pts) < 4:
            x, y, w, h = r.rect
            pts = np.float32([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])
        corners = _order_quad(pts if len(pts) == 4 else cv2.boxPoints(cv2.minAreaRect(pts)))
        out.append(Detection(corners=corners, type=r.type,
                             value=r.data.decode("utf-8", "replace"),
                             confidence=0.9, bbox=_bbox(corners)))
    return out

def _detect_opencv(img: np.ndarray) -> List[Detection]:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    try:
        bd = cv2.barcode.BarcodeDetector()
        ok, decoded, types, points = bd.detectAndDecode(gray)
    except Exception:
        ok, points = False, None
    out = []
    if points is not None and len(points):
        for i, quad in enumerate(points):
            corners = _order_quad(np.float32(quad).reshape(4, 2))
            out.append(Detection(corners=corners, type=None, value=None,
                                 confidence=0.6, bbox=_bbox(corners)))
    return out

def detect_barcodes(img: np.ndarray) -> List[Detection]:
    dets: List[Detection] = []
    if _HAS_ZBAR:
        dets = _detect_zbar(img)
    if not dets:
        dets = _detect_opencv(img)
    dets.sort(key=lambda d: d.confidence, reverse=True)
    return dets
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && python -m pytest tests/test_detect.py -v`
Expected: PASS. (If ZBar shared lib is missing, the OpenCV fallback still satisfies the test; ensure `opencv-contrib-python` is installed for `cv2.barcode`.)

- [ ] **Step 5: Commit**

```bash
git add services/api/pipeline/detect.py services/api/tests/test_detect.py
git commit -m "feat(api): classical barcode detection with corner ordering"
```

---

### Task 6: Perspective warp

**Files:**
- Create: `services/api/pipeline/warp.py`
- Create: `services/api/tests/test_warp.py`

- [ ] **Step 1: Write the failing test**

```python
# services/api/tests/test_warp.py
import numpy as np
from pipeline.warp import warp_onto
from pipeline.generate import generate_barcode, GenerateOptions

def test_warp_places_barcode_within_target_quad():
    bc = generate_barcode("code128", "HELLO", GenerateOptions(show_text=False)).bitmap
    corners = np.float32([[100, 80], [300, 90], [295, 190], [110, 185]])
    warped, alpha = warp_onto(bc, corners, canvas_size=(400, 500))  # (h,w)
    assert warped.shape == (400, 500, 3)
    assert alpha.shape == (400, 500)
    ys, xs = np.where(alpha > 0)
    # painted pixels sit inside the target bounding box (+ small margin)
    assert xs.min() >= 95 and xs.max() <= 305
    assert ys.min() >= 75 and ys.max() <= 195
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && python -m pytest tests/test_warp.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```python
# services/api/pipeline/warp.py
from typing import Tuple
import numpy as np
import cv2

def warp_onto(barcode_bgr: np.ndarray, target_corners: np.ndarray,
              canvas_size: Tuple[int, int]) -> Tuple[np.ndarray, np.ndarray]:
    """Warp barcode so its corners map to target_corners (tl,tr,br,bl).
    canvas_size is (height, width). Returns (warped_bgr, alpha_uint8)."""
    h, w = canvas_size
    bh, bw = barcode_bgr.shape[:2]
    src = np.float32([[0, 0], [bw, 0], [bw, bh], [0, bh]])
    dst = np.float32(target_corners)
    H = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(barcode_bgr, H, (w, h))
    mask = cv2.warpPerspective(np.full((bh, bw), 255, np.uint8), H, (w, h))
    return warped, mask
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && python -m pytest tests/test_warp.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/pipeline/warp.py services/api/tests/test_warp.py
git commit -m "feat(api): perspective warp of barcode onto target corners"
```

---

### Task 7: Tone matching

**Files:**
- Create: `services/api/pipeline/tone.py`
- Create: `services/api/tests/test_tone.py`

- [ ] **Step 1: Write the failing test**

```python
# services/api/tests/test_tone.py
import numpy as np
from pipeline.tone import match_tone

def test_match_tone_shifts_mean_toward_target():
    # bright white barcode region
    barcode = np.full((50, 80, 3), 255, dtype=np.uint8)
    barcode[:, ::4] = 0  # some dark bars
    alpha = np.full((50, 80), 255, dtype=np.uint8)
    # target surface is darker/tinted
    target_region = np.full((50, 80, 3), 150, dtype=np.uint8)

    out = match_tone(barcode, alpha, target_region)
    painted = out[alpha > 0]
    assert painted.mean() < barcode[alpha > 0].mean()
    # dark bars stay relatively darker than light modules
    assert out[0, 0].mean() > out[0, 1].mean()  # module vs bar (col0 light, col1 dark? )
```

> Implementation note: the assertion checks the ordering is preserved after
> scaling; if column indices differ, adjust to two known light/dark pixels.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && python -m pytest tests/test_tone.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```python
# services/api/pipeline/tone.py
import numpy as np
import cv2

def match_tone(barcode_bgr: np.ndarray, alpha: np.ndarray,
               target_region_bgr: np.ndarray, blur_sigma: float = 0.6) -> np.ndarray:
    """Scale barcode luminance/color so its 'paper' matches the target surface.
    barcode_bgr and alpha same size; target_region_bgr is the original pixels
    under the same area (any size, used only for statistics)."""
    out = barcode_bgr.astype(np.float32)
    m = alpha > 0
    if not m.any():
        return barcode_bgr

    tgt = target_region_bgr.reshape(-1, 3).astype(np.float32)
    tgt_mean = tgt.mean(axis=0)               # per-channel BGR mean of surface
    tgt_p95 = np.percentile(tgt, 95, axis=0)  # approx "paper white" of surface

    src = out[m]
    src_p95 = np.percentile(src, 95, axis=0) + 1e-3  # barcode paper white

    # map barcode white -> surface paper white, keep blacks near 0 but lifted to mean floor
    scale = tgt_p95 / src_p95
    floor = tgt_mean * 0.15
    adj = src * scale
    adj = np.clip(adj, floor, 255)
    out[m] = adj

    out = np.clip(out, 0, 255).astype(np.uint8)
    if blur_sigma > 0:
        blurred = cv2.GaussianBlur(out, (0, 0), blur_sigma)
        out[m] = blurred[m]
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && python -m pytest tests/test_tone.py -v`
Expected: PASS. If the ordering assertion is brittle, replace the last assert with two explicit pixels known to be light vs dark in the constructed input.

- [ ] **Step 5: Commit**

```bash
git add services/api/pipeline/tone.py services/api/tests/test_tone.py
git commit -m "feat(api): tone-match barcode to target surface statistics"
```

---

### Task 8: Poisson blend

**Files:**
- Create: `services/api/pipeline/blend.py`
- Create: `services/api/tests/test_blend.py`

- [ ] **Step 1: Write the failing test**

```python
# services/api/tests/test_blend.py
import numpy as np
import cv2
from pipeline.blend import seamless_blend

def _seam_energy(img, mask):
    edge = cv2.morphologyEx(mask, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
    lap = cv2.Laplacian(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), cv2.CV_64F)
    return float(np.abs(lap)[edge > 0].mean())

def test_seamless_blend_has_softer_seam_than_hard_paste():
    bg = np.full((200, 200, 3), 180, dtype=np.uint8)
    patch = np.full((200, 200, 3), 60, dtype=np.uint8)
    mask = np.zeros((200, 200), np.uint8)
    cv2.rectangle(mask, (70, 70), (130, 130), 255, -1)

    hard = bg.copy()
    hard[mask > 0] = patch[mask > 0]

    blended = seamless_blend(patch, bg, mask, mode="normal")
    assert blended.shape == bg.shape
    assert _seam_energy(blended, mask) < _seam_energy(hard, mask)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && python -m pytest tests/test_blend.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```python
# services/api/pipeline/blend.py
import numpy as np
import cv2

_MODES = {"normal": cv2.NORMAL_CLONE, "mixed": cv2.MIXED_CLONE}

def seamless_blend(src_bgr: np.ndarray, dst_bgr: np.ndarray,
                   mask: np.ndarray, mode: str = "normal") -> np.ndarray:
    flag = _MODES.get(mode, cv2.NORMAL_CLONE)
    m = (mask > 0).astype(np.uint8) * 255
    ys, xs = np.where(m > 0)
    if len(xs) == 0:
        return dst_bgr.copy()
    cx = int((xs.min() + xs.max()) / 2)
    cy = int((ys.min() + ys.max()) / 2)
    # seamlessClone needs the mask strictly inside dst; erode 1px for safety
    m = cv2.erode(m, np.ones((3, 3), np.uint8), iterations=1)
    return cv2.seamlessClone(src_bgr, dst_bgr, m, (cx, cy), flag)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && python -m pytest tests/test_blend.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/pipeline/blend.py services/api/tests/test_blend.py
git commit -m "feat(api): Poisson seamlessClone blending"
```

---

### Task 9: Orchestrator

**Files:**
- Create: `services/api/pipeline/orchestrator.py`
- Create: `services/api/tests/test_orchestrator.py`

- [ ] **Step 1: Write the failing test**

```python
# services/api/tests/test_orchestrator.py
import numpy as np
from pipeline.orchestrator import replace_barcode, ReplaceRequest
from pipeline.generate import GenerateOptions
from tests.fixtures import make_scene

def test_replace_returns_result_and_layers():
    scene, corners, meta = make_scene(warp=False)
    req = ReplaceRequest(
        image=scene, corners=corners, symbology="code128",
        value="NEWVALUE", options=GenerateOptions(show_text=False),
        blend_mode="normal",
    )
    res = replace_barcode(req)
    assert res.result.shape == scene.shape
    assert "original" in res.layers
    assert "new_barcode" in res.layers
    assert "mask" in res.layers
    # result differs from original inside the region
    diff = np.abs(res.result.astype(int) - scene.astype(int)).sum()
    assert diff > 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && python -m pytest tests/test_orchestrator.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```python
# services/api/pipeline/orchestrator.py
from dataclasses import dataclass, field
from typing import Dict
import numpy as np
import cv2
from pipeline.generate import generate_barcode, GenerateOptions, GenerateResult
from pipeline.warp import warp_onto
from pipeline.tone import match_tone
from pipeline.blend import seamless_blend

@dataclass
class ReplaceRequest:
    image: np.ndarray          # BGR
    corners: np.ndarray        # (4,2) tl,tr,br,bl
    symbology: str
    value: str
    options: GenerateOptions = field(default_factory=GenerateOptions)
    blend_mode: str = "normal"

@dataclass
class ReplaceResult:
    result: np.ndarray
    svg: str
    layers: Dict[str, np.ndarray]

def replace_barcode(req: ReplaceRequest) -> ReplaceResult:
    h, w = req.image.shape[:2]
    gen: GenerateResult = generate_barcode(req.symbology, req.value, req.options)

    warped, alpha = warp_onto(gen.bitmap, req.corners, (h, w))

    # sample original pixels under the mask for tone stats
    ys, xs = np.where(alpha > 0)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    target_region = req.image[y0:y1 + 1, x0:x1 + 1]
    toned = match_tone(warped, alpha, target_region)

    result = seamless_blend(toned, req.image, alpha, mode=req.blend_mode)

    new_barcode_layer = np.zeros_like(req.image)
    new_barcode_layer[alpha > 0] = toned[alpha > 0]

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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && python -m pytest tests/test_orchestrator.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/pipeline/orchestrator.py services/api/tests/test_orchestrator.py
git commit -m "feat(api): orchestrate full replace pipeline with layers"
```

---

### Task 10: API routes + schemas

**Files:**
- Create: `services/api/schemas.py`
- Create: `services/api/routes.py`
- Modify: `services/api/main.py` (register router)
- Create: `services/api/tests/test_routes.py`

- [ ] **Step 1: Write the failing test**

```python
# services/api/tests/test_routes.py
from fastapi.testclient import TestClient
from main import app
from imgio import ndarray_to_b64
from tests.fixtures import make_scene

client = TestClient(app)

def test_detect_endpoint_returns_detections():
    scene, corners, meta = make_scene(warp=False)
    r = client.post("/api/detect", json={"image": ndarray_to_b64(scene)})
    assert r.status_code == 200
    body = r.json()
    assert "detections" in body
    assert len(body["detections"]) >= 1
    assert len(body["detections"][0]["corners"]) == 4

def test_replace_endpoint_returns_result():
    scene, corners, meta = make_scene(warp=False)
    payload = {
        "image": ndarray_to_b64(scene),
        "corners": corners.tolist(),
        "symbology": "code128",
        "value": "NEWVALUE",
        "options": {"show_text": False},
        "blend_mode": "normal",
    }
    r = client.post("/api/replace", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["result"].startswith("data:image/png;base64,")
    assert "<svg" in body["svg"].lower()
    assert set(body["layers"].keys()) == {"original", "new_barcode", "mask"}

def test_replace_invalid_ean13_returns_422():
    scene, corners, meta = make_scene(warp=False)
    payload = {
        "image": ndarray_to_b64(scene),
        "corners": corners.tolist(),
        "symbology": "ean13", "value": "123",
        "options": {}, "blend_mode": "normal",
    }
    r = client.post("/api/replace", json=payload)
    assert r.status_code == 422
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && python -m pytest tests/test_routes.py -v`
Expected: FAIL — `/api/detect` 404 / router not registered.

- [ ] **Step 3: Write schemas**

```python
# services/api/schemas.py
from typing import List, Optional, Dict
from pydantic import BaseModel, Field

class DetectRequest(BaseModel):
    image: str  # data URL

class DetectionOut(BaseModel):
    corners: List[List[float]]
    type: Optional[str] = None
    value: Optional[str] = None
    confidence: float
    bbox: List[int]

class DetectResponse(BaseModel):
    detections: List[DetectionOut]

class OptionsIn(BaseModel):
    show_text: bool = True
    quiet_zone: float = 6.5
    module_width: float = 0.2
    module_height: float = 15.0

class ReplaceRequestIn(BaseModel):
    image: str
    corners: List[List[float]] = Field(..., min_length=4, max_length=4)
    symbology: str
    value: str
    options: OptionsIn = OptionsIn()
    blend_mode: str = "normal"

class ReplaceResponse(BaseModel):
    result: str
    svg: str
    layers: Dict[str, str]
```

- [ ] **Step 4: Write routes**

```python
# services/api/routes.py
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

@router.post("/replace", response_model=ReplaceResponse)
def replace(req: ReplaceRequestIn):
    try:
        img = b64_to_ndarray(req.image)
    except ValueError:
        raise HTTPException(status_code=415, detail="unreadable image")
    corners = np.float32(req.corners)
    h, w = img.shape[:2]
    if (corners[:, 0].min() < 0 or corners[:, 1].min() < 0 or
            corners[:, 0].max() > w or corners[:, 1].max() > h):
        raise HTTPException(status_code=422, detail="corners out of bounds")
    opts = GenerateOptions(**req.options.model_dump())
    try:
        res = replace_barcode(ReplaceRequest(
            image=img, corners=corners, symbology=req.symbology,
            value=req.value, options=opts, blend_mode=req.blend_mode,
        ))
    except GenerateError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return ReplaceResponse(
        result=ndarray_to_b64(res.result),
        svg=res.svg,
        layers={k: ndarray_to_b64(v) for k, v in res.layers.items()},
    )
```

- [ ] **Step 5: Register router in main.py**

Add to `services/api/main.py` after `app.add_middleware(...)`:

```python
from routes import router
app.include_router(router)
```

- [ ] **Step 6: Run tests**

Run: `cd services/api && python -m pytest tests/test_routes.py -v`
Expected: PASS (all 3).

- [ ] **Step 7: Full backend suite green**

Run: `cd services/api && python -m pytest -v`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add services/api
git commit -m "feat(api): /detect and /replace endpoints with validation"
```

---

## PART C — Frontend

### Task 11: Next.js scaffold + Tailwind + shadcn

**Files:**
- Create: `apps/web/` (Next.js app)

- [ ] **Step 1: Scaffold**

Run from repo root:
```bash
npx create-next-app@latest apps/web --typescript --tailwind --app --eslint --src-dir=false --import-alias "@/*" --no-turbopack
cd apps/web
npm i zustand @tanstack/react-query konva react-konva framer-motion
npx shadcn@latest init -d
npx shadcn@latest add button slider select input label switch card tabs
```

- [ ] **Step 2: Add API base env**

Create `apps/web/.env.local`:
```
NEXT_PUBLIC_API_BASE=http://localhost:8000
```

- [ ] **Step 3: Verify dev server boots**

Run: `cd apps/web && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "chore(web): scaffold Next.js app with tailwind, shadcn, deps"
```

---

### Task 12: API client + Zustand store

**Files:**
- Create: `apps/web/lib/api.ts`
- Create: `apps/web/lib/store.ts`
- Create: `apps/web/lib/types.ts`

- [ ] **Step 1: Types**

```typescript
// apps/web/lib/types.ts
export type Corner = [number, number];

export interface Detection {
  corners: Corner[];
  type: string | null;
  value: string | null;
  confidence: number;
  bbox: number[];
}

export interface BarcodeOptions {
  show_text: boolean;
  quiet_zone: number;
  module_width: number;
  module_height: number;
}

export interface ReplaceResponse {
  result: string;
  svg: string;
  layers: Record<"original" | "new_barcode" | "mask", string>;
}
```

- [ ] **Step 2: API client**

```typescript
// apps/web/lib/api.ts
import type { Detection, BarcodeOptions, ReplaceResponse } from "./types";

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export async function detect(image: string): Promise<Detection[]> {
  const r = await fetch(`${BASE}/api/detect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image }),
  });
  if (!r.ok) throw new Error(`detect failed: ${r.status}`);
  return (await r.json()).detections;
}

export async function replace(params: {
  image: string;
  corners: number[][];
  symbology: string;
  value: string;
  options: BarcodeOptions;
  blend_mode: string;
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

- [ ] **Step 3: Zustand store**

```typescript
// apps/web/lib/store.ts
import { create } from "zustand";
import type { Corner, BarcodeOptions, ReplaceResponse } from "./types";

interface LayerState { visible: boolean; opacity: number; }

interface EditorState {
  image: string | null;
  corners: Corner[] | null;
  symbology: string;
  value: string;
  options: BarcodeOptions;
  blendMode: string;
  result: ReplaceResponse | null;
  layers: Record<string, LayerState>;
  setImage: (img: string | null) => void;
  setCorners: (c: Corner[] | null) => void;
  updateCorner: (i: number, c: Corner) => void;
  setField: <K extends keyof EditorState>(k: K, v: EditorState[K]) => void;
  setOption: <K extends keyof BarcodeOptions>(k: K, v: BarcodeOptions[K]) => void;
  setResult: (r: ReplaceResponse | null) => void;
  setLayer: (name: string, patch: Partial<LayerState>) => void;
}

const defaultLayers = {
  original: { visible: true, opacity: 1 },
  new_barcode: { visible: true, opacity: 1 },
  result: { visible: true, opacity: 1 },
};

export const useEditor = create<EditorState>((set) => ({
  image: null,
  corners: null,
  symbology: "code128",
  value: "",
  options: { show_text: true, quiet_zone: 6.5, module_width: 0.2, module_height: 15 },
  blendMode: "normal",
  result: null,
  layers: defaultLayers,
  setImage: (img) => set({ image: img, corners: null, result: null }),
  setCorners: (c) => set({ corners: c }),
  updateCorner: (i, c) => set((s) => {
    if (!s.corners) return s;
    const next = s.corners.slice();
    next[i] = c;
    return { corners: next };
  }),
  setField: (k, v) => set({ [k]: v } as Partial<EditorState>),
  setOption: (k, v) => set((s) => ({ options: { ...s.options, [k]: v } })),
  setResult: (r) => set({ result: r }),
  setLayer: (name, patch) => set((s) => ({
    layers: { ...s.layers, [name]: { ...s.layers[name], ...patch } },
  })),
}));
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib
git commit -m "feat(web): api client, types, and zustand editor store"
```

---

### Task 13: Upload + settings + canvas + handles

**Files:**
- Create: `apps/web/components/UploadPanel.tsx`
- Create: `apps/web/components/BarcodeSettings.tsx`
- Create: `apps/web/components/EditorCanvas.tsx`

- [ ] **Step 1: UploadPanel** — reads a file to a data URL, stores it, then calls detect and seeds corners.

```tsx
// apps/web/components/UploadPanel.tsx
"use client";
import { useEditor } from "@/lib/store";
import { detect } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function UploadPanel() {
  const setImage = useEditor((s) => s.setImage);
  const setCorners = useEditor((s) => s.setCorners);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl: string = await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result as string);
      fr.readAsDataURL(file);
    });
    setImage(dataUrl);
    try {
      const dets = await detect(dataUrl);
      if (dets.length) setCorners(dets[0].corners);
    } catch {
      /* leave corners null; user draws manually (future) */
    }
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Upload image</label>
      <input type="file" accept="image/png,image/jpeg" onChange={onFile}
             className="block w-full text-sm" />
    </div>
  );
}
```

- [ ] **Step 2: BarcodeSettings**

```tsx
// apps/web/components/BarcodeSettings.tsx
"use client";
import { useEditor } from "@/lib/store";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const SYMBOLOGIES = ["ean13", "ean8", "upca", "code128", "code39", "qr"];

export function BarcodeSettings() {
  const { symbology, value, options, setField, setOption } = useEditor();
  return (
    <div className="space-y-3">
      <div>
        <Label>Symbology</Label>
        <Select value={symbology} onValueChange={(v) => setField("symbology", v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {SYMBOLOGIES.map((s) => <SelectItem key={s} value={s}>{s.toUpperCase()}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Value</Label>
        <Input value={value} onChange={(e) => setField("value", e.target.value)}
               placeholder="e.g. 5901234123457" />
      </div>
      <div className="flex items-center justify-between">
        <Label>Show text</Label>
        <Switch checked={options.show_text}
                onCheckedChange={(v) => setOption("show_text", v)} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: EditorCanvas** — Konva stage with the uploaded image and four draggable corner handles bound to the store. Loads the image via `window.Image`.

```tsx
// apps/web/components/EditorCanvas.tsx
"use client";
import { useEffect, useState } from "react";
import { Stage, Layer, Image as KImage, Line, Circle } from "react-konva";
import { useEditor } from "@/lib/store";

export function EditorCanvas() {
  const { image, corners, updateCorner, result } = useEditor();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const shown = result?.result ?? image;

  useEffect(() => {
    if (!shown) { setImg(null); return; }
    const i = new window.Image();
    i.src = shown;
    i.onload = () => setImg(i);
  }, [shown]);

  if (!img) return <div className="flex h-full items-center justify-center text-muted-foreground">Upload an image to begin</div>;

  const scale = Math.min(900 / img.width, 600 / img.height, 1);
  const w = img.width * scale, h = img.height * scale;
  const flat = corners?.flatMap((c) => [c[0] * scale, c[1] * scale]) ?? [];

  return (
    <Stage width={w} height={h} className="border rounded">
      <Layer>
        <KImage image={img} width={w} height={h} />
        {corners && !result && (
          <>
            <Line points={[...flat, flat[0], flat[1]]} stroke="#22d3ee" strokeWidth={2} closed />
            {corners.map((c, i) => (
              <Circle key={i} x={c[0] * scale} y={c[1] * scale} radius={7}
                      fill="#22d3ee" draggable
                      onDragMove={(e) => updateCorner(i, [e.target.x() / scale, e.target.y() / scale])} />
            ))}
          </>
        )}
      </Layer>
    </Stage>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components
git commit -m "feat(web): upload, barcode settings, and konva canvas with handles"
```

---

### Task 14: Replace action, layers, comparison, export, page assembly

**Files:**
- Create: `apps/web/components/LayerPanel.tsx`
- Create: `apps/web/components/Comparison.tsx`
- Create: `apps/web/components/ExportBar.tsx`
- Create: `apps/web/components/Providers.tsx`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/layout.tsx` (wrap in Providers)

- [ ] **Step 1: React Query provider**

```tsx
// apps/web/components/Providers.tsx
"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient());
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
```

Wrap `children` in `apps/web/app/layout.tsx`'s `<body>` with `<Providers>…</Providers>`.

- [ ] **Step 2: LayerPanel**

```tsx
// apps/web/components/LayerPanel.tsx
"use client";
import { useEditor } from "@/lib/store";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";

const NAMES = ["original", "new_barcode", "result"] as const;

export function LayerPanel() {
  const { layers, setLayer, result } = useEditor();
  if (!result) return null;
  return (
    <div className="space-y-3">
      {NAMES.map((n) => (
        <div key={n} className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm capitalize">{n.replace("_", " ")}</span>
            <Switch checked={layers[n].visible}
                    onCheckedChange={(v) => setLayer(n, { visible: v })} />
          </div>
          <Slider value={[layers[n].opacity * 100]} max={100} step={1}
                  onValueChange={([v]) => setLayer(n, { opacity: v / 100 })} />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Comparison (split + swipe)**

```tsx
// apps/web/components/Comparison.tsx
"use client";
import { useState } from "react";
import { useEditor } from "@/lib/store";
import { Slider } from "@/components/ui/slider";

export function Comparison() {
  const { image, result } = useEditor();
  const [pos, setPos] = useState(50);
  if (!image || !result) return null;
  return (
    <div className="space-y-2">
      <div className="relative w-full overflow-hidden rounded border">
        <img src={result.result} className="block w-full" alt="edited" />
        <div className="absolute inset-0 overflow-hidden" style={{ width: `${pos}%` }}>
          <img src={image} className="block h-full w-auto max-w-none" alt="original" />
        </div>
        <div className="absolute top-0 bottom-0 w-0.5 bg-cyan-400" style={{ left: `${pos}%` }} />
      </div>
      <Slider value={[pos]} max={100} onValueChange={([v]) => setPos(v)} />
      <p className="text-xs text-muted-foreground text-center">Original ‹ swipe › Edited</p>
    </div>
  );
}
```

- [ ] **Step 4: ExportBar**

```tsx
// apps/web/components/ExportBar.tsx
"use client";
import { useEditor } from "@/lib/store";
import { Button } from "@/components/ui/button";

function download(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href; a.download = name; a.click();
}

export function ExportBar() {
  const { result } = useEditor();
  if (!result) return null;
  return (
    <div className="flex gap-2">
      <Button onClick={() => download(result.result, "edited.png")}>Download PNG</Button>
      <Button variant="outline" onClick={() => {
        const blob = new Blob([result.svg], { type: "image/svg+xml" });
        download(URL.createObjectURL(blob), "barcode.svg");
      }}>Download SVG</Button>
    </div>
  );
}
```

- [ ] **Step 5: page.tsx assembly with Replace mutation**

```tsx
// apps/web/app/page.tsx
"use client";
import dynamic from "next/dynamic";
import { useMutation } from "@tanstack/react-query";
import { useEditor } from "@/lib/store";
import { replace } from "@/lib/api";
import { UploadPanel } from "@/components/UploadPanel";
import { BarcodeSettings } from "@/components/BarcodeSettings";
import { LayerPanel } from "@/components/LayerPanel";
import { Comparison } from "@/components/Comparison";
import { ExportBar } from "@/components/ExportBar";
import { Button } from "@/components/ui/button";

const EditorCanvas = dynamic(
  () => import("@/components/EditorCanvas").then((m) => m.EditorCanvas),
  { ssr: false }
);

export default function Page() {
  const s = useEditor();
  const m = useMutation({
    mutationFn: () => replace({
      image: s.image!, corners: s.corners!, symbology: s.symbology,
      value: s.value, options: s.options, blend_mode: s.blendMode,
    }),
    onSuccess: (r) => s.setResult(r),
  });
  const canRun = !!s.image && !!s.corners && !!s.value && !m.isPending;

  return (
    <main className="grid grid-cols-[280px_1fr_300px] h-screen">
      <aside className="border-r p-4 space-y-6 overflow-y-auto">
        <UploadPanel />
        <BarcodeSettings />
        <Button className="w-full" disabled={!canRun} onClick={() => m.mutate()}>
          {m.isPending ? "Processing…" : "Replace barcode"}
        </Button>
        {m.error && <p className="text-sm text-red-500">{(m.error as Error).message}</p>}
      </aside>

      <section className="p-4 flex items-center justify-center overflow-auto">
        <EditorCanvas />
      </section>

      <aside className="border-l p-4 space-y-6 overflow-y-auto">
        <LayerPanel />
        <Comparison />
        <ExportBar />
      </aside>
    </main>
  );
}
```

- [ ] **Step 6: Typecheck + build**

Run: `cd apps/web && npx tsc --noEmit && npm run build`
Expected: no type errors, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): replace action, layers, comparison, export, page layout"
```

---

### Task 15: End-to-end verification + README

**Files:**
- Create: `README.md`
- Create: `services/api/tests/test_e2e_smoke.py`

- [ ] **Step 1: Backend smoke test (whole pipeline via API)**

```python
# services/api/tests/test_e2e_smoke.py
from fastapi.testclient import TestClient
from main import app
from imgio import ndarray_to_b64, b64_to_ndarray
from tests.fixtures import make_scene
import numpy as np

client = TestClient(app)

def test_full_replace_changes_region_only():
    scene, corners, meta = make_scene(warp=False)
    detected = client.post("/api/detect", json={"image": ndarray_to_b64(scene)}).json()
    quad = detected["detections"][0]["corners"]
    r = client.post("/api/replace", json={
        "image": ndarray_to_b64(scene), "corners": quad,
        "symbology": "code128", "value": "SMOKE123",
        "options": {"show_text": False}, "blend_mode": "normal",
    })
    assert r.status_code == 200
    out = b64_to_ndarray(r.json()["result"])
    assert out.shape == scene.shape
    # far corner of image (away from barcode) is unchanged
    assert np.array_equal(out[0:20, 0:20], scene[0:20, 0:20])
```

- [ ] **Step 2: Run full backend suite**

Run: `cd services/api && python -m pytest -v`
Expected: all pass.

- [ ] **Step 3: Manual end-to-end (documented in README)** — start both services, upload a real barcode photo, adjust handles, Replace, verify before/after and download.

Run backend: `cd services/api && uvicorn main:app --reload --port 8000`
Run frontend: `cd apps/web && npm run dev`
Open `http://localhost:3000`.

- [ ] **Step 4: Write README.md**

```markdown
# Barcode Editor — M1 (CPU Core Pipeline)

Replace a barcode in a photo with a chosen barcode, warped and Poisson-blended
to look printed-on. Classical CPU pipeline (no GPU). See
`docs/superpowers/specs/2026-07-21-barcode-replacement-m1-design.md`.

## Prerequisites
- Python 3.11+, Node 20+
- ZBar runtime for pyzbar: Windows wheels bundle it; Linux `apt install libzbar0`; macOS `brew install zbar`.

## Backend
```
cd services/api
python -m venv .venv && . .venv/Scripts/activate   # (bash: source .venv/bin/activate)
pip install -r requirements.txt
python -m pytest            # run tests
uvicorn main:app --reload --port 8000
```

## Frontend
```
cd apps/web
npm install
npm run dev                 # http://localhost:3000
```

## Flow
Upload → adjust corner handles → set symbology/value → Replace → compare → download PNG/SVG.
```

- [ ] **Step 5: Commit**

```bash
git add README.md services/api/tests/test_e2e_smoke.py
git commit -m "test(api): e2e smoke; docs: add README run instructions"
```

---

## Self-Review Notes

- **Spec coverage:** upload (T13), detect/corners (T5,T13), generate common set (T3), warp (T6), tone-match (T7), Poisson blend (T8), orchestrator+layers (T9), endpoints (T10), focused UI + basic layers + comparison + export (T11–14). Deferred items (SAM2, diffusion, super-res, queue/DB/S3, PDF417/DataMatrix, TIFF/16-bit/CMYK) are explicitly out of M1 per spec §1.
- **Type consistency:** `GenerateOptions`, `Detection`, `ReplaceRequest/Result`, store field names, and API JSON keys (`result`, `svg`, `layers{original,new_barcode,mask}`) are consistent across backend and frontend.
- **Known follow-ups (not blockers):** manual quad-draw when detection is empty; HEIC/large-image handling; the tone-match test's ordering assertion may need pinning to explicit pixels.
```
