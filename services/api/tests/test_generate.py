import numpy as np
import pytest
from pipeline.generate import generate_barcode, GenerateOptions, GenerateError

def test_ean13_returns_bitmap_and_svg():
    res = generate_barcode("ean13", "5901234123457", GenerateOptions())
    assert isinstance(res.bitmap, np.ndarray)
    assert res.bitmap.ndim == 3 and res.bitmap.shape[2] == 3
    assert res.bitmap.shape[0] > 0 and res.bitmap.shape[1] > 0
    assert "<svg" in res.svg.lower()

def test_hide_text_is_shorter_than_show_text():
    shown = generate_barcode("code128", "HELLO", GenerateOptions(show_text=True))
    hidden = generate_barcode("code128", "HELLO", GenerateOptions(show_text=False))
    assert hidden.bitmap.shape[0] < shown.bitmap.shape[0]

def test_qr_generates():
    res = generate_barcode("qr", "https://example.com", GenerateOptions())
    assert res.bitmap.shape[0] > 0

def test_invalid_ean13_raises():
    with pytest.raises(GenerateError):
        generate_barcode("ean13", "123", GenerateOptions())

def test_unknown_symbology_raises():
    with pytest.raises(GenerateError):
        generate_barcode("aztec", "x", GenerateOptions())
