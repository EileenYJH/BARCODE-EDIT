import numpy as np
from fastapi import APIRouter, HTTPException
from imgio import b64_to_ndarray, ndarray_to_b64
from schemas import (DetectRequest, DetectResponse, DetectionOut,
                     ReplaceRequestIn, ReplaceResponse,
                     SegmentRequest, SegmentResponse)
from pipeline.detect import detect_barcodes
from pipeline.generate import GenerateOptions, GenerateError
from pipeline.orchestrator import replace_barcode, ReplaceRequest
from pipeline.segment import segment_label, SegmentationError

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

@router.post("/replace", response_model=ReplaceResponse)
def replace(req: ReplaceRequestIn):
    try:
        img = b64_to_ndarray(req.image)
    except ValueError:
        raise HTTPException(status_code=415, detail="unreadable image")
    corners = np.float32(req.corners)
    h, w = img.shape[:2]
    if (corners[:, 0].min() < 0 or corners[:, 1].min() < 0 or
            corners[:, 0].max() > w or corners[:, 1].max() > h):
        raise HTTPException(status_code=422, detail="corners out of bounds")
    opts = GenerateOptions(**req.options.model_dump())
    try:
        res = replace_barcode(ReplaceRequest(
            image=img, corners=corners, symbology=req.symbology,
            value=req.value, options=opts, blend_mode=req.blend_mode,
        ))
    except GenerateError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return ReplaceResponse(
        result=ndarray_to_b64(res.result),
        svg=res.svg,
        layers={k: ndarray_to_b64(v) for k, v in res.layers.items()},
    )

@router.post("/segment", response_model=SegmentResponse)
def segment(req: SegmentRequest):
    try:
        img = b64_to_ndarray(req.image)
    except ValueError:
        raise HTTPException(status_code=415, detail="unreadable image")
    corners = None
    if req.corners is not None:
        try:
            corners = np.float32(req.corners)
        except ValueError:
            raise HTTPException(status_code=422, detail="malformed corners")
    try:
        res = segment_label(img, barcode_corners=corners)
    except SegmentationError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return SegmentResponse(
        label_mask=ndarray_to_b64(res.label_mask),
        barcode_mask=ndarray_to_b64(res.barcode_mask),
        candidate_regions=[ndarray_to_b64(r) for r in res.candidate_regions],
    )
