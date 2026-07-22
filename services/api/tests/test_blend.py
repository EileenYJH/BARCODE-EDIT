import numpy as np
import cv2
from pipeline.blend import seamless_blend

def _seam_energy(img, mask):
    edge = cv2.morphologyEx(mask, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
    lap = cv2.Laplacian(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), cv2.CV_64F)
    return float(np.abs(lap)[edge > 0].mean())

def test_seamless_blend_has_softer_seam_than_hard_paste():
    bg = np.full((200, 200, 3), 180, dtype=np.uint8)
    patch = np.full((200, 200, 3), 60, dtype=np.uint8)
    mask = np.zeros((200, 200), np.uint8)
    cv2.rectangle(mask, (70, 70), (130, 130), 255, -1)

    hard = bg.copy()
    hard[mask > 0] = patch[mask > 0]

    blended = seamless_blend(patch, bg, mask, mode="normal")
    assert blended.shape == bg.shape
    assert _seam_energy(blended, mask) < _seam_energy(hard, mask)

def test_seamless_blend_follows_destination_lighting_gradient():
    # a real product label often has its own lighting gradient (a
    # highlight/shadow sweeping across the surface). A flat-toned patch
    # (a single uniform paper-white value everywhere, as a plain tone-match
    # produces) reads as an obvious rectangular "sticker" against that real
    # gradient -- confirmed via a real product photo where the pasted
    # patch's uniform tone visibly broke from the label's natural brightness
    # falloff right at the mask edge. The blended patch should instead
    # follow the destination's own left-to-right gradient here, not stay
    # flat.
    dst = np.zeros((200, 200, 3), dtype=np.uint8)
    for x in range(200):
        dst[:, x] = int(80 + x * 0.6)  # left ~80, right ~200
    patch = np.full((200, 200, 3), 150, dtype=np.uint8)  # flat mid-gray "paper"
    mask = np.zeros((200, 200), np.uint8)
    cv2.rectangle(mask, (50, 50), (150, 150), 255, -1)

    blended = seamless_blend(patch, dst, mask, mode="normal")
    left = blended[90:110, 60:80].mean()
    right = blended[90:110, 120:140].mean()
    # the right side of the patch sits on a brighter part of the gradient
    # than the left side -- a flat composite would make these equal
    assert right - left > 20

def test_seamless_blend_ignores_nearby_unrelated_features_for_a_thin_wide_mask():
    # A real label's separately-placed text row (via text_corners) is thin
    # and wide (e.g. the existing 400x40 fixture in test_orchestrator.py),
    # unlike the roughly square-ish bars region. If a printed rule line or
    # border sits close to the text row (very plausible -- captions and
    # rule lines are often near the barcode's value text), local_tone_correct
    # must not let that nearby feature dominate the ambient estimate for the
    # whole strip -- confirmed via direct reproduction: coupling the blur's
    # sigma to the CURRENT mask's own (small) height let a thin dark rule
    # line immediately above/below the mask pull the corrected interior down
    # to ~99 on a uniform 200-value paper background, instead of ~200.
    dst = np.full((250, 500, 3), 200, dtype=np.uint8)  # uniform bright paper
    dst[95:100, :] = 90    # thin dark rule line just above the mask
    dst[140:145, :] = 90   # thin dark rule line just below the mask
    patch = np.full((250, 500, 3), 150, dtype=np.uint8)  # flat mid-gray "paper"
    mask = np.zeros((250, 500), np.uint8)
    cv2.rectangle(mask, (50, 100), (450, 140), 255, -1)  # wide-short: 400x40

    blended = seamless_blend(patch, dst, mask, mode="normal")
    center = blended[115:125, 200:300].mean()
    # today's mask-size-coupled sigma lands around ~99-110; the fix should
    # land much closer to the true 200 paper tone
    assert center > 150
