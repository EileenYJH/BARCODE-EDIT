import numpy as np
import cv2

def local_tone_correct(src_bgr: np.ndarray, dst_bgr: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Shift src's flat tone to follow dst's own local lighting gradient.

    src_bgr is assumed already tone-matched to a single flat reference (e.g.
    match_tone's 95th-percentile "paper white"). A real surface often has its
    own gradient (a highlight/shadow sweeping across it), and a flat-toned
    patch against that gradient reads as an obvious rectangular "sticker" --
    confirmed via a real product photo where the pasted patch's uniform tone
    visibly broke from the label's natural brightness falloff right at the
    mask edge. This estimates the destination's ambient lighting at each
    pixel and shifts src by the same additive delta everywhere, so brightness
    follows the surface while bar contrast (a pure additive shift) is
    unchanged.
    """
    ys, xs = np.where(mask > 0)
    if len(xs) == 0:
        return src_bgr.copy()
    size = min(xs.max() - xs.min(), ys.max() - ys.min())
    sigma = max(10.0, size * 0.3)

    # Inpaint the mask area first so whatever was already there (an old
    # barcode's own bars) doesn't bias the ambient estimate -- we want "what
    # the surface's lighting looks like here", not the old content's own
    # average brightness.
    mask_u8 = (mask > 0).astype(np.uint8) * 255
    dst_filled = cv2.inpaint(dst_bgr, mask_u8, 7, cv2.INPAINT_TELEA)
    ambient = cv2.GaussianBlur(dst_filled, (0, 0), sigma).astype(np.float32)

    src_white = np.percentile(src_bgr[mask > 0].reshape(-1, 3), 95, axis=0)
    corrected = src_bgr.astype(np.float32) + (ambient - src_white)
    return np.clip(corrected, 0, 255).astype(np.uint8)

def seamless_blend(src_bgr: np.ndarray, dst_bgr: np.ndarray,
                   mask: np.ndarray, mode: str = "normal") -> np.ndarray:
    # cv2.seamlessClone (Poisson blending) reconstructs the masked interior
    # from src's gradients using dst's own pixels as the boundary condition.
    # Replacing a barcode always means dst already has an OLD barcode's own
    # high-frequency bar pattern right at (and crossing) the mask's edge --
    # real barcodes have almost no vertical quiet zone, so there's no erosion
    # amount that clears the bars without eroding away nearly the whole mask
    # (confirmed by direct reproduction: erosion large enough to reach past
    # the bars left the old barcode almost entirely un-replaced). A plain
    # alpha composite with a softened mask edge (anti-aliasing only) avoids
    # that, and local_tone_correct above handles matching the pasted
    # region's brightness to the destination's real (possibly non-uniform)
    # lighting -- no gradient-domain solve needed.
    m = (mask > 0).astype(np.float32)
    if not m.any():
        return dst_bgr.copy()

    corrected = local_tone_correct(src_bgr, dst_bgr, mask).astype(np.float32)
    m_soft = cv2.GaussianBlur(m, (0, 0), 1.0)[..., None]
    out = corrected * m_soft + dst_bgr.astype(np.float32) * (1 - m_soft)
    return np.clip(out, 0, 255).astype(np.uint8)
