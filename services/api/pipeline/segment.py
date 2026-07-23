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


def _box_from_corners(corners: np.ndarray) -> np.ndarray:
    """Convert a (4,2) quad into a SAM2 box prompt [x0, y0, x1, y1]."""
    corners = np.asarray(corners, dtype=np.float32)
    x0, y0 = corners.min(axis=0)
    x1, y1 = corners.max(axis=0)
    return np.array([x0, y0, x1, y1], dtype=np.float32)


def _select_label_mask(masks: List[dict], barcode_mask: np.ndarray) -> np.ndarray:
    """Pick the automatic-mask-generator candidate that best encloses the barcode.

    SAM2's automatic mask generator has no notion of "this is the label" --
    it just returns candidate regions. We heuristically pick the largest
    candidate that contains at least 90% of the barcode mask's area, on the
    assumption the label is bigger than and contains the barcode. This is a
    best-effort MVP; true layout understanding is deferred (see spec).
    """
    barcode_area = float((barcode_mask > 0).sum())
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
