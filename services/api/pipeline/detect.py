from dataclasses import dataclass, field
from typing import List, Optional
import numpy as np
import cv2

try:
    from pyzbar import pyzbar
    _HAS_ZBAR = True
except Exception:  # pragma: no cover - environment without ZBar native lib
    _HAS_ZBAR = False


@dataclass
class Detection:
    corners: np.ndarray            # (4,2) float32, ordered tl,tr,br,bl
    type: Optional[str] = None
    value: Optional[str] = None
    confidence: float = 0.0
    bbox: tuple = field(default=())  # x,y,w,h


def _order_quad(pts: np.ndarray) -> np.ndarray:
    """Order 4 points as tl, tr, br, bl."""
    pts = pts.astype(np.float32)
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    tl = pts[np.argmin(s)]
    br = pts[np.argmax(s)]
    tr = pts[np.argmin(d)]
    bl = pts[np.argmax(d)]
    return np.float32([tl, tr, br, bl])


def _bbox(corners: np.ndarray) -> tuple:
    x, y, w, h = cv2.boundingRect(corners.astype(np.int32))
    return (int(x), int(y), int(w), int(h))


def _is_degenerate(pts: np.ndarray) -> bool:
    """True if the point set collapses to a line/point (no usable area)."""
    if len(pts) < 3:
        return True
    _, _, w, h = cv2.boundingRect(pts.astype(np.int32))
    return w < 5 or h < 5


def _zbar_decode(img: np.ndarray):
    """Decode with pyzbar. Returns list of (corners_or_None, type, value).

    pyzbar reliably recovers the symbology and payload, but its polygon is
    often degenerate (zero-width) once a barcode has been warped/composited,
    so corners are only trusted when they enclose real area.
    """
    results = []
    if not _HAS_ZBAR:
        return results
    for r in pyzbar.decode(img):
        pts = (np.float32([[p.x, p.y] for p in r.polygon])
               if r.polygon else np.empty((0, 2), np.float32))
        corners = None
        if len(pts) >= 4 and not _is_degenerate(pts):
            quad = pts if len(pts) == 4 else cv2.boxPoints(cv2.minAreaRect(pts))
            corners = _order_quad(quad)
        results.append((corners, r.type, r.data.decode("utf-8", "replace")))
    return results


def _opencv_quads(gray: np.ndarray) -> List[np.ndarray]:
    """Geometric barcode localization via cv2.barcode. Returns ordered quads.

    In OpenCV 5, detect() returns (ok, points) with points shaped (N,4,2); it
    localizes the bar region reliably even when detectAndDecode fails to decode.
    """
    try:
        ok, points = cv2.barcode.BarcodeDetector().detect(gray)
    except Exception:  # pragma: no cover - defensive
        ok, points = False, None
    quads: List[np.ndarray] = []
    if ok and points is not None:
        for quad in np.asarray(points, dtype=np.float32).reshape(-1, 4, 2):
            quads.append(_order_quad(quad))
    return quads


def detect_barcodes(img: np.ndarray) -> List[Detection]:
    """Locate barcodes and, where possible, decode their type/value.

    Strategy: take corner geometry from OpenCV's barcode detector (robust), and
    attach the nearest pyzbar decode for type/value. Fall back to pyzbar's own
    (non-degenerate) polygon if OpenCV localizes nothing.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    zbar = _zbar_decode(img)
    quads = _opencv_quads(gray)

    dets: List[Detection] = []
    if quads:
        for q in quads:
            qc = q.mean(axis=0)
            typ, val, best_d = None, None, float("inf")
            for corners, z_type, z_val in zbar:
                center = corners.mean(axis=0) if corners is not None else qc
                d = float(np.linalg.norm(center - qc))
                if d < best_d:
                    best_d, typ, val = d, z_type, z_val
            confidence = 0.85 if val is not None else 0.6
            dets.append(Detection(corners=q, type=typ, value=val,
                                  confidence=confidence, bbox=_bbox(q)))
    else:
        for corners, z_type, z_val in zbar:
            if corners is not None:
                dets.append(Detection(corners=corners, type=z_type, value=z_val,
                                      confidence=0.7, bbox=_bbox(corners)))

    dets.sort(key=lambda d: d.confidence, reverse=True)
    return dets
