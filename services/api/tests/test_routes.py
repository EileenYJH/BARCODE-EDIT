from fastapi.testclient import TestClient
from main import app
from imgio import ndarray_to_b64
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
