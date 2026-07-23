import numpy as np
from fastapi import APIRouter, HTTPException
from imgio import b64_to_ndarray, ndarray_to_b64
from schemas import (DetectRequest, DetectResponse, DetectionOut,
                     ReplaceRequestIn, ReplaceResponse)
from pipeline.detect import detect_barcodes
from pipeline.generate import GenerateOptions, GenerateError
from pipeline.orchestrator import replace_barcode, ReplaceRequest

router = APIRouter(prefix="/api")

@router.post("/detect", response_model=DetectResponse)
def detect(req: DetectRequest):
    try:
        img = b64_to_ndarray(req.image)
    except ValueError:
        raise HTTPException(status_code=415, detail="unreadable image")
    dets = detect_barcodes(img)
    return DetectResponse(detections=[
        DetectionOut(corners=d.corners.tolist(), type=d.type, value=d.value,
                     confidence=d.confidence, bbox=list(d.bbox))
        for d in dets
    ])

def _validate_corners_in_bounds(corners: np.ndarray, w: int, h: int, label: str):
    if (corners[:, 0].min() < 0 or corners[:, 1].min() < 0 or
            corners[:, 0].max() > w or corners[:, 1].max() > h):
        raise HTTPException(status_code=422, detail=f"{label} out of bounds")

@router.post("/replace", response_model=ReplaceResponse)
def replace(req: ReplaceRequestIn):
    try:
        img = b64_to_ndarray(req.image)
    except ValueError:
        raise HTTPException(status_code=415, detail="unreadable image")
    h, w = img.shape[:2]
    corners = np.float32(req.corners)
    _validate_corners_in_bounds(corners, w, h, "corners")
    text_corners = None
    if req.text_corners is not None:
        text_corners = np.float32(req.text_corners)
        _validate_corners_in_bounds(text_corners, w, h, "text_corners")
    opts = GenerateOptions(**req.options.model_dump())
    try:
        res = replace_barcode(ReplaceRequest(
            image=img, corners=corners, symbology=req.symbology,
            value=req.value, options=opts, blend_mode=req.blend_mode,
            text_corners=text_corners,
        ))
    except GenerateError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return ReplaceResponse(
        result=ndarray_to_b64(res.result),
        svg=res.svg,
        layers={k: ndarray_to_b64(v) for k, v in res.layers.items()},
    )
