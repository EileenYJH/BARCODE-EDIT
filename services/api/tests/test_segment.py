import numpy as np
import pytest
from pipeline import segment


def test_checkpoint_path_missing_raises_segmentation_error(monkeypatch, tmp_path):
    monkeypatch.setenv("SAM2_MODELS_DIR", str(tmp_path))
    segment._MODEL_STATE["loaded"] = None
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


class _FakePredictor:
    def set_image(self, img):
        self.img_shape = img.shape[:2]

    def predict(self, box, multimask_output):
        h, w = self.img_shape
        mask = _square_mask(h, w, int(box[0][0]), int(box[0][1]), int(box[0][2]), int(box[0][3]))
        return np.array([mask.astype(bool)]), np.array([0.9]), None


class _FakeMaskGenerator:
    def __init__(self, extra_masks):
        self.extra_masks = extra_masks

    def generate(self, img):
        return self.extra_masks


def test_segment_label_returns_full_result(monkeypatch):
    h, w = 100, 100
    label_mask = _square_mask(h, w, 20, 20, 80, 80)
    other_region = _square_mask(h, w, 25, 60, 35, 70)          # inside label, not barcode
    outside_region = _square_mask(h, w, 0, 0, 10, 10)          # outside label

    fake_masks = [
        {"segmentation": label_mask.astype(bool), "area": 3600},
        {"segmentation": other_region.astype(bool), "area": 100},
        {"segmentation": outside_region.astype(bool), "area": 100},
    ]

    monkeypatch.setattr(
        segment, "_load_model",
        lambda: (_FakePredictor(), _FakeMaskGenerator(fake_masks)),
    )

    img = np.zeros((h, w, 3), dtype=np.uint8)
    corners = np.float32([[40, 40], [60, 40], [60, 60], [40, 60]])
    result = segment.segment_label(img, barcode_corners=corners)

    assert np.array_equal(result.label_mask, label_mask)
    assert result.barcode_mask.sum() > 0
    assert len(result.candidate_regions) == 1
    assert np.array_equal(result.candidate_regions[0], other_region)


def test_segment_label_wraps_unexpected_errors(monkeypatch):
    def _boom():
        raise RuntimeError("gpu exploded")

    monkeypatch.setattr(segment, "_load_model", _boom)
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    corners = np.float32([[1, 1], [5, 1], [5, 5], [1, 5]])
    with pytest.raises(segment.SegmentationError, match="segmentation failed"):
        segment.segment_label(img, barcode_corners=corners)


def test_segment_label_raises_when_no_corners_given(monkeypatch):
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    with pytest.raises(segment.SegmentationError, match="barcode_corners"):
        segment.segment_label(img)


def _weights_available() -> bool:
    return segment._checkpoint_path().exists()


@pytest.mark.skipif(not _weights_available(), reason="SAM2 checkpoint not downloaded")
def test_segment_label_real_inference_smoke():
    segment._MODEL_STATE["loaded"] = None
    img = np.full((256, 256, 3), 200, dtype=np.uint8)
    corners = np.float32([[80, 80], [180, 80], [180, 160], [80, 160]])
    result = segment.segment_label(img, barcode_corners=corners)
    assert result.label_mask.shape == (256, 256)
    assert result.barcode_mask.shape == (256, 256)
    assert result.label_mask.dtype == np.uint8
