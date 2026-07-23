# SAM2 Label Segmentation — First Stage of Milestone 3 (Vector Pipeline)

**Date:** 2026-07-23
**Status:** Approved (design)
**Branch:** `feat/vector-pipeline-m3`
**Scope:** First concrete implementation step of the full vector-reconstruction
pipeline (SAM2 segmentation → layout detection → barcode/typography analysis →
vector rendering → warp → texture transfer → Poisson compositing → AI
harmonization → validation → interactive editor → export). This spec covers
**only the SAM2 segmentation stage** — everything downstream is future work,
decomposed into its own spec/plan cycle later.

---

## 1. Context & Scope

Milestones 1–2 (`feat/barcode-m1`, `feat/editor-m2a/b`) built a CPU-only
classical pipeline: `cv2.barcode.BarcodeDetector` + pyzbar locate the barcode's
own quad; there is no segmentation of the surrounding label or its layout.
M1's design doc explicitly deferred "SAM2 pixel-level segmentation" — this spec
picks that up as the first step of the next phase.

### In scope
- A new `pipeline/segment.py` module that runs SAM2 in-process to produce:
  a full label-boundary mask, a refined barcode mask (prompted from existing
  classical detection), and unclassified candidate sub-region masks.
- Wiring into `orchestrator.replace_barcode()` as **additive, non-blocking**
  output — new keys in `ReplaceResult.layers`, zero change to existing
  request/response contracts.
- A standalone `/api/segment` route for inspecting segmentation independent of
  the full replace flow.
- A checkpoint-download helper script; model weights are not committed to git.

### Explicitly deferred (later steps of M3)
- Label Layout Detection (classifying candidate regions as barcode/text/logo).
- Typography Analysis, Vector Barcode/Text rendering, SVG reconstruction.
- High-precision perspective warp beyond the current `warp.py`.
- Illumination & texture transfer, Poisson-domain compositing beyond current
  `blend.py`.
- AI harmonization (diffusion-based background harmonization).
- Quality validation (geometry/sharpness/scan-test) and the interactive layer
  editor beyond what M2 already built.
- High-resolution PNG/TIFF/PSD export.
- Any change to the *existing* barcode-corner detection/replace behavior —
  this stage only adds new, optional output.

### Success criteria
Given a product photo, `segment_label()` returns a label-boundary mask, a
SAM2-refined barcode mask, and a set of unclassified candidate sub-region
masks, without altering any existing pipeline behavior or breaking the
existing test suite. `/api/replace` continues to work exactly as before when
SAM2 is unavailable or fails.

---

## 2. Biggest open risk: Python 3.14 compatibility

This project runs **Python 3.14** (a deliberately bleeding-edge choice logged
in M1's memory). Meta's official SAM2 repo targets Python ≤3.12 and specific
pinned `torch` versions; compatibility with 3.14 is unverified.

**Resolution plan:** a short implementation-time spike installs `torch` +
SAM2 into the existing `services/api/.venv` and confirms the tiny checkpoint
loads and runs a forward pass. If incompatible:
- First fallback: try the `transformers` library's SAM2 port (pure
  torch-based, more likely to track current Python releases).
- Second fallback: isolate this module behind a separate Python 3.12 venv
  (e.g. `services/api/.venv-sam`), invoked as a subprocess/local HTTP call
  from the main 3.14 service — more moving parts, only if the first fallback
  also fails.

This spike happens before the bulk of `segment.py` is written, so the
implementation plan should sequence it as step 1.

---

## 3. Model management

- Checkpoint: `sam2.1_hiera_tiny` (smallest available), chosen for CPU
  feasibility on a synchronous, single-request, non-concurrent local service.
- Device selection: `cuda` → `mps` → `cpu`, auto-detected at load time via
  `torch.cuda.is_available()` / `torch.backends.mps.is_available()`.
- Lazy singleton load: the model loads on first call to `segment_label()`,
  not at process startup — keeps `/api/detect`-only usage fast and avoids
  paying model-load cost when segmentation isn't invoked.
- Weights are **not committed to git**. `scripts/download_sam2_checkpoint.py`
  downloads the checkpoint into a gitignored `services/api/models/` directory;
  `segment.py` raises a clear, actionable error if weights are missing rather
  than failing obscurely.

---

## 4. `pipeline/segment.py`

```python
@dataclass
class SegmentationResult:
    label_mask: np.ndarray          # uint8 mask, full label boundary
    barcode_mask: np.ndarray        # uint8 mask, SAM2-refined barcode region
    candidate_regions: List[np.ndarray]  # unclassified sub-region masks

def segment_label(img: np.ndarray, barcode_corners: Optional[np.ndarray] = None) -> SegmentationResult:
    ...
```

- `barcode_mask` is produced by prompting SAM2's image predictor with a box
  built from `barcode_corners` (reuses existing classical detection as the
  *prompt*, not a replacement for it — detection stays the source of truth
  for corner geometry; SAM2 only refines the pixel mask).
- `label_mask` is selected from SAM2's automatic mask generator as the
  best candidate that contains/encloses the barcode region with plausible
  area (heuristic, documented as best-effort — true layout understanding is
  the deferred "Label Layout Detection" stage).
- `candidate_regions` are the automatic-mask-generator's remaining masks
  inside the label boundary, returned **unclassified**. SAM2 is a promptable
  segmenter, not a semantic classifier — it cannot itself say "this is text."
  Downstream typography/layout analysis (deferred) is what would classify
  these; this stage only proposes candidate regions for that future stage to
  consume.
- All model/inference failures (missing weights, OOM, unsupported device,
  unexpected SAM2 exception) are caught inside `segment_label()` and
  re-raised as a single `SegmentationError`, so callers have one exception
  type to handle.

---

## 5. Orchestrator wiring

`replace_barcode()` calls `segment_label(req.image, req.corners)` after the
existing generate/warp/tone/blend steps, wrapped in try/except:

```python
try:
    seg = segment_label(req.image, req.corners)
    layers["label_mask"] = cv2.cvtColor(seg.label_mask, cv2.COLOR_GRAY2BGR)
    layers["sam_barcode_mask"] = cv2.cvtColor(seg.barcode_mask, cv2.COLOR_GRAY2BGR)
    layers["candidate_regions"] = _flatten_candidate_regions(seg.candidate_regions)
except SegmentationError:
    logger.warning("segmentation unavailable, skipping", exc_info=True)
```

No existing keys, fields, or request/response shapes change. Existing tests
for `replace_barcode()` continue to pass unmodified. If SAM2 is entirely
absent from the environment (e.g. CI without weights/torch), the pipeline
behaves exactly as it does today.

---

## 6. New route: `/api/segment`

```python
class SegmentRequest(BaseModel):
    image: str  # data URL
    corners: Optional[List[List[float]]] = None  # optional barcode-box prompt

class SegmentResponse(BaseModel):
    label_mask: str
    barcode_mask: str
    candidate_regions: List[str]
```

Standalone endpoint so segmentation can be exercised and visually inspected
without running the full (slower) replace pipeline — useful for manual
verification and later frontend preview work.

---

## 7. Testing

- **Unit tests (default suite, fast, no weights required):** stub
  `_load_model()` to return a fake predictor/mask-generator with canned mask
  outputs. Cover: box-prompt construction from corners, `label_mask`
  selection heuristic, `candidate_regions` flattening, `SegmentationError`
  wrapping of underlying exceptions, orchestrator's graceful-skip path when
  `segment_label` raises.
- **Real-inference test (opt-in):** one test marked
  `@pytest.mark.skipif(not _weights_available(), reason=...)` that loads the
  actual tiny checkpoint and asserts a forward pass runs and returns
  correctly-shaped masks on a small fixture image. Skipped by default —
  requires downloaded weights and is too slow for routine runs.
- Existing `detect.py` / `orchestrator.py` / `blend.py` / `warp.py` /
  `tone.py` test suites are unaffected and must continue to pass unmodified.

---

## 8. Out of scope reminders

This spec deliberately does not touch: barcode corner detection logic,
`GenerateOptions`, warp/tone/blend behavior, the frontend, or the
request/response contract of `/api/replace`. Those are unchanged. The only
new user-visible surface is the optional `/api/segment` route and new
(additive, non-breaking) keys in `/api/replace`'s `layers` response.
