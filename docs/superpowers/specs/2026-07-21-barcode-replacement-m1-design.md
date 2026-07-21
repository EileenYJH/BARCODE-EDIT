# Realistic Barcode Replacement — Milestone 1 (CPU Core Pipeline)

**Date:** 2026-07-21
**Status:** Approved (design)
**Scope:** Milestone 1 of a larger phased product. This milestone delivers a
complete, runnable end-to-end barcode replacement flow using only classical
(CPU) computer vision — no GPU, no diffusion models, no external cloud
infrastructure.

---

## 1. Context & Scope

The full product vision is an AI-powered web app that replaces a barcode in a
user photo with a user-supplied barcode while preserving the original image's
realism (lighting, perspective, shadows, texture, blend). The complete vision
requires GPU infrastructure (SAM2, SDXL/Flux inpainting, ControlNet, RealESRGAN)
and backend infra (Postgres, Redis/Celery, S3/R2) — a team-scale, multi-month
effort.

This spec covers **only Milestone 1**, chosen to deliver a genuinely usable
product quickly on ordinary hardware, and to serve as the foundation every later
tier plugs into.

### In scope (M1)
- Next.js 15 frontend + Python FastAPI backend (monorepo).
- Classical OpenCV barcode detection returning four corner coordinates.
- Generation of the "Common set" of symbologies: EAN13, EAN8, UPC-A, Code128,
  Code39, QR (with text show/hide, quiet zone, module size options; SVG export).
- Perspective warp of the new barcode onto the detected corners.
- Lightweight tone-matching (brightness / paper-color transfer).
- Poisson blending via `cv2.seamlessClone` for a seamless, printed-on look.
- Focused frontend: upload → settings → draggable corner handles → replace →
  before/after (split + swipe) → basic layer panel (show/hide + opacity) →
  download (result PNG + barcode SVG).

### Explicitly deferred (later milestones)
- SAM2 pixel-level segmentation (classical corner detection used instead).
- Full intrinsic image decomposition (tone-matching used instead).
- Diffusion harmonization (SDXL/Flux/ControlNet/IP-Adapter).
- RealESRGAN / SwinIR super-resolution.
- Background removal (BiRefNet/RMBG).
- Full Photoshop-class editor: brushes, healing, clone stamp, warp handles beyond
  corner drag, PSD-like layered export.
- Redis/Celery queue, PostgreSQL, S3/R2. M1 is **synchronous** and stores
  intermediate/output files on the **local filesystem**.
- PDF417 and Data Matrix symbologies.

### Success criteria
Upload a product photo containing a barcode → receive a photo where that barcode
is replaced by the chosen barcode, warped to the correct perspective and blended
so it reads as printed-on (not pasted) → downloadable, with a before/after view
and simple toggleable layers.

---

## 2. Architecture

Monorepo with two independently runnable services.

```
barcode-editor/
├─ apps/web/                 Next.js 15 (App Router), React 19, TypeScript
│                            TailwindCSS, shadcn/ui, Zustand, React Query,
│                            Konva (canvas + draggable corner handles),
│                            Framer Motion (comparison transitions)
├─ services/api/             Python 3.11+, FastAPI, Uvicorn
│                            OpenCV, pyzbar, python-barcode, qrcode, Pillow, numpy
├─ docs/superpowers/specs/   design docs
└─ README.md                 run instructions for both services
```

- Frontend talks to the API over HTTP/JSON (base64 or multipart for images).
- No shared runtime state; the API is stateless per request. Files written to a
  local `services/api/storage/<session-id>/` directory and served back by URL or
  returned inline as base64.
- CORS enabled for the local dev origin.

---

## 3. Backend Design

### 3.1 Module boundaries (each isolated + independently testable)

Located under `services/api/pipeline/`:

| Module | Responsibility | Input | Output |
|--------|----------------|-------|--------|
| `detect.py` | Locate barcode | image (ndarray) | list of detections: `{type, value, bbox, corners[4], confidence}` |
| `generate.py` | Render new barcode | `{symbology, value, options}` | clean barcode bitmap (ndarray) + SVG string |
| `warp.py` | Perspective transform | barcode bitmap, target corners[4] | warped barcode + alpha, on original canvas |
| `tone.py` | Match surface look | warped barcode, original region stats | tone-adjusted barcode |
| `blend.py` | Seamless composite | tone-adjusted barcode, original image, mask | final composited image |
| `orchestrator.py` | Run stages in order, assemble layers | request | result + intermediate layers |

Each module is a pure function (or small class) with a typed signature; no
module reaches into another's internals.

### 3.2 Pipeline stages

1. **Detect** — Try `pyzbar.decode` first (gives type + decoded value + polygon).
   Fall back to OpenCV `cv2.barcode.BarcodeDetector` / contour analysis for
   corner geometry when pyzbar's polygon is coarse. Refine to a 4-point quad via
   `cv2.minAreaRect` / contour approximation. Confidence = detector score or a
   heuristic from contour fit quality.

2. **Generate** — Dispatch by symbology:
   - EAN13 / EAN8 / UPC-A / Code128 / Code39 → `python-barcode` (ImageWriter),
     with `write_text` (show/hide human-readable text), `quiet_zone`,
     `module_width`/`module_height` options. SVG via `SVGWriter`.
   - QR → `qrcode` library → PNG; SVG via `qrcode.image.svg`.
   Output normalized to a white-background RGB bitmap + the SVG string.

3. **Warp** — Source rectangle = generated barcode's own corners; destination =
   detected (possibly user-corrected) corners. `cv2.getPerspectiveTransform`
   (or `findHomography` + RANSAC when >4 correspondences). `cv2.warpPerspective`
   with an alpha channel to place the barcode on a transparent full-size canvas.

4. **Tone-match** — Sample the original barcode region (masked): compute mean/std
   of luminance and the paper (light-module) color. Scale/offset the warped
   barcode's white and dark levels to match (so it inherits surface brightness,
   paper tint, and any gradient sampled per-sub-region). Optional light Gaussian
   blur to match camera softness estimated from the original region.

5. **Blend** — Build the mask from the warped barcode's alpha. Composite with
   `cv2.seamlessClone` (NORMAL_CLONE default; MIXED_CLONE option for textured
   surfaces) centered on the region centroid → seamless Poisson blend.

6. **Assemble** — Orchestrator returns: final image, and intermediate layers
   (original, warped-barcode-only w/ alpha, mask) so the UI can present them as
   toggleable layers.

### 3.3 Endpoints

- `POST /api/detect` — body: image. Returns detections (corners, type, value,
  confidence) so the frontend can render draggable handles. No mutation.
- `POST /api/replace` — body: image + `{symbology, value, options, corners[4],
  blendMode}`. Runs stages 2–6. Returns final image (base64 or URL) + layers +
  the barcode SVG.
- `GET /api/health` — liveness.

### 3.4 Error handling
- No barcode detected → `200` with empty detections; UI lets the user draw the
  quad manually.
- Invalid symbology/value (e.g., EAN13 checksum/length) → `422` with a clear
  message surfaced in the settings panel.
- Corners outside image bounds / degenerate quad → `422`.
- Unsupported/oversized image → `413`/`415` with message. (Max dimension guard,
  e.g. 12000 px per spec; downscale-for-preview but process at native res.)

---

## 4. Frontend Design

### 4.1 Layout
- **Left sidebar:** Upload, Barcode Settings, (stub) AI Settings, Layers, History.
- **Center:** Konva canvas — uploaded image with the detected quad as four
  draggable corner handles; result shown here after replace.
- **Right sidebar:** Properties / layer controls (opacity), blend mode toggle.
- **Bottom bar:** zoom, before/after toggle, export.

### 4.2 Flow
1. Upload image (PNG/JPEG; HEIC/TIFF/RAW deferred) → preview on canvas.
2. Auto-call `/api/detect`; render corner handles on the detected quad. User can
   drag handles to correct placement, or draw a quad if none detected.
3. Barcode Settings panel: symbology dropdown, value input (validated), text
   show/hide, quiet zone, module size.
4. **Replace** → React Query mutation to `/api/replace`; progress indicator.
5. Result rendered with:
   - **Basic layer panel:** Original / New Barcode / Result — each show/hide +
     opacity slider (Zustand store).
   - **Comparison:** split view + swipe slider (Framer Motion) between original
     and result.
6. **Download:** result PNG; barcode SVG. (TIFF/16-bit/CMYK/ZIP deferred.)

### 4.3 State
- Zustand store: image, detections, corner positions, settings, result, layers
  (visibility/opacity), comparison mode.
- React Query: `detect` and `replace` mutations, caching by input hash.

---

## 5. Testing

### Backend (pytest)
- `detect`: synthetic images with a barcode at known corners on varied
  backgrounds/rotations → assert returned corners within tolerance, correct type.
- `generate`: each symbology renders; EAN/UPC checksum validation; text
  show/hide changes output height; SVG is well-formed.
- `warp`: known homography → warped corners land on target within pixel
  tolerance.
- `tone`: output region mean luminance matches target within tolerance.
- `blend`: no hard seam — gradient continuity across the mask boundary below a
  threshold (compare Laplacian energy at the seam vs. naive alpha paste).
- `orchestrator`: end-to-end on a fixture returns all expected layers + valid
  final image.

### Frontend
- Settings panel: symbology/value validation surfaces errors.
- Zustand layer store: show/hide + opacity transitions.
- Corner-handle drag updates state correctly (component test).

---

## 6. Later Milestones (roadmap, not built here)

1. **M2 — Editor depth:** full layer editor (brushes, healing, clone stamp,
   perspective warp handles, undo/redo history), difference heatmap, fade
   comparison, PSD-like layered export.
2. **M3 — GPU realism tier:** SAM2 segmentation, intrinsic decomposition,
   diffusion harmonization (SDXL/Flux + ControlNet + IP-Adapter), RealESRGAN
   super-resolution — as an optional "high realism" backend path.
3. **M4 — Production infra:** Redis/Celery async queue with progress streaming,
   PostgreSQL, S3/R2 storage, caching, GPU inference (ONNX/TensorRT).
4. **M5 — Extras:** background removal, PDF417/Data Matrix, HEIC/TIFF/RAW input,
   16-bit/CMYK/300-600 DPI export, ZIP packaging.
