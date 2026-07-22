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
