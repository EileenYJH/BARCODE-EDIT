import numpy as np
import cv2
from pipeline.generate import generate_barcode, GenerateOptions

def make_scene(value: str = "TESTCODE", warp: bool = True):
    """Return (scene_bgr, corners[4,2] tl-tr-br-bl, meta)."""
    res = generate_barcode("code128", value, GenerateOptions(show_text=False))
    bc = res.bitmap
    bh, bw = bc.shape[:2]

    scene = np.full((600, 800, 3), 210, dtype=np.uint8)  # light gray "packaging"
    # add gentle vertical gradient so tone-matching has something to match
    grad = np.linspace(-25, 25, 600).astype(np.int16)
    scene = np.clip(scene.astype(np.int16) + grad[:, None, None], 0, 255).astype(np.uint8)

    # place barcode: source rect -> dest quad
    src = np.float32([[0, 0], [bw, 0], [bw, bh], [0, bh]])
    if warp:
        dst = np.float32([[250, 200], [560, 220], [545, 360], [265, 350]])
    else:
        dst = np.float32([[260, 210], [560, 210], [560, 350], [260, 350]])
    H = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(bc, H, (800, 600), borderValue=(210, 210, 210))
    mask = cv2.warpPerspective(np.full((bh, bw), 255, np.uint8), H, (800, 600))
    scene[mask > 0] = warped[mask > 0]

    meta = {"symbology": "code128", "value": value}
    return scene, dst.copy(), meta
