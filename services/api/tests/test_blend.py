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
