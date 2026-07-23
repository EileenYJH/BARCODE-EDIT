from dataclasses import dataclass, field
from typing import Dict, List, Tuple
import logging
import numpy as np
import cv2
from pipeline.generate import generate_barcode_fit, GenerateOptions, GenerateResult
from pipeline.warp import warp_onto, quad_aspect_ratio
from pipeline.tone import match_tone
from pipeline.blend import seamless_blend
from pipeline.segment import segment_label, SegmentationError

logger = logging.getLogger(__name__)

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

def _flatten_candidate_regions(regions: List[np.ndarray], shape: Tuple[int, int]) -> np.ndarray:
    """OR-combine candidate region masks into a single flat mask.

    Returns an all-zero mask of `shape` when `regions` is empty, so callers
    can always populate the "candidate_regions" layer key on a successful
    segmentation, even when no candidates survived the label heuristics.
    """
    flattened = np.zeros(shape, dtype=np.uint8)
    for region in regions:
        flattened = cv2.bitwise_or(flattened, region)
    return flattened

def replace_barcode(req: ReplaceRequest) -> ReplaceResult:
    h, w = req.image.shape[:2]
    target_aspect = quad_aspect_ratio(req.corners)
    gen: GenerateResult = generate_barcode_fit(req.symbology, req.value, req.options, target_aspect)

    warped, alpha = warp_onto(gen.bitmap, req.corners, (h, w))

    # sample original pixels under the mask for tone stats
    ys, xs = np.where(alpha > 0)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    target_region = req.image[y0:y1 + 1, x0:x1 + 1]
    toned = match_tone(warped, alpha, target_region)

    result = seamless_blend(toned, req.image, alpha, mode=req.blend_mode)

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
        flattened = _flatten_candidate_regions(seg.candidate_regions, seg.label_mask.shape)
        layers["candidate_regions"] = cv2.cvtColor(flattened, cv2.COLOR_GRAY2BGR)
    except SegmentationError:
        logger.warning("SAM2 segmentation unavailable, skipping", exc_info=True)

    return ReplaceResult(
        result=result,
        svg=gen.svg,
        layers=layers,
    )
