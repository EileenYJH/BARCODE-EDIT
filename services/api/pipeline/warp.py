from typing import Tuple
import numpy as np
import cv2

def quad_dimensions(corners: np.ndarray) -> Tuple[float, float]:
    """corners: (4,2) tl,tr,br,bl. Returns (width, height) in pixels, each
    averaged across both parallel edges, so a mildly skewed quad still gets
    a sane estimate."""
    tl, tr, br, bl = np.asarray(corners, dtype=np.float64)
    width = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
    height = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
    return width, height

def quad_aspect_ratio(corners: np.ndarray) -> float:
    """corners: (4,2) tl,tr,br,bl. Returns width/height."""
    width, height = quad_dimensions(corners)
    if height <= 0:
        return 1.0
    return width / height

def barcode_interp_flag(src_shape: Tuple[int, int], dst_corners: np.ndarray) -> int:
    """Pick an interpolation flag for warping a binary barcode bitmap.

    A barcode is pure black/white bars, not a natural photo, so the usual
    default (INTER_LINEAR) is wrong either way it scales: enlarging blends
    bar edges into intermediate grey (softening them, and grey edges can
    confuse scanners), while shrinking a fine periodic bar pattern with
    anything other than proper area-averaging aliases -- distorting bar
    widths enough to break decoding entirely (confirmed: a barcode rendered
    at 4x resolution then perspective-warped down to a modest on-photo size
    failed to decode with plain LINEAR/NEAREST, and decoded fine with AREA).
    INTER_NEAREST preserves hard edges when enlarging; INTER_AREA
    anti-aliases properly when shrinking.
    """
    bh, bw = src_shape[:2]
    dst_area = cv2.contourArea(np.float32(dst_corners))
    return cv2.INTER_AREA if dst_area < bw * bh else cv2.INTER_NEAREST

def warp_onto(barcode_bgr: np.ndarray, target_corners: np.ndarray,
              canvas_size: Tuple[int, int]) -> Tuple[np.ndarray, np.ndarray]:
    """Warp barcode so its corners map to target_corners (tl,tr,br,bl).
    canvas_size is (height, width). Returns (warped_bgr, alpha_uint8)."""
    h, w = canvas_size
    bh, bw = barcode_bgr.shape[:2]
    src = np.float32([[0, 0], [bw, 0], [bw, bh], [0, bh]])
    dst = np.float32(target_corners)
    H = cv2.getPerspectiveTransform(src, dst)
    flag = barcode_interp_flag((bh, bw), dst)
    warped = cv2.warpPerspective(barcode_bgr, H, (w, h), flags=flag)
    mask = cv2.warpPerspective(np.full((bh, bw), 255, np.uint8), H, (w, h), flags=flag)
    return warped, mask
