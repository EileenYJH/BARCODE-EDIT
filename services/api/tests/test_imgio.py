import numpy as np
from imgio import ndarray_to_b64, b64_to_ndarray

def test_roundtrip_preserves_shape_and_pixels():
    img = np.zeros((10, 12, 3), dtype=np.uint8)
    img[2:5, 3:7] = (255, 0, 0)  # BGR block
    encoded = ndarray_to_b64(img, fmt="png")
    assert encoded.startswith("data:image/png;base64,")
    decoded = b64_to_ndarray(encoded)
    assert decoded.shape == img.shape
    assert np.array_equal(decoded, img)
