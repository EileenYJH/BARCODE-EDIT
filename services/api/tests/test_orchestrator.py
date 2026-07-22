import re
import numpy as np
import pytest
import cv2
from pyzbar import pyzbar
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

def test_replace_preserves_new_barcode_bars_when_an_old_barcode_is_already_there():
    # a real photo being edited always already has a barcode where the new
    # one goes -- the region being replaced necessarily contains the OLD
    # barcode's own high-frequency black/white bar pattern right at (and
    # crossing) the new placement's mask boundary. Confirmed via direct
    # reproduction: cv2.seamlessClone (Poisson blending) can smear this into
    # a low-contrast gray blob instead of preserving the new barcode's own
    # bars, especially for a rotated mask (as any real perspective-detected
    # placement is) -- and, separately, that a real barcode has almost no
    # vertical quiet zone, so no amount of mask erosion clears the bars
    # without eroding away nearly the whole mask (an earlier "fix" passed a
    # pixel-spread check while actually leaving the OLD barcode almost
    # entirely un-replaced, since a crisp old barcode has high spread too).
    # This test instead directly checks the rendered bars match the NEW
    # barcode, not just "high contrast" -- so it can't be fooled that way.
    scene = np.full((500, 700, 3), 218, np.uint8)  # bright surface
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

    # shrink the mask a couple pixels to skip the intentionally-feathered
    # anti-aliasing edge, then compare the rendered result to the new
    # barcode layer the orchestrator itself recorded -- a smudge or a
    # not-fully-replaced old barcode would both diverge sharply here, while
    # a correct composite matches almost exactly.
    alpha_mask = cv2.cvtColor(res.layers["mask"], cv2.COLOR_BGR2GRAY)
    interior = cv2.erode(alpha_mask, np.ones((5, 5), np.uint8)) > 0
    result_interior = res.result[interior].astype(int)
    new_barcode_interior = res.layers["new_barcode"][interior].astype(int)
    assert np.abs(result_interior - new_barcode_interior).mean() < 5

    # and it must actually be the NEW value, not the old one still showing
    # through -- sample a bar column near the text that differs between
    # "OLDVALUE1" and "BRIGHTFIX" and confirm it isn't the old pixel value
    old_region = old_warped[interior].astype(int)
    assert not np.allclose(result_interior, old_region, atol=10)

def test_replace_with_text_corners_places_bars_and_text_independently():
    scene = np.full((400, 900, 3), 220, np.uint8)
    bars_corners = np.float32([[100, 100], [500, 100], [500, 180], [100, 180]])
    text_corners = np.float32([[100, 190], [500, 190], [500, 230], [100, 230]])
    req = ReplaceRequest(
        image=scene, corners=bars_corners, symbology="code128",
        value="SPLITME1", options=GenerateOptions(show_text=True),
        blend_mode="normal", text_corners=text_corners,
    )
    res = replace_barcode(req)
    assert res.result.shape == scene.shape

    bars_mask = np.zeros(scene.shape[:2], np.uint8)
    cv2.fillPoly(bars_mask, [bars_corners.astype(np.int32)], 255)
    text_mask = np.zeros(scene.shape[:2], np.uint8)
    cv2.fillPoly(text_mask, [text_corners.astype(np.int32)], 255)
    # both regions changed from the original scene
    assert np.abs(res.result[bars_mask > 0].astype(int) - scene[bars_mask > 0].astype(int)).mean() > 5
    assert np.abs(res.result[text_mask > 0].astype(int) - scene[text_mask > 0].astype(int)).mean() > 5

    # prove the bars actually landed in the bars quad (not swapped with text):
    # the bars region is axis-aligned so no re-warp is needed for pyzbar to
    # read it directly
    bars_crop = res.result[100:180, 100:500]
    decoded = pyzbar.decode(bars_crop)
    assert len(decoded) == 1
    assert decoded[0].data == b"SPLITME1"

    # and the text region should contain no scannable barcode pattern --
    # proving the bars didn't end up there by mistake
    text_crop = res.result[190:230, 100:500]
    assert pyzbar.decode(text_crop) == []

    # the new_barcode preview layer must be updated for BOTH regions, not
    # left as zeros/stale bars-only content for the text quad
    bars_interior = cv2.erode(bars_mask, np.ones((5, 5), np.uint8)) > 0
    result_bars_interior = res.result[bars_interior].astype(int)
    layer_bars_interior = res.layers["new_barcode"][bars_interior].astype(int)
    assert np.abs(result_bars_interior - layer_bars_interior).mean() < 5

    text_interior = cv2.erode(text_mask, np.ones((5, 5), np.uint8)) > 0
    result_text_interior = res.result[text_interior].astype(int)
    layer_text_interior = res.layers["new_barcode"][text_interior].astype(int)
    assert np.abs(result_text_interior - layer_text_interior).mean() < 5

def test_replace_with_degenerate_text_corners_is_a_no_op_not_a_crash():
    scene = np.full((400, 900, 3), 220, np.uint8)
    bars_corners = np.float32([[100, 100], [500, 100], [500, 180], [100, 180]])
    # collapsed to a zero-width vertical sliver -- rasterizes to zero pixels
    # (unlike all-four-corners-identical, which can produce a nonsensical but
    # nonzero blob from the singular homography -- this reliably yields an
    # empty alpha mask, exercising the guard)
    degenerate_text_corners = np.float32([[300, 300], [300, 300], [300, 310], [300, 310]])
    req = ReplaceRequest(
        image=scene, corners=bars_corners, symbology="code128",
        value="SPLITME1", options=GenerateOptions(show_text=True),
        blend_mode="normal", text_corners=degenerate_text_corners,
    )
    res = replace_barcode(req)  # must not raise
    assert res.result.shape == scene.shape

    # the region around the degenerate quad is unchanged from the original scene
    around = scene[290:310, 290:310]
    result_around = res.result[290:310, 290:310]
    assert np.array_equal(around, result_around)
