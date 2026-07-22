import numpy as np
import pytest
from pipeline.generate import generate_barcode, generate_barcode_fit, generate_barcode_split, GenerateOptions, GenerateError

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

def test_generate_barcode_fit_sizes_to_a_small_target_without_extreme_downscale():
    # a barcode's own bars are a fine periodic pattern -- if the generated
    # bitmap is much bigger than the actual on-photo placement, the warp
    # that shrinks it down to fit has to alias that pattern, which can
    # distort bar widths enough to break scanning entirely (confirmed:
    # a bitmap oversampled far past a small target's actual size failed to
    # decode after warping, regardless of interpolation filter). Sizing to
    # the real target keeps the eventual downscale mild.
    res = generate_barcode_fit("code128", "HELLO123", GenerateOptions(),
                                target_aspect=2.5, target_width_px=300)
    h, w = res.bitmap.shape[:2]
    assert w < 300 * 2.5  # not wildly oversized relative to the target

def test_generate_barcode_fit_sizes_up_for_a_large_target():
    # the opposite case: a close-up photo where the barcode's on-photo
    # placement is large. Without sizing up to match, the warp has to
    # upscale a small bitmap, blurring bar edges.
    res = generate_barcode_fit("code128", "HELLO123", GenerateOptions(),
                                target_aspect=2.5, target_width_px=3000)
    h, w = res.bitmap.shape[:2]
    assert w > 3000  # rendered with headroom above the target, not below it

def test_generate_barcode_fit_leaves_qr_square_regardless_of_target_aspect():
    fitted = generate_barcode_fit("qr", "https://example.com", GenerateOptions(), target_aspect=3.0)
    plain = generate_barcode("qr", "https://example.com", GenerateOptions())
    assert fitted.bitmap.shape == plain.bitmap.shape

def test_generate_barcode_fit_falls_back_on_degenerate_target_aspect():
    res = generate_barcode_fit("code128", "HELLO123", GenerateOptions(), target_aspect=0.0)
    plain = generate_barcode("code128", "HELLO123", GenerateOptions())
    assert res.bitmap.shape == plain.bitmap.shape

def test_font_size_scales_down_with_small_module_height():
    small = generate_barcode("code128", "ABC1234567", GenerateOptions(module_height=4.0, show_text=True))
    small_no_text = generate_barcode("code128", "ABC1234567", GenerateOptions(module_height=4.0, show_text=False))
    default = generate_barcode("code128", "ABC1234567", GenerateOptions(module_height=15.0, show_text=True))
    default_no_text = generate_barcode("code128", "ABC1234567", GenerateOptions(module_height=15.0, show_text=False))
    small_overhead = small.bitmap.shape[0] - small_no_text.bitmap.shape[0]
    default_overhead = default.bitmap.shape[0] - default_no_text.bitmap.shape[0]
    # a fixed font size makes text proportionally huge on short bars; scaling
    # it down with module_height keeps the text-to-bar proportion sane
    assert small_overhead < default_overhead

def test_bars_are_rendered_above_the_librarys_bare_default_resolution():
    # a barcode placed on a real photo gets perspective-warped onto the
    # target quad afterward. The library's own 300dpi default renders the
    # narrowest module at only ~2px, giving that warp almost nothing to
    # sample from on any upscale. This is just a floor for callers that
    # don't know the eventual placement size (generate_barcode_fit's
    # target_width_px sizes properly to the real target when it's known --
    # see the "sizes_to_a_small_target"/"sizes_up_for_a_large_target" tests).
    res = generate_barcode("code128", "ABC1234567", GenerateOptions(show_text=False))
    row = res.bitmap[res.bitmap.shape[0] // 2, :, 0]
    # length of the shortest run of same-valued pixels along the row --
    # i.e. the narrowest single module, in pixels
    changes = np.where(np.diff(row) != 0)[0]
    run_lengths = np.diff(np.concatenate([[0], changes, [len(row) - 1]]))
    assert run_lengths.min() >= 3

def test_generate_barcode_split_returns_bars_and_text_bitmaps_separately():
    full, bars, text = generate_barcode_split("code128", "HELLO123", GenerateOptions(show_text=True), target_aspect=2.5)
    assert text is not None
    assert bars.shape[1] == full.bitmap.shape[1]  # same width
    assert text.shape[1] == full.bitmap.shape[1]
    assert bars.shape[0] + text.shape[0] == full.bitmap.shape[0]
    assert (text < 200).any()  # the rendered text itself

def test_generate_barcode_split_returns_none_text_when_show_text_is_off():
    full, bars, text = generate_barcode_split("code128", "HELLO123", GenerateOptions(show_text=False), target_aspect=2.5)
    assert text is None
    assert bars.shape == full.bitmap.shape

def test_generate_barcode_split_returns_none_text_for_qr():
    full, bars, text = generate_barcode_split("qr", "https://example.com", GenerateOptions(show_text=True), target_aspect=1.0)
    assert text is None
    assert bars.shape == full.bitmap.shape

def test_generate_barcode_split_fits_bars_crop_to_target_aspect():
    # the bars crop gets warped onto its own placement quad independently of
    # the text crop, so ITS aspect ratio must match target_aspect -- not the
    # combined bars+text bitmap's aspect ratio (which includes extra height
    # from the text row and would leave the bars distorted once warped)
    full, bars, text = generate_barcode_split("code128", "HELLO123", GenerateOptions(show_text=True), target_aspect=2.5)
    bh, bw = bars.shape[:2]
    assert bw / bh == pytest.approx(2.5, rel=0.02)

def test_text_font_scale_changes_text_height_independent_of_bars():
    base_full, base_bars, base_text = generate_barcode_split(
        "code128", "HELLO123", GenerateOptions(show_text=True), target_aspect=2.5)
    scaled_full, scaled_bars, scaled_text = generate_barcode_split(
        "code128", "HELLO123", GenerateOptions(show_text=True, text_font_scale=1.8),
        target_aspect=2.5)
    # bars crop comes from a text-off render, so it must be pixel-identical
    # regardless of text_font_scale -- confirms the two are truly decoupled
    assert np.array_equal(scaled_bars, base_bars)
    # a bigger font_size renders taller text
    assert scaled_text.shape[0] > base_text.shape[0]

def test_font_size_is_capped_for_very_large_module_height():
    mid = generate_barcode("code128", "ABC1234567", GenerateOptions(module_height=25.0, show_text=True))
    mid_no_text = generate_barcode("code128", "ABC1234567", GenerateOptions(module_height=25.0, show_text=False))
    large = generate_barcode("code128", "ABC1234567", GenerateOptions(module_height=60.0, show_text=True))
    large_no_text = generate_barcode("code128", "ABC1234567", GenerateOptions(module_height=60.0, show_text=False))
    mid_overhead = mid.bitmap.shape[0] - mid_no_text.bitmap.shape[0]
    large_overhead = large.bitmap.shape[0] - large_no_text.bitmap.shape[0]
    # module_height more than doubles (25 -> 60); if font size scaled
    # unbounded, text overhead would grow by a similar factor. Capped, it
    # should barely grow at all.
    assert large_overhead < mid_overhead * 1.3
