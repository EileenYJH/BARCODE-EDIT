import numpy as np
from tests.fixtures import make_scene

def test_make_scene_returns_image_and_corners():
    scene, corners, meta = make_scene()
    assert scene.ndim == 3 and scene.shape[2] == 3
    assert corners.shape == (4, 2)
    h, w = scene.shape[:2]
    assert corners[:, 0].min() >= 0 and corners[:, 0].max() <= w
    assert corners[:, 1].min() >= 0 and corners[:, 1].max() <= h
    assert meta["symbology"] == "code128"
