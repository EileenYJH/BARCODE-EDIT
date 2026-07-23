import numpy as np
import pytest
from pipeline import segment


def test_checkpoint_path_missing_raises_segmentation_error(monkeypatch, tmp_path):
    monkeypatch.setenv("SAM2_MODELS_DIR", str(tmp_path))
    segment._MODEL_STATE["predictor"] = None
    segment._MODEL_STATE["mask_generator"] = None
    with pytest.raises(segment.SegmentationError, match="checkpoint not found"):
        segment._load_model()


def test_detect_device_prefers_cuda(monkeypatch):
    class FakeCuda:
        @staticmethod
        def is_available():
            return True

    class FakeTorch:
        cuda = FakeCuda()

    monkeypatch.setattr(segment, "_import_torch", lambda: FakeTorch())
    assert segment._detect_device() == "cuda"


def test_detect_device_falls_back_to_cpu(monkeypatch):
    class FakeBackendsMps:
        @staticmethod
        def is_available():
            return False

    class FakeBackends:
        mps = FakeBackendsMps()

    class FakeCuda:
        @staticmethod
        def is_available():
            return False

    class FakeTorch:
        cuda = FakeCuda()
        backends = FakeBackends()

    monkeypatch.setattr(segment, "_import_torch", lambda: FakeTorch())
    assert segment._detect_device() == "cpu"


def test_box_from_corners_returns_xyxy():
    corners = np.float32([[10, 20], [110, 20], [110, 220], [10, 220]])
    box = segment._box_from_corners(corners)
    assert box.tolist() == pytest.approx([10.0, 20.0, 110.0, 220.0])


def _square_mask(h, w, x0, y0, x1, y1):
    m = np.zeros((h, w), dtype=np.uint8)
    m[y0:y1, x0:x1] = 255
    return m


def test_select_label_mask_picks_largest_enclosing_candidate():
    barcode_mask = _square_mask(100, 100, 40, 40, 60, 60)  # small, centered
    small_unrelated = _square_mask(100, 100, 0, 0, 10, 10)
    label_candidate = _square_mask(100, 100, 20, 20, 80, 80)  # encloses barcode
    masks = [
        {"segmentation": small_unrelated.astype(bool), "area": 100},
        {"segmentation": label_candidate.astype(bool), "area": 3600},
    ]
    selected = segment._select_label_mask(masks, barcode_mask)
    assert np.array_equal(selected, label_candidate)


def test_select_label_mask_falls_back_to_barcode_mask_when_nothing_encloses_it():
    barcode_mask = _square_mask(100, 100, 40, 40, 60, 60)
    unrelated = _square_mask(100, 100, 0, 0, 10, 10)
    masks = [{"segmentation": unrelated.astype(bool), "area": 100}]
    selected = segment._select_label_mask(masks, barcode_mask)
    assert np.array_equal(selected, barcode_mask)


def test_select_label_mask_picks_larger_of_two_qualifying_candidates():
    barcode_mask = _square_mask(100, 100, 40, 40, 60, 60)
    smaller_candidate = _square_mask(100, 100, 30, 30, 70, 70)   # encloses barcode, area 1600
    larger_candidate = _square_mask(100, 100, 10, 10, 90, 90)    # encloses barcode, area 6400
    masks = [
        {"segmentation": smaller_candidate.astype(bool), "area": 1600},
        {"segmentation": larger_candidate.astype(bool), "area": 6400},
    ]
    selected = segment._select_label_mask(masks, barcode_mask)
    assert np.array_equal(selected, larger_candidate)
