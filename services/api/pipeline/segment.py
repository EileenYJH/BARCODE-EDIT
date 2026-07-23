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
