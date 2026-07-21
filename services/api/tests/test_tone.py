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
