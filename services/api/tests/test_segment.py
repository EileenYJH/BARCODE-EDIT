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
