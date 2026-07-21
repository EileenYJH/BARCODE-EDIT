import numpy as np
import cv2

_MODES = {"normal": cv2.NORMAL_CLONE, "mixed": cv2.MIXED_CLONE}

def seamless_blend(src_bgr: np.ndarray, dst_bgr: np.ndarray,
                   mask: np.ndarray, mode: str = "normal") -> np.ndarray:
    flag = _MODES.get(mode, cv2.NORMAL_CLONE)
    m = (mask > 0).astype(np.uint8) * 255
    ys, xs = np.where(m > 0)
    if len(xs) == 0:
        return dst_bgr.copy()
    cx = int((xs.min() + xs.max()) / 2)
    cy = int((ys.min() + ys.max()) / 2)
    # seamlessClone needs the mask strictly inside dst; erode 1px for safety
    m = cv2.erode(m, np.ones((3, 3), np.uint8), iterations=1)
    return cv2.seamlessClone(src_bgr, dst_bgr, m, (cx, cy), flag)
