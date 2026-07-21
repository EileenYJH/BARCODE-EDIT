import numpy as np
import pytest
from pipeline.generate import generate_barcode, generate_barcode_fit, GenerateOptions, GenerateError

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

def test_generate_barcode_fit_matches_target_aspect_for_linear_symbology():
    res = generate_barcode_fit("code128", "HELLO123", GenerateOptions(), target_aspect=1.0)
    h, w = res.bitmap.shape[:2]
    assert w / h == pytest.approx(1.0, rel=0.02)

def test_generate_barcode_fit_matches_a_different_target_aspect():
    res = generate_barcode_fit("ean13", "5901234123457", GenerateOptions(), target_aspect=2.5)
    h, w = res.bitmap.shape[:2]
    assert w / h == pytest.approx(2.5, rel=0.02)

def test_generate_barcode_fit_leaves_qr_square_regardless_of_target_aspect():
    fitted = generate_barcode_fit("qr", "https://example.com", GenerateOptions(), target_aspect=3.0)
    plain = generate_barcode("qr", "https://example.com", GenerateOptions())
    assert fitted.bitmap.shape == plain.bitmap.shape

def test_generate_barcode_fit_falls_back_on_degenerate_target_aspect():
    res = generate_barcode_fit("code128", "HELLO123", GenerateOptions(), target_aspect=0.0)
    plain = generate_barcode("code128", "HELLO123", GenerateOptions())
    assert res.bitmap.shape == plain.bitmap.shape
