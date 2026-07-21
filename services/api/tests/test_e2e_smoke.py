from fastapi.testclient import TestClient
from main import app
from imgio import ndarray_to_b64, b64_to_ndarray
from tests.fixtures import make_scene
import numpy as np

client = TestClient(app)

def test_full_replace_changes_region_only():
    scene, corners, meta = make_scene(warp=False)
    detected = client.post("/api/detect", json={"image": ndarray_to_b64(scene)}).json()
    quad = detected["detections"][0]["corners"]
    r = client.post("/api/replace", json={
        "image": ndarray_to_b64(scene), "corners": quad,
        "symbology": "code128", "value": "SMOKE123",
        "options": {"show_text": False}, "blend_mode": "normal",
    })
    assert r.status_code == 200
    out = b64_to_ndarray(r.json()["result"])
    assert out.shape == scene.shape
    # far corner of image (away from barcode) is unchanged
    assert np.array_equal(out[0:20, 0:20], scene[0:20, 0:20])
