from typing import List, Optional, Dict
from pydantic import BaseModel, Field

class DetectRequest(BaseModel):
    image: str  # data URL

class DetectionOut(BaseModel):
    corners: List[List[float]]
    type: Optional[str] = None
    value: Optional[str] = None
    confidence: float
    bbox: List[int]

class DetectResponse(BaseModel):
    detections: List[DetectionOut]

class OptionsIn(BaseModel):
    show_text: bool = True
    quiet_zone: float = 6.5
    module_width: float = 0.2
    module_height: float = 15.0

class ReplaceRequestIn(BaseModel):
    image: str
    corners: List[List[float]] = Field(..., min_length=4, max_length=4)
    symbology: str
    value: str
    options: OptionsIn = OptionsIn()
    blend_mode: str = "normal"
    text_corners: Optional[List[List[float]]] = Field(None, min_length=4, max_length=4)

class ReplaceResponse(BaseModel):
    result: str
    svg: str
    layers: Dict[str, str]
