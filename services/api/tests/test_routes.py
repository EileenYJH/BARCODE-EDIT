import numpy as np
import cv2
from fastapi.testclient import TestClient
from main import app
from imgio import ndarray_to_b64, b64_to_ndarray
from tests.fixtures import make_scene

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

def test_replace_endpoint_places_bars_and_text_independently():
    scene = np.full((400, 900, 3), 220, np.uint8)
    bars_corners = [[100, 100], [500, 100], [500, 180], [100, 180]]
    text_corners = [[100, 190], [500, 190], [500, 230], [100, 230]]
    payload = {
        "image": ndarray_to_b64(scene),
        "corners": bars_corners,
        "symbology": "code128",
        "value": "SPLITME1",
        "options": {"show_text": True},
        "blend_mode": "normal",
        "text_corners": text_corners,
    }
    r = client.post("/api/replace", json=payload)
    assert r.status_code == 200
    result = b64_to_ndarray(r.json()["result"])
    bars_mask = np.zeros(scene.shape[:2], np.uint8)
    cv2.fillPoly(bars_mask, [np.array(bars_corners, dtype=np.int32)], 255)
    text_mask = np.zeros(scene.shape[:2], np.uint8)
    cv2.fillPoly(text_mask, [np.array(text_corners, dtype=np.int32)], 255)
    # both regions changed from the original scene -- proves text_corners
    # actually reached the orchestrator and got its own placement, not just
    # that the request was accepted
    assert np.abs(result[bars_mask > 0].astype(int) - scene[bars_mask > 0].astype(int)).mean() > 5
    assert np.abs(result[text_mask > 0].astype(int) - scene[text_mask > 0].astype(int)).mean() > 5

def test_replace_endpoint_rejects_out_of_bounds_text_corners():
    scene, corners, meta = make_scene(warp=False)
    payload = {
        "image": ndarray_to_b64(scene),
        "corners": corners.tolist(),
        "symbology": "code128", "value": "NEWVALUE",
        "options": {"show_text": True}, "blend_mode": "normal",
        "text_corners": [[10, 10], [20, 10], [20, 20000], [10, 20]],
    }
    r = client.post("/api/replace", json=payload)
    assert r.status_code == 422
