import numpy as np
import pytest
from pipeline.warp import warp_onto, quad_aspect_ratio
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

def test_warp_keeps_bar_edges_crisp_not_grey():
    # a barcode is binary (pure black/white bars); the default interpolation
    # cv2.warpPerspective would use (INTER_LINEAR) blends bar edges into
    # intermediate grey values, which softens edges and can confuse
    # scanners. Warping should preserve hard 0/255 transitions instead.
    bc = np.full((100, 200, 3), 255, dtype=np.uint8)
    bc[:, ::10] = 0  # narrow vertical bars every 10px
    # a corner placement that isn't pixel-aligned, so any interpolation
    # would show up as intermediate grey values at the bar edges
    corners = np.float32([[50.3, 40.7], [350.6, 45.2], [347.1, 145.9], [53.8, 140.4]])
    warped, _ = warp_onto(bc, corners, canvas_size=(200, 400))
    # every pixel should be exactly white or exactly black (or the outside
    # background, also 0) -- no in-between grey from blended interpolation
    assert set(np.unique(warped).tolist()) <= {0, 255}

def test_quad_aspect_ratio_axis_aligned_rectangle():
    # tl, tr, br, bl of a 200x100 axis-aligned rectangle
    corners = np.float32([[0, 0], [200, 0], [200, 100], [0, 100]])
    assert quad_aspect_ratio(corners) == pytest.approx(2.0, rel=1e-3)

def test_quad_aspect_ratio_square():
    corners = np.float32([[10, 10], [110, 10], [110, 110], [10, 110]])
    assert quad_aspect_ratio(corners) == pytest.approx(1.0, rel=1e-3)

def test_quad_aspect_ratio_averages_skewed_edges():
    # top edge length 100, bottom edge length 120 -> avg width 110
    # left edge (0,0)->(-10,50) and right edge (100,0)->(110,50) are equal by
    # symmetry, each length sqrt(10**2 + 50**2)
    corners = np.float32([[0, 0], [100, 0], [110, 50], [-10, 50]])
    expected_height = (10 ** 2 + 50 ** 2) ** 0.5
    assert quad_aspect_ratio(corners) == pytest.approx(110 / expected_height, rel=1e-3)
