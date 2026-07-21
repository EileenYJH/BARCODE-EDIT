from dataclasses import dataclass, replace
from io import BytesIO
import numpy as np
import cv2
from PIL import Image
import barcode
from barcode.writer import ImageWriter, SVGWriter
import qrcode
import qrcode.image.svg

class GenerateError(ValueError):
    pass

@dataclass
class GenerateOptions:
    show_text: bool = True
    quiet_zone: float = 6.5      # mm, python-barcode units
    module_width: float = 0.2    # mm
    module_height: float = 15.0  # mm

@dataclass
class GenerateResult:
    bitmap: np.ndarray  # BGR uint8, white background
    svg: str

_LINEAR = {"ean13": "ean13", "ean8": "ean8", "upca": "upca",
           "code128": "code128", "code39": "code39"}

def _pil_to_bgr(img: Image.Image) -> np.ndarray:
    rgb = np.array(img.convert("RGB"))
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

def _generate_linear(symb: str, value: str, opts: GenerateOptions) -> GenerateResult:
    try:
        cls = barcode.get_barcode_class(_LINEAR[symb])
    except Exception as e:
        raise GenerateError(str(e))
    common = {"write_text": opts.show_text, "quiet_zone": opts.quiet_zone,
              "module_width": opts.module_width, "module_height": opts.module_height}
    try:
        png_buf = BytesIO()
        obj = cls(value, writer=ImageWriter())
        obj.write(png_buf, options=common)
        png_buf.seek(0)
        bitmap = _pil_to_bgr(Image.open(png_buf))
        svg_buf = BytesIO()
        obj_svg = cls(value, writer=SVGWriter())
        obj_svg.write(svg_buf, options=common)
        svg = svg_buf.getvalue().decode("utf-8")
    except Exception as e:
        raise GenerateError(f"{symb}: {e}")
    return GenerateResult(bitmap=bitmap, svg=svg)

def _generate_qr(value: str, opts: GenerateOptions) -> GenerateResult:
    try:
        qr = qrcode.QRCode(border=max(1, int(round(opts.quiet_zone / 2))))
        qr.add_data(value)
        qr.make(fit=True)
        pil = qr.make_image(fill_color="black", back_color="white")
        bitmap = _pil_to_bgr(pil.get_image() if hasattr(pil, "get_image") else pil)
        svg_img = qrcode.make(value, image_factory=qrcode.image.svg.SvgImage)
        svg_buf = BytesIO()
        svg_img.save(svg_buf)
        svg = svg_buf.getvalue().decode("utf-8")
    except Exception as e:
        raise GenerateError(f"qr: {e}")
    return GenerateResult(bitmap=bitmap, svg=svg)

def generate_barcode(symbology: str, value: str, opts: GenerateOptions) -> GenerateResult:
    symb = symbology.lower().replace("-", "")
    if symb == "qr":
        return _generate_qr(value, opts)
    if symb in _LINEAR:
        return _generate_linear(symb, value, opts)
    raise GenerateError(f"unsupported symbology: {symbology}")

def generate_barcode_fit(symbology: str, value: str, opts: GenerateOptions,
                          target_aspect: float) -> GenerateResult:
    """Like generate_barcode, but for linear symbologies solves for the
    module_height that makes the generated bitmap's own aspect ratio match
    target_aspect (the real shape of the quad it will be warped onto).

    Without this, the bitmap keeps whatever aspect ratio opts.module_width/
    module_height/quiet_zone happen to produce, and warp_onto's full-bleed
    stretch onto a differently-shaped quad squeezes bars unevenly (looks
    denser/thinner in one direction, sometimes visibly wavy). QR is skipped:
    it's inherently square, and its target quad's shape is already exactly
    reproduced by the perspective warp itself.
    """
    symb = symbology.lower().replace("-", "")
    if symb not in _LINEAR or target_aspect <= 0:
        return generate_barcode(symbology, value, opts)

    # module_height affects only pixel height (confirmed empirically: pixel
    # width tracks module_width/quiet_zone only), but with a fixed additive
    # offset (quiet-zone margins etc.), not pure proportionality. Two probes
    # at different module_height values pin down that line exactly, so a
    # third render lands on the target aspect ratio precisely.
    h1, h2 = 10.0, 25.0
    probe1 = generate_barcode(symbology, value, replace(opts, module_height=h1))
    probe2 = generate_barcode(symbology, value, replace(opts, module_height=h2))
    ph1, pw = probe1.bitmap.shape[:2]
    ph2, _ = probe2.bitmap.shape[:2]

    slope = (ph2 - ph1) / (h2 - h1)
    if slope == 0:
        return probe1  # module_height has no effect for this input; nothing to solve

    intercept = ph1 - slope * h1
    target_height_px = pw / target_aspect
    module_height = max((target_height_px - intercept) / slope, 0.1)

    return generate_barcode(symbology, value, replace(opts, module_height=module_height))
