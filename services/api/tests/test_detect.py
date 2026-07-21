import numpy as np
from pipeline.detect import detect_barcodes
from tests.fixtures import make_scene


def _center(q: np.ndarray) -> np.ndarray:
    return q.mean(axis=0)


def _area(q: np.ndarray) -> float:
    x, y = q[:, 0], q[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))


def test_detects_barcode_at_true_location():
    scene, corners, meta = make_scene(warp=False)
    dets = detect_barcodes(scene)
    assert len(dets) >= 1
    best = dets[0]
    assert best.corners.shape == (4, 2)
    # Located at the right place: detected centre near the true centre.
    assert np.linalg.norm(_center(best.corners) - _center(corners)) < 25
    # Covers a substantial fraction of the true barcode area (classical
    # detection finds the bar region, inset from the quiet zone/padding).
    assert _area(best.corners) > 0.4 * _area(corners)
    # Payload recovered via pyzbar.
    assert best.value == "TESTCODE"


def test_no_barcode_returns_empty():
    blank = np.full((300, 300, 3), 200, dtype=np.uint8)
    assert detect_barcodes(blank) == []
