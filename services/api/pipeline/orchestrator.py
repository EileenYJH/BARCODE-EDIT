from dataclasses import dataclass, field
from typing import Dict
import numpy as np
import cv2
from pipeline.generate import generate_barcode_fit, GenerateOptions, GenerateResult
from pipeline.warp import warp_onto, quad_aspect_ratio
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

    return ReplaceResult(
        result=result,
        svg=gen.svg,
        layers={
            "original": req.image.copy(),
            "new_barcode": new_barcode_layer,
            "mask": cv2.cvtColor(alpha, cv2.COLOR_GRAY2BGR),
        },
    )
