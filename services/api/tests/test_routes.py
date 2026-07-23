from fastapi.testclient import TestClient
from main import app
from imgio import ndarray_to_b64
from tests.fixtures import make_scene
import numpy as np
from unittest.mock import patch
from pipeline import segment

client = TestClient(app)

def test_detect_endpoint_returns_detections():
    scene, corners, meta = make_scene(warp=False)
    r = client.post("/api/detect", json={"image": ndarray_to_b64(scene)})
    assert r.status_code == 200
    body = r.json()
    assert "detections" in body
    assert len(body["detections"]) >= 1
    assert len(body["detections"][0]["corners"]) == 4

def test_replace_endpoint_returns_result():
    scene, corners, meta = make_scene(warp=False)
    payload = {
        "image": ndarray_to_b64(scene),
        "corners": corners.tolist(),
        "symbology": "code128",
        "value": "NEWVALUE",
        "options": {"show_text": False},
        "blend_mode": "normal",
    }
    r = client.post("/api/replace", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["result"].startswith("data:image/png;base64,")
    assert "<svg" in body["svg"].lower()
    assert set(body["layers"].keys()) == {"original", "new_barcode", "mask"}

def test_replace_invalid_ean13_returns_422():
    scene, corners, meta = make_scene(warp=False)
    payload = {
        "image": ndarray_to_b64(scene),
        "corners": corners.tolist(),
        "symbology": "ean13", "value": "123",
        "options": {}, "blend_mode": "normal",
    }
    r = client.post("/api/replace", json=payload)
    assert r.status_code == 422

def test_segment_endpoint_returns_masks():
    scene, corners, meta = make_scene(warp=False)
    h, w = scene.shape[:2]
    fake_result = segment.SegmentationResult(
        label_mask=np.full((h, w), 255, dtype=np.uint8),
        barcode_mask=np.full((h, w), 255, dtype=np.uint8),
        candidate_regions=[np.full((h, w), 255, dtype=np.uint8)],
    )
    payload = {"image": ndarray_to_b64(scene), "corners": corners.tolist()}
    with patch("routes.segment_label", return_value=fake_result):
        r = client.post("/api/segment", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["label_mask"].startswith("data:image/png;base64,")
    assert body["barcode_mask"].startswith("data:image/png;base64,")
    assert len(body["candidate_regions"]) == 1


def test_segment_endpoint_returns_422_when_sam2_unavailable():
    scene, corners, meta = make_scene(warp=False)
    payload = {"image": ndarray_to_b64(scene), "corners": corners.tolist()}
    r = client.post("/api/segment", json=payload)
    # No weights/torch present in the default test env.
    assert r.status_code == 422


def test_segment_endpoint_returns_422_on_malformed_corners():
    scene, corners, meta = make_scene(warp=False)
    payload = {
        "image": ndarray_to_b64(scene),
        # ragged inner-list lengths -> np.float32() raises ValueError
        # ("inhomogeneous shape"), not a clean HTTP-level validation error.
        "corners": [[1, 2], [3, 4, 5]],
    }
    r = client.post("/api/segment", json=payload)
    assert r.status_code == 422
