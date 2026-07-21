import base64
import cv2
import numpy as np

def ndarray_to_b64(img: np.ndarray, fmt: str = "png") -> str:
    ok, buf = cv2.imencode(f".{fmt}", img)
    if not ok:
        raise ValueError("encode failed")
    b64 = base64.b64encode(buf.tobytes()).decode("ascii")
    return f"data:image/{fmt};base64,{b64}"

def b64_to_ndarray(data_url: str) -> np.ndarray:
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    raw = base64.b64decode(data_url)
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("decode failed")
    return img
