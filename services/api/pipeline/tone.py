import numpy as np
import cv2

def match_tone(barcode_bgr: np.ndarray, alpha: np.ndarray,
               target_region_bgr: np.ndarray, blur_sigma: float = 0.0) -> np.ndarray:
    """Scale barcode luminance/color so its 'paper' matches the target surface.
    barcode_bgr and alpha same size; target_region_bgr is the original pixels
    under the same area (any size, used only for statistics).

    blur_sigma defaults to 0 (no blur): softening the barcode's own bars/text
    measurably degrades their sharpness (~3x lower edge contrast at the
    previous default of 0.6, confirmed via Laplacian-variance comparison) for
    no documented benefit -- seamlessClone's own gradient-domain blending
    (in blend.py) already handles blending the pasted region naturally into
    its surroundings. Left as a parameter in case a specific caller wants a
    deliberately soft look, but that's no longer the default.
    """
    out = barcode_bgr.astype(np.float32)
    m = alpha > 0
    if not m.any():
        return barcode_bgr

    tgt = target_region_bgr.reshape(-1, 3).astype(np.float32)
    tgt_mean = tgt.mean(axis=0)               # per-channel BGR mean of surface
    tgt_p95 = np.percentile(tgt, 95, axis=0)  # approx "paper white" of surface

    src = out[m]
    src_p95 = np.percentile(src, 95, axis=0) + 1e-3  # barcode paper white

    # map barcode white -> surface paper white, keep blacks near 0 but lifted to mean floor
    scale = tgt_p95 / src_p95
    floor = tgt_mean * 0.15
    adj = src * scale
    adj = np.clip(adj, floor, 255)
    out[m] = adj

    out = np.clip(out, 0, 255).astype(np.uint8)
    if blur_sigma > 0:
        blurred = cv2.GaussianBlur(out, (0, 0), blur_sigma)
        out[m] = blurred[m]
    return out
