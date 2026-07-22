import re
import numpy as np
import pytest
import cv2
from pipeline.orchestrator import replace_barcode, ReplaceRequest
from pipeline.generate import generate_barcode, GenerateOptions
from pipeline.warp import quad_aspect_ratio
from tests.fixtures import make_scene

def test_replace_returns_result_and_layers():
    scene, corners, meta = make_scene(warp=False)
    req = ReplaceRequest(
        image=scene, corners=corners, symbology="code128",
        value="NEWVALUE", options=GenerateOptions(show_text=False),
        blend_mode="normal",
    )
    res = replace_barcode(req)
    assert res.result.shape == scene.shape
    assert "original" in res.layers
    assert "new_barcode" in res.layers
    assert "mask" in res.layers
    # result differs from original inside the region
    diff = np.abs(res.result.astype(int) - scene.astype(int)).sum()
    assert diff > 0

def _svg_aspect_ratio(svg: str) -> float:
    w = float(re.search(r'width="([\d.]+)mm"', svg).group(1))
    h = float(re.search(r'height="([\d.]+)mm"', svg).group(1))
    return w / h

def test_replace_fits_generated_barcode_to_target_quad_aspect():
    scene = np.full((600, 800, 3), 210, dtype=np.uint8)
    square_corners = np.float32([[300, 200], [500, 200], [500, 400], [300, 400]])
    req = ReplaceRequest(
        image=scene, corners=square_corners, symbology="code128",
        value="NEWVALUE", options=GenerateOptions(show_text=False),
        blend_mode="normal",
    )
    res = replace_barcode(req)
    target_aspect = quad_aspect_ratio(square_corners)
    assert _svg_aspect_ratio(res.svg) == pytest.approx(target_aspect, rel=0.05)

def test_replace_preserves_bar_contrast_when_an_old_barcode_is_already_there():
    # a real photo being edited always already has a barcode where the new
    # one goes -- the region being replaced necessarily contains the OLD
    # barcode's own high-frequency black/white bar pattern right at (and
    # crossing) the new placement's mask boundary. Confirmed via direct
    # reproduction: cv2.seamlessClone can smear this into a low-contrast
    # gray blob instead of preserving the new barcode's own bars, especially
    # for a rotated mask (as any real perspective-detected placement is).
    scene = np.full((500, 700, 3), 218, np.uint8)  # bright surface
    # a REAL barcode's own bar pattern (irregular widths), not a uniform
    # stripe pattern -- a uniform synthetic pattern turned out to be a
    # harder, less realistic case for Poisson blending than an actual
    # barcode's own structure
    old_bitmap = generate_barcode("code128", "OLDVALUE1", GenerateOptions(show_text=True)).bitmap
    old_bh, old_bw = old_bitmap.shape[:2]
    old_corners = np.float32([[258, 229], [431, 236], [429, 288], [256, 281]])
    src_rect = np.float32([[0, 0], [old_bw, 0], [old_bw, old_bh], [0, old_bh]])
    H_old = cv2.getPerspectiveTransform(src_rect, old_corners)
    old_warped = cv2.warpPerspective(old_bitmap, H_old, (700, 500), borderValue=(218, 218, 218))
    old_mask = cv2.warpPerspective(np.full((old_bh, old_bw), 255, np.uint8), H_old, (700, 500))
    scene[old_mask > 0] = old_warped[old_mask > 0]

    req = ReplaceRequest(
        image=scene, corners=old_corners, symbology="code128",
        value="BRIGHTFIX", options=GenerateOptions(show_text=True),
        blend_mode="normal",
    )
    res = replace_barcode(req)

    alpha_mask = cv2.cvtColor(res.layers["mask"], cv2.COLOR_BGR2GRAY) > 0
    region_pixels = res.result[alpha_mask]
    # a smudged/washed-out result has noticeably lower pixel-value spread
    # within the barcode's own footprint than a crisp one with real bars
    assert region_pixels.std() > 100
