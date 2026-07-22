import numpy as np
from pipeline.generate import generate_barcode, GenerateOptions
from pipeline.warp import warp_onto

def make_scene(value: str = "TESTCODE", warp: bool = True):
    """Return (scene_bgr, corners[4,2] tl-tr-br-bl, meta)."""
    res = generate_barcode("code128", value, GenerateOptions(show_text=False))
    bc = res.bitmap

    scene = np.full((600, 800, 3), 210, dtype=np.uint8)  # light gray "packaging"
    # add gentle vertical gradient so tone-matching has something to match
    grad = np.linspace(-25, 25, 600).astype(np.int16)
    scene = np.clip(scene.astype(np.int16) + grad[:, None, None], 0, 255).astype(np.uint8)

    if warp:
        dst = np.float32([[250, 200], [560, 220], [545, 360], [265, 350]])
    else:
        dst = np.float32([[260, 210], [560, 210], [560, 350], [260, 350]])
    warped, mask = warp_onto(bc, dst, (600, 800))
    scene[mask > 0] = warped[mask > 0]

    meta = {"symbology": "code128", "value": value}
    return scene, dst.copy(), meta
