import numpy as np
from pipeline.warp import warp_onto
from pipeline.generate import generate_barcode, GenerateOptions

def test_warp_places_barcode_within_target_quad():
    bc = generate_barcode("code128", "HELLO", GenerateOptions(show_text=False)).bitmap
    corners = np.float32([[100, 80], [300, 90], [295, 190], [110, 185]])
    warped, alpha = warp_onto(bc, corners, canvas_size=(400, 500))  # (h,w)
    assert warped.shape == (400, 500, 3)
    assert alpha.shape == (400, 500)
    ys, xs = np.where(alpha > 0)
    # painted pixels sit inside the target bounding box (+ small margin)
    assert xs.min() >= 95 and xs.max() <= 305
    assert ys.min() >= 75 and ys.max() <= 195
