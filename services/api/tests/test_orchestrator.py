import re
import numpy as np
import pytest
from unittest.mock import patch
from pipeline.orchestrator import replace_barcode, ReplaceRequest, _flatten_candidate_regions
from pipeline.generate import GenerateOptions
from pipeline.warp import quad_aspect_ratio
from pipeline import segment
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

def test_replace_barcode_omits_segmentation_layers_when_sam2_unavailable():
    scene, corners, meta = make_scene(warp=False)
    req = ReplaceRequest(
        image=scene, corners=corners, symbology="code128",
        value="NEWVALUE", options=GenerateOptions(show_text=False),
        blend_mode="normal",
    )
    # No weights/torch present in the default test env -> segment_label raises.
    res = replace_barcode(req)
    assert set(res.layers.keys()) == {"original", "new_barcode", "mask"}

def test_replace_barcode_adds_segmentation_layers_when_available():
    scene, corners, meta = make_scene(warp=False)
    h, w = scene.shape[:2]
    fake_result = segment.SegmentationResult(
        label_mask=np.full((h, w), 255, dtype=np.uint8),
        barcode_mask=np.full((h, w), 255, dtype=np.uint8),
        candidate_regions=[np.full((h, w), 255, dtype=np.uint8)],
    )
    req = ReplaceRequest(
        image=scene, corners=corners, symbology="code128",
        value="NEWVALUE", options=GenerateOptions(show_text=False),
        blend_mode="normal",
    )
    with patch("pipeline.orchestrator.segment_label", return_value=fake_result):
        res = replace_barcode(req)
    assert set(res.layers.keys()) == {
        "original", "new_barcode", "mask",
        "label_mask", "sam_barcode_mask", "candidate_regions",
    }

def test_replace_barcode_includes_blank_candidate_regions_key_when_none_found():
    scene, corners, meta = make_scene(warp=False)
    h, w = scene.shape[:2]
    fake_result = segment.SegmentationResult(
        label_mask=np.full((h, w), 255, dtype=np.uint8),
        barcode_mask=np.full((h, w), 255, dtype=np.uint8),
        candidate_regions=[],
    )
    req = ReplaceRequest(
        image=scene, corners=corners, symbology="code128",
        value="NEWVALUE", options=GenerateOptions(show_text=False),
        blend_mode="normal",
    )
    with patch("pipeline.orchestrator.segment_label", return_value=fake_result):
        res = replace_barcode(req)
    assert "candidate_regions" in res.layers
    assert res.layers["candidate_regions"].sum() == 0

def test_flatten_candidate_regions_empty_list_returns_all_zero():
    flattened = _flatten_candidate_regions([], (10, 20))
    assert flattened.shape == (10, 20)
    assert flattened.dtype == np.uint8
    assert flattened.sum() == 0

def test_flatten_candidate_regions_ors_multiple_masks():
    a = np.zeros((10, 10), dtype=np.uint8)
    a[0:5, 0:5] = 255
    b = np.zeros((10, 10), dtype=np.uint8)
    b[5:10, 5:10] = 255
    flattened = _flatten_candidate_regions([a, b], (10, 10))
    expected = np.zeros((10, 10), dtype=np.uint8)
    expected[0:5, 0:5] = 255
    expected[5:10, 5:10] = 255
    assert np.array_equal(flattened, expected)
