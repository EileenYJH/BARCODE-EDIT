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

    # Replacing a barcode always means the destination photo already has an
    # OLD barcode's own high-frequency bar pattern right at (and crossing)
    # this mask's boundary -- that's the whole point of the app. Confirmed
    # by direct reproduction: cv2.seamlessClone's Poisson solve can smear
    # this into a low-contrast gray blob instead of preserving the new
    # barcode's bars, especially for a rotated mask (any real
    # perspective-detected placement). A substantial erosion pushes the
    # mask boundary inward past the barcode's own quiet-zone margin, so the
    # boundary condition is just plain paper (visually the same whether old
    # or new) rather than alternating bars -- only the actual bar pattern in
    # the interior needs the Poisson solve. A small fixed erosion (previously
    # 1px, "for safety") isn't enough; this needs to scale with the mask's
    # own size.
    size = min(xs.max() - xs.min(), ys.max() - ys.min())
    erode_px = max(1, int(size * 0.4))
    m = cv2.erode(m, np.ones((erode_px * 2 + 1, erode_px * 2 + 1), np.uint8), iterations=1)
    return cv2.seamlessClone(src_bgr, dst_bgr, m, (cx, cy), flag)
