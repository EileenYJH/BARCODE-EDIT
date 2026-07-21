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
