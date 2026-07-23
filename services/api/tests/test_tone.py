import numpy as np
from pipeline.tone import match_tone

def test_match_tone_shifts_mean_toward_target():
    # bright white barcode with dark bars in columns 0, 4, 8, ...
    barcode = np.full((50, 80, 3), 255, dtype=np.uint8)
    barcode[:, ::4] = 0
    alpha = np.full((50, 80), 255, dtype=np.uint8)
    # target surface is darker than the barcode's white paper
    target_region = np.full((50, 80, 3), 150, dtype=np.uint8)

    out = match_tone(barcode, alpha, target_region)
    painted = out[alpha > 0]
    # overall mean shifts down toward the darker surface
    assert painted.mean() < barcode[alpha > 0].mean()
    # a light module pixel stays lighter than a dark bar pixel after toning
    light_px = out[0, 1].mean()  # column 1 was white paper
    dark_px = out[0, 0].mean()   # column 0 was a dark bar
    assert light_px > dark_px

def test_match_tone_keeps_bar_edges_sharp_by_default():
    # a wide white block next to a wide black block -- a hard bar edge,
    # like a real barcode bar against its quiet zone
    barcode = np.full((20, 20, 3), 255, dtype=np.uint8)
    barcode[:, 10:] = 0
    alpha = np.full((20, 20), 255, dtype=np.uint8)
    target_region = barcode.copy()  # surface tone already matches; isolates blur behavior

    out = match_tone(barcode, alpha, target_region)
    # columns right at the edge should stay close to their original crisp
    # values, not blended into a gray gradient across the boundary
    last_white_col = out[10, 9].astype(int)
    first_black_col = out[10, 10].astype(int)
    assert last_white_col.mean() > 200  # still clearly white, not softened toward gray
    assert first_black_col.mean() < 55  # still clearly black, not softened toward gray

def test_match_tone_keeps_bars_dark_on_a_bright_surface():
    # a real barcode label is opaque -- its own black ink shouldn't get
    # visibly lifted toward gray just because it sits on a bright surface
    # (a common case: white product packaging/appliances)
    barcode = np.full((20, 20, 3), 255, dtype=np.uint8)
    barcode[:, 10:] = 0
    alpha = np.full((20, 20), 255, dtype=np.uint8)
    bright_surface = np.full((20, 20, 3), 215, dtype=np.uint8)  # bright white surface

    out = match_tone(barcode, alpha, bright_surface)
    dark_bar_px = out[10, 15].astype(int)
    assert dark_bar_px.mean() < 20  # stays close to true black, not lifted to visible gray
