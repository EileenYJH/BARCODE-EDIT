# SAM2 Label Segmentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-process SAM2 segmentation stage (`pipeline/segment.py`) that produces a label-boundary mask, a refined barcode mask, and unclassified candidate sub-region masks, wired additively (non-breaking) into `replace_barcode()` and exposed via a new `/api/segment` route.

**Architecture:** A lazily-loaded, module-level singleton SAM2 model (tiny checkpoint, CPU/MPS/CUDA auto-detect) lives in `pipeline/segment.py`. `segment_label()` uses the existing classical barcode corners as a box prompt to refine a barcode mask, runs SAM2's automatic mask generator over the full image to find a label-boundary candidate and unclassified sub-regions, and wraps all failures in a single `SegmentationError`. The orchestrator calls it in a try/except so segmentation is purely additive — existing behavior is byte-for-byte unchanged when SAM2 is unavailable.

**Tech Stack:** Python 3.14, existing `services/api` FastAPI backend, `torch` + SAM2 (official `sam2` package, or `transformers`' SAM2 port as fallback — resolved in Task 1), `opencv-contrib-python` (already a dependency), `pytest`.

Spec: [`docs/superpowers/specs/2026-07-23-sam2-segmentation-design.md`](../specs/2026-07-23-sam2-segmentation-design.md)

---

### Task 1: Python 3.14 compatibility spike & dependency pinning

**Files:**
- Modify: `services/api/requirements.txt`

- [ ] **Step 1: Try installing the official SAM2 package + CPU torch**

Run (from `services/api`, with `.venv` activated):
```bash
.venv/Scripts/python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv/Scripts/python.exe -m pip install "sam2 @ git+https://github.com/facebookresearch/sam2.git"
```
Then verify importability:
```bash
.venv/Scripts/python.exe -c "import torch; from sam2.build_sam import build_sam2; print(torch.__version__, 'ok')"
```
Expected: either prints a version and "ok", or fails with an install/import error.

- [ ] **Step 2: If Step 1 failed, try the `transformers` SAM2 port instead**

Run:
```bash
.venv/Scripts/python.exe -m pip install transformers accelerate
.venv/Scripts/python.exe -c "from transformers import Sam2Model, Sam2Processor; print('ok')"
```
Expected: prints "ok", or fails.

- [ ] **Step 3: If both failed, fall back to a Python 3.12 sub-venv**

```bash
py -3.12 -m venv services/api/.venv-sam
services/api/.venv-sam/Scripts/python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cpu
services/api/.venv-sam/Scripts/python.exe -m pip install "sam2 @ git+https://github.com/facebookresearch/sam2.git"
```
If this path is needed, `pipeline/segment.py` (Task 3) must shell out to this sub-venv via `subprocess` instead of importing SAM2 directly — note this in a comment at the top of `segment.py` and adjust Task 3's `_load_model()` accordingly before proceeding. This is a larger structural change than Tasks 3–6 assume, so pause and confirm with the user before continuing if you land here.

- [ ] **Step 4: Record the working path in `requirements.txt` and commit**

Append the dependencies that actually worked (Step 1 or Step 2) to `services/api/requirements.txt`, e.g. if Step 1 worked:
```
torch==<installed-version>
sam2 @ git+https://github.com/facebookresearch/sam2.git@<commit-sha-installed>
```
or if Step 2 worked:
```
transformers==<installed-version>
accelerate==<installed-version>
```

```bash
git add services/api/requirements.txt
git commit -m "chore: pin SAM2/torch dependencies after Python 3.14 compat spike"
```

---

### Task 2: Checkpoint download script + gitignore

**Files:**
- Create: `services/api/scripts/download_sam2_checkpoint.py`
- Modify: `.gitignore`

- [ ] **Step 1: Add the models directory to `.gitignore`**

Add this line to the root `.gitignore` (alongside the existing `services/api/storage/` line):
```
services/api/models/
```

- [ ] **Step 2: Write the download script**

Create `services/api/scripts/download_sam2_checkpoint.py`:
```python
"""Download the SAM2 tiny checkpoint into services/api/models/.

Usage: python scripts/download_sam2_checkpoint.py
"""
import os
import sys
import urllib.request
from pathlib import Path

# Verify this URL against https://github.com/facebookresearch/sam2's
# download_ckpts.sh before relying on it -- Meta's hosting paths have
# changed between SAM2 releases.
CHECKPOINT_URL = "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt"
MODELS_DIR = Path(os.environ.get("SAM2_MODELS_DIR", Path(__file__).resolve().parent.parent / "models"))
DEST = MODELS_DIR / "sam2.1_hiera_tiny.pt"


def main() -> int:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    if DEST.exists():
        print(f"already downloaded: {DEST}")
        return 0
    print(f"downloading {CHECKPOINT_URL} -> {DEST}")
    urllib.request.urlretrieve(CHECKPOINT_URL, DEST)
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore services/api/scripts/download_sam2_checkpoint.py
git commit -m "feat: add SAM2 checkpoint download script"
```

---

### Task 3: `pipeline/segment.py` skeleton — errors, device detection, lazy loader

**Files:**
- Create: `services/api/pipeline/segment.py`
- Test: `services/api/tests/test_segment.py`

- [ ] **Step 1: Write the failing tests**

Create `services/api/tests/test_segment.py`:
```python
import numpy as np
import pytest
from pipeline import segment


def test_checkpoint_path_missing_raises_segmentation_error(monkeypatch, tmp_path):
    monkeypatch.setenv("SAM2_MODELS_DIR", str(tmp_path))
    segment._MODEL_STATE["predictor"] = None
    segment._MODEL_STATE["mask_generator"] = None
    with pytest.raises(segment.SegmentationError, match="checkpoint not found"):
        segment._load_model()


def test_detect_device_prefers_cuda(monkeypatch):
    class FakeCuda:
        @staticmethod
        def is_available():
            return True

    class FakeTorch:
        cuda = FakeCuda()

    monkeypatch.setattr(segment, "_import_torch", lambda: FakeTorch())
    assert segment._detect_device() == "cuda"


def test_detect_device_falls_back_to_cpu(monkeypatch):
    class FakeBackendsMps:
        @staticmethod
        def is_available():
            return False

    class FakeBackends:
        mps = FakeBackendsMps()

    class FakeCuda:
        @staticmethod
        def is_available():
            return False

    class FakeTorch:
        cuda = FakeCuda()
        backends = FakeBackends()

    monkeypatch.setattr(segment, "_import_torch", lambda: FakeTorch())
    assert segment._detect_device() == "cpu"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd services/api && .venv/Scripts/python.exe -m pytest tests/test_segment.py -v
```
Expected: FAIL with `ModuleNotFoundError` or `AttributeError` (`pipeline.segment` doesn't exist yet).

- [ ] **Step 3: Write `pipeline/segment.py`**

Create `services/api/pipeline/segment.py`:
```python
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional
import logging
import os

import numpy as np

logger = logging.getLogger(__name__)


class SegmentationError(Exception):
    """Raised whenever SAM2 segmentation cannot be performed."""


@dataclass
class SegmentationResult:
    label_mask: np.ndarray               # uint8 mask (0/255), full label boundary
    barcode_mask: np.ndarray             # uint8 mask (0/255), SAM2-refined barcode region
    candidate_regions: List[np.ndarray]  # unclassified uint8 masks within the label


_MODEL_STATE = {"predictor": None, "mask_generator": None, "device": None}


def _import_torch():
    import torch
    return torch


def _detect_device() -> str:
    torch = _import_torch()
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _checkpoint_path() -> Path:
    root = Path(os.environ.get(
        "SAM2_MODELS_DIR",
        Path(__file__).resolve().parent.parent / "models",
    ))
    return root / "sam2.1_hiera_tiny.pt"


def _load_model():
    """Lazily load and cache the SAM2 predictor + automatic mask generator."""
    if _MODEL_STATE["predictor"] is not None:
        return _MODEL_STATE["predictor"], _MODEL_STATE["mask_generator"]

    checkpoint = _checkpoint_path()
    if not checkpoint.exists():
        raise SegmentationError(
            f"SAM2 checkpoint not found at {checkpoint}. "
            "Run scripts/download_sam2_checkpoint.py first."
        )

    try:
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor
        from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator
    except ImportError as e:
        raise SegmentationError(f"SAM2/torch not installed: {e}") from e

    device = _detect_device()
    try:
        model = build_sam2("configs/sam2.1/sam2.1_hiera_t.yaml", str(checkpoint), device=device)
        predictor = SAM2ImagePredictor(model)
        mask_generator = SAM2AutomaticMaskGenerator(model)
    except Exception as e:
        raise SegmentationError(f"failed to load SAM2 model: {e}") from e

    _MODEL_STATE["predictor"] = predictor
    _MODEL_STATE["mask_generator"] = mask_generator
    _MODEL_STATE["device"] = device
    return predictor, mask_generator
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd services/api && .venv/Scripts/python.exe -m pytest tests/test_segment.py -v
```
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add services/api/pipeline/segment.py services/api/tests/test_segment.py
git commit -m "feat: add SAM2 segmentation module skeleton (errors, device detect, lazy loader)"
```

---

### Task 4: Barcode mask via box prompt

**Files:**
- Modify: `services/api/pipeline/segment.py`
- Test: `services/api/tests/test_segment.py`

- [ ] **Step 1: Write the failing test**

Append to `services/api/tests/test_segment.py`:
```python
def test_box_from_corners_returns_xyxy():
    corners = np.float32([[10, 20], [110, 20], [110, 220], [10, 220]])
    box = segment._box_from_corners(corners)
    assert box.tolist() == pytest.approx([10.0, 20.0, 110.0, 220.0])
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd services/api && .venv/Scripts/python.exe -m pytest tests/test_segment.py::test_box_from_corners_returns_xyxy -v
```
Expected: FAIL with `AttributeError: module 'pipeline.segment' has no attribute '_box_from_corners'`.

- [ ] **Step 3: Add `_box_from_corners` to `pipeline/segment.py`**

Add below `_load_model`:
```python
def _box_from_corners(corners: np.ndarray) -> np.ndarray:
    """Convert a (4,2) quad into a SAM2 box prompt [x0, y0, x1, y1]."""
    corners = np.asarray(corners, dtype=np.float32)
    x0, y0 = corners.min(axis=0)
    x1, y1 = corners.max(axis=0)
    return np.array([x0, y0, x1, y1], dtype=np.float32)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd services/api && .venv/Scripts/python.exe -m pytest tests/test_segment.py::test_box_from_corners_returns_xyxy -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/pipeline/segment.py services/api/tests/test_segment.py
git commit -m "feat: derive SAM2 box prompt from barcode corners"
```

---

### Task 5: Label mask selection heuristic

**Files:**
- Modify: `services/api/pipeline/segment.py`
- Test: `services/api/tests/test_segment.py`

- [ ] **Step 1: Write the failing tests**

Append to `services/api/tests/test_segment.py`:
```python
def _square_mask(h, w, x0, y0, x1, y1):
    m = np.zeros((h, w), dtype=np.uint8)
    m[y0:y1, x0:x1] = 255
    return m


def test_select_label_mask_picks_largest_enclosing_candidate():
    barcode_mask = _square_mask(100, 100, 40, 40, 60, 60)  # small, centered
    small_unrelated = _square_mask(100, 100, 0, 0, 10, 10)
    label_candidate = _square_mask(100, 100, 20, 20, 80, 80)  # encloses barcode
    masks = [
        {"segmentation": small_unrelated.astype(bool), "area": 100},
        {"segmentation": label_candidate.astype(bool), "area": 3600},
    ]
    selected = segment._select_label_mask(masks, barcode_mask)
    assert np.array_equal(selected, label_candidate)


def test_select_label_mask_falls_back_to_barcode_mask_when_nothing_encloses_it():
    barcode_mask = _square_mask(100, 100, 40, 40, 60, 60)
    unrelated = _square_mask(100, 100, 0, 0, 10, 10)
    masks = [{"segmentation": unrelated.astype(bool), "area": 100}]
    selected = segment._select_label_mask(masks, barcode_mask)
    assert np.array_equal(selected, barcode_mask)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd services/api && .venv/Scripts/python.exe -m pytest tests/test_segment.py -k select_label_mask -v
```
Expected: FAIL with `AttributeError`.

- [ ] **Step 3: Add `_select_label_mask` to `pipeline/segment.py`**

```python
def _select_label_mask(masks: List[dict], barcode_mask: np.ndarray) -> np.ndarray:
    """Pick the automatic-mask-generator candidate that best encloses the barcode.

    SAM2's automatic mask generator has no notion of "this is the label" --
    it just returns candidate regions. We heuristically pick the largest
    candidate that contains at least 90% of the barcode mask's area, on the
    assumption the label is bigger than and contains the barcode. This is a
    best-effort MVP; true layout understanding is deferred (see spec).
    """
    barcode_area = float(barcode_mask.sum())
    if barcode_area == 0:
        return barcode_mask.copy()

    best, best_area = None, -1.0
    for m in masks:
        seg = (np.asarray(m["segmentation"]).astype(np.uint8)) * 255
        overlap = float(np.logical_and(seg > 0, barcode_mask > 0).sum())
        containment = overlap / barcode_area
        if containment < 0.9:
            continue
        area = float(m.get("area", (seg > 0).sum()))
        if area > best_area:
            best, best_area = seg, area

    return best if best is not None else barcode_mask.copy()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd services/api && .venv/Scripts/python.exe -m pytest tests/test_segment.py -k select_label_mask -v
```
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add services/api/pipeline/segment.py services/api/tests/test_segment.py
git commit -m "feat: add label-mask selection heuristic"
```

---

### Task 6: `segment_label()` — full integration with stubbed model

**Files:**
- Modify: `services/api/pipeline/segment.py`
- Test: `services/api/tests/test_segment.py`

- [ ] **Step 1: Write the failing tests**

Append to `services/api/tests/test_segment.py`:
```python
class _FakePredictor:
    def set_image(self, img):
        self.img_shape = img.shape[:2]

    def predict(self, box, multimask_output):
        h, w = self.img_shape
        mask = _square_mask(h, w, int(box[0][0]), int(box[0][1]), int(box[0][2]), int(box[0][3]))
        return np.array([mask.astype(bool)]), np.array([0.9]), None


class _FakeMaskGenerator:
    def __init__(self, extra_masks):
        self.extra_masks = extra_masks

    def generate(self, img):
        return self.extra_masks


def test_segment_label_returns_full_result(monkeypatch):
    h, w = 100, 100
    barcode_box_mask = _square_mask(h, w, 40, 40, 60, 60)
    label_mask = _square_mask(h, w, 20, 20, 80, 80)
    other_region = _square_mask(h, w, 25, 60, 35, 70)          # inside label, not barcode
    outside_region = _square_mask(h, w, 0, 0, 10, 10)          # outside label

    fake_masks = [
        {"segmentation": label_mask.astype(bool), "area": 3600},
        {"segmentation": other_region.astype(bool), "area": 100},
        {"segmentation": outside_region.astype(bool), "area": 100},
    ]

    monkeypatch.setattr(
        segment, "_load_model",
        lambda: (_FakePredictor(), _FakeMaskGenerator(fake_masks)),
    )

    img = np.zeros((h, w, 3), dtype=np.uint8)
    corners = np.float32([[40, 40], [60, 40], [60, 60], [40, 60]])
    result = segment.segment_label(img, barcode_corners=corners)

    assert np.array_equal(result.label_mask, label_mask)
    assert result.barcode_mask.sum() > 0
    assert len(result.candidate_regions) == 1
    assert np.array_equal(result.candidate_regions[0], other_region)


def test_segment_label_wraps_unexpected_errors(monkeypatch):
    def _boom():
        raise RuntimeError("gpu exploded")

    monkeypatch.setattr(segment, "_load_model", _boom)
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    with pytest.raises(segment.SegmentationError, match="segmentation failed"):
        segment.segment_label(img)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd services/api && .venv/Scripts/python.exe -m pytest tests/test_segment.py -k segment_label -v
```
Expected: FAIL with `AttributeError: module 'pipeline.segment' has no attribute 'segment_label'`.

- [ ] **Step 3: Add `segment_label` to `pipeline/segment.py`**

```python
def segment_label(img: np.ndarray, barcode_corners: Optional[np.ndarray] = None) -> SegmentationResult:
    """Segment the full label boundary, a refined barcode mask, and candidate
    unclassified sub-regions from a product photo.

    Raises SegmentationError on any failure (missing weights, unsupported
    environment, or unexpected model error) -- callers should treat this
    stage as optional and degrade gracefully.
    """
    try:
        predictor, mask_generator = _load_model()
        predictor.set_image(img)

        h, w = img.shape[:2]
        if barcode_corners is not None:
            box = _box_from_corners(np.asarray(barcode_corners, dtype=np.float32))
            masks, _scores, _logits = predictor.predict(box=box[None, :], multimask_output=False)
            barcode_mask = (np.asarray(masks[0]) > 0).astype(np.uint8) * 255
        else:
            barcode_mask = np.zeros((h, w), dtype=np.uint8)

        auto_masks = mask_generator.generate(img)
        label_mask = _select_label_mask(auto_masks, barcode_mask)

        candidate_regions: List[np.ndarray] = []
        for m in auto_masks:
            seg = (np.asarray(m["segmentation"]).astype(np.uint8)) * 255
            if np.array_equal(seg, label_mask):
                continue
            seg_area = float((seg > 0).sum())
            if seg_area == 0:
                continue
            inside = float(np.logical_and(seg > 0, label_mask > 0).sum())
            if inside / seg_area < 0.5:
                continue  # not substantially within the label boundary
            candidate_regions.append(seg)

        return SegmentationResult(
            label_mask=label_mask,
            barcode_mask=barcode_mask,
            candidate_regions=candidate_regions,
        )
    except SegmentationError:
        raise
    except Exception as e:
        raise SegmentationError(f"segmentation failed: {e}") from e
```

- [ ] **Step 4: Run full segment test file to verify everything passes**

```bash
cd services/api && .venv/Scripts/python.exe -m pytest tests/test_segment.py -v
```
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add services/api/pipeline/segment.py services/api/tests/test_segment.py
git commit -m "feat: implement segment_label() end-to-end with stubbed-model tests"
```

---

### Task 7: Wire into `orchestrator.py` (additive, non-blocking)

**Files:**
- Modify: `services/api/pipeline/orchestrator.py`
- Test: `services/api/tests/test_orchestrator.py`

- [ ] **Step 1: Write the failing tests**

Append to `services/api/tests/test_orchestrator.py`:
```python
from unittest.mock import patch
from pipeline import segment


def test_replace_barcode_omits_segmentation_layers_when_sam2_unavailable():
    scene, corners, meta = make_scene(warp=False)
    req = ReplaceRequest(
        image=scene, corners=corners, symbology="code128",
        value="NEWVALUE", options=GenerateOptions(show_text=False),
        blend_mode="normal",
    )
    # No weights/torch present in the default test env -> segment_label raises.
    res = replace_barcode(req)
    assert set(res.layers.keys()) == {"original", "new_barcode", "mask"}


def test_replace_barcode_adds_segmentation_layers_when_available():
    scene, corners, meta = make_scene(warp=False)
    h, w = scene.shape[:2]
    fake_result = segment.SegmentationResult(
        label_mask=np.full((h, w), 255, dtype=np.uint8),
        barcode_mask=np.full((h, w), 255, dtype=np.uint8),
        candidate_regions=[np.full((h, w), 255, dtype=np.uint8)],
    )
    req = ReplaceRequest(
        image=scene, corners=corners, symbology="code128",
        value="NEWVALUE", options=GenerateOptions(show_text=False),
        blend_mode="normal",
    )
    with patch("pipeline.orchestrator.segment_label", return_value=fake_result):
        res = replace_barcode(req)
    assert set(res.layers.keys()) == {
        "original", "new_barcode", "mask",
        "label_mask", "sam_barcode_mask", "candidate_regions",
    }
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd services/api && .venv/Scripts/python.exe -m pytest tests/test_orchestrator.py -k segmentation -v
```
Expected: first test passes already (no behavior change yet), second FAILS (`AssertionError`, keys not present / `patch` target doesn't exist yet).

- [ ] **Step 3: Wire `segment_label` into `orchestrator.py`**

Modify `services/api/pipeline/orchestrator.py` imports (top of file):
```python
from dataclasses import dataclass, field
from typing import Dict
import logging
import numpy as np
import cv2
from pipeline.generate import generate_barcode_fit, GenerateOptions, GenerateResult
from pipeline.warp import warp_onto, quad_aspect_ratio
from pipeline.tone import match_tone
from pipeline.blend import seamless_blend
from pipeline.segment import segment_label, SegmentationError

logger = logging.getLogger(__name__)
```

Modify the end of `replace_barcode()` (replace the current final block, from `new_barcode_layer = ...` to the `return`):
```python
    new_barcode_layer = np.zeros_like(req.image)
    new_barcode_layer[alpha > 0] = toned[alpha > 0]

    layers = {
        "original": req.image.copy(),
        "new_barcode": new_barcode_layer,
        "mask": cv2.cvtColor(alpha, cv2.COLOR_GRAY2BGR),
    }

    try:
        seg = segment_label(req.image, req.corners)
        layers["label_mask"] = cv2.cvtColor(seg.label_mask, cv2.COLOR_GRAY2BGR)
        layers["sam_barcode_mask"] = cv2.cvtColor(seg.barcode_mask, cv2.COLOR_GRAY2BGR)
        if seg.candidate_regions:
            flattened = np.zeros_like(seg.label_mask)
            for region in seg.candidate_regions:
                flattened = cv2.bitwise_or(flattened, region)
            layers["candidate_regions"] = cv2.cvtColor(flattened, cv2.COLOR_GRAY2BGR)
    except SegmentationError:
        logger.warning("SAM2 segmentation unavailable, skipping", exc_info=True)

    return ReplaceResult(
        result=result,
        svg=gen.svg,
        layers=layers,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd services/api && .venv/Scripts/python.exe -m pytest tests/test_orchestrator.py -v
```
Expected: PASS (all tests, including the pre-existing ones).

- [ ] **Step 5: Run the full backend suite to confirm no regressions**

```bash
cd services/api && .venv/Scripts/python.exe -m pytest tests/ -v
```
Expected: all tests PASS, including `tests/test_routes.py::test_replace_endpoint_returns_result` which asserts the exact `{"original", "new_barcode", "mask"}` key set (segmentation stays silently skipped without weights, so this still holds).

- [ ] **Step 6: Commit**

```bash
git add services/api/pipeline/orchestrator.py services/api/tests/test_orchestrator.py
git commit -m "feat: wire SAM2 segmentation into orchestrator additively"
```

---

### Task 8: `/api/segment` route

**Files:**
- Modify: `services/api/schemas.py`
- Modify: `services/api/routes.py`
- Test: `services/api/tests/test_routes.py`

- [ ] **Step 1: Add request/response schemas**

Append to `services/api/schemas.py`:
```python
class SegmentRequest(BaseModel):
    image: str  # data URL
    corners: Optional[List[List[float]]] = None  # optional barcode-box prompt

class SegmentResponse(BaseModel):
    label_mask: str
    barcode_mask: str
    candidate_regions: List[str]
```

- [ ] **Step 2: Write the failing tests**

Append to `services/api/tests/test_routes.py`:
```python
import numpy as np
from unittest.mock import patch
from pipeline import segment


def test_segment_endpoint_returns_masks():
    scene, corners, meta = make_scene(warp=False)
    h, w = scene.shape[:2]
    fake_result = segment.SegmentationResult(
        label_mask=np.full((h, w), 255, dtype=np.uint8),
        barcode_mask=np.full((h, w), 255, dtype=np.uint8),
        candidate_regions=[np.full((h, w), 255, dtype=np.uint8)],
    )
    payload = {"image": ndarray_to_b64(scene), "corners": corners.tolist()}
    with patch("routes.segment_label", return_value=fake_result):
        r = client.post("/api/segment", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["label_mask"].startswith("data:image/png;base64,")
    assert body["barcode_mask"].startswith("data:image/png;base64,")
    assert len(body["candidate_regions"]) == 1


def test_segment_endpoint_returns_422_when_sam2_unavailable():
    scene, corners, meta = make_scene(warp=False)
    payload = {"image": ndarray_to_b64(scene), "corners": corners.tolist()}
    r = client.post("/api/segment", json=payload)
    # No weights/torch present in the default test env.
    assert r.status_code == 422
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd services/api && .venv/Scripts/python.exe -m pytest tests/test_routes.py -k segment_endpoint -v
```
Expected: FAIL with 404 (route doesn't exist yet).

- [ ] **Step 4: Add the route to `routes.py`**

Modify `services/api/routes.py` imports at the top:
```python
import numpy as np
from fastapi import APIRouter, HTTPException
from imgio import b64_to_ndarray, ndarray_to_b64
from schemas import (DetectRequest, DetectResponse, DetectionOut,
                     ReplaceRequestIn, ReplaceResponse,
                     SegmentRequest, SegmentResponse)
from pipeline.detect import detect_barcodes
from pipeline.generate import GenerateOptions, GenerateError
from pipeline.orchestrator import replace_barcode, ReplaceRequest
from pipeline.segment import segment_label, SegmentationError
```

Append the new route at the end of `routes.py`:
```python
@router.post("/segment", response_model=SegmentResponse)
def segment(req: SegmentRequest):
    try:
        img = b64_to_ndarray(req.image)
    except ValueError:
        raise HTTPException(status_code=415, detail="unreadable image")
    corners = np.float32(req.corners) if req.corners is not None else None
    try:
        res = segment_label(img, barcode_corners=corners)
    except SegmentationError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return SegmentResponse(
        label_mask=ndarray_to_b64(res.label_mask),
        barcode_mask=ndarray_to_b64(res.barcode_mask),
        candidate_regions=[ndarray_to_b64(r) for r in res.candidate_regions],
    )
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd services/api && .venv/Scripts/python.exe -m pytest tests/test_routes.py -v
```
Expected: PASS (all tests, including pre-existing ones).

- [ ] **Step 6: Run the full backend suite**

```bash
cd services/api && .venv/Scripts/python.exe -m pytest tests/ -v
```
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add services/api/schemas.py services/api/routes.py services/api/tests/test_routes.py
git commit -m "feat: add /api/segment endpoint"
```

---

### Task 9: Opt-in real-inference test

**Files:**
- Test: `services/api/tests/test_segment.py`

- [ ] **Step 1: Add a real-model smoke test, skipped by default**

Append to `services/api/tests/test_segment.py`:
```python
def _weights_available() -> bool:
    return segment._checkpoint_path().exists()


@pytest.mark.skipif(not _weights_available(), reason="SAM2 checkpoint not downloaded")
def test_segment_label_real_inference_smoke():
    segment._MODEL_STATE["predictor"] = None
    segment._MODEL_STATE["mask_generator"] = None
    img = np.full((256, 256, 3), 200, dtype=np.uint8)
    corners = np.float32([[80, 80], [180, 80], [180, 160], [80, 160]])
    result = segment.segment_label(img, barcode_corners=corners)
    assert result.label_mask.shape == (256, 256)
    assert result.barcode_mask.shape == (256, 256)
    assert result.label_mask.dtype == np.uint8
```

- [ ] **Step 2: Run it to confirm it's skipped by default**

```bash
cd services/api && .venv/Scripts/python.exe -m pytest tests/test_segment.py -v
```
Expected: this test shows as `SKIPPED` (no checkpoint downloaded in the dev/test environment); all other tests PASS.

- [ ] **Step 3: (Optional, manual) run it for real**

```bash
cd services/api && .venv/Scripts/python.exe scripts/download_sam2_checkpoint.py
.venv/Scripts/python.exe -m pytest tests/test_segment.py::test_segment_label_real_inference_smoke -v
```
Expected: PASS, confirming the real model loads and runs on this machine. This step is not required for the plan to be "done" — it's a manual sanity check the implementer should run at least once.

- [ ] **Step 4: Commit**

```bash
git add services/api/tests/test_segment.py
git commit -m "test: add opt-in real-inference smoke test for SAM2 segmentation"
```

---

## Final verification

- [ ] Run the complete backend suite one more time from a clean state:
```bash
cd services/api && .venv/Scripts/python.exe -m pytest tests/ -v
```
Expected: all tests PASS or SKIPPED (only the real-inference test should skip, and only if weights aren't downloaded).
