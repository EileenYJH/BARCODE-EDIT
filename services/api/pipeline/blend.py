import numpy as np
import cv2

def seamless_blend(src_bgr: np.ndarray, dst_bgr: np.ndarray,
                   mask: np.ndarray, mode: str = "normal") -> np.ndarray:
    # cv2.seamlessClone (Poisson blending) reconstructs the masked interior
    # from src's gradients using dst's own pixels as the boundary condition.
    # Replacing a barcode always means dst already has an OLD barcode's own
    # high-frequency bar pattern right at (and crossing) the mask's edge --
    # real barcodes have almost no vertical quiet zone, so there's no erosion
    # amount that clears the bars without eroding away nearly the whole mask
    # (confirmed by direct reproduction: erosion large enough to reach past
    # the bars left the old barcode almost entirely un-replaced). Gradient
    # reconstruction is also the wrong tool for this: match_tone already
    # matches the pasted region's tone to its surroundings, so there's no
    # lighting mismatch left for a Poisson solve to fix. A plain alpha
    # composite with a softened mask edge (for anti-aliasing only, not
    # blending image content) reproduces the new barcode's bars exactly.
    m = (mask > 0).astype(np.float32)
    if not m.any():
        return dst_bgr.copy()
    m_soft = cv2.GaussianBlur(m, (0, 0), 1.0)[..., None]
    out = src_bgr.astype(np.float32) * m_soft + dst_bgr.astype(np.float32) * (1 - m_soft)
    return np.clip(out, 0, 255).astype(np.uint8)
