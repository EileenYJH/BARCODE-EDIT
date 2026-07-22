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
_RENDER_DPI = 450  # 1.5x python-barcode's ImageWriter default (300); a floor
                    # for callers that don't know the eventual placement size

def _pil_to_bgr(img: Image.Image) -> np.ndarray:
    rgb = np.array(img.convert("RGB"))
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

def _proportional_font_size(module_height: float) -> float:
    """python-barcode's ImageWriter defaults to a fixed 10pt font regardless
    of module_height, so text stays the same absolute size while bars grow
    or shrink -- looking oversized on short bars and undersized on tall ones.
    Scale it to the library's own default ratio (10pt at 15mm), clamped to a
    sane range so extreme module_height values (from generate_barcode_fit's
    aspect-matching) can't blow the text up past legible/non-overlapping
    bounds or shrink it to nothing.
    """
    return max(6.0, min(14.0, 10.0 * module_height / 15.0))

def _generate_linear(symb: str, value: str, opts: GenerateOptions, dpi: float = _RENDER_DPI) -> GenerateResult:
    try:
        cls = barcode.get_barcode_class(_LINEAR[symb])
    except Exception as e:
        raise GenerateError(str(e))
    # dpi (not module_width/height/quiet_zone) is how callers rescale pixel
    # resolution: it scales the whole rendered page uniformly, including
    # text, without touching any of the mm-based options that
    # _proportional_font_size and the aspect-fit solve above are tuned
    # against. Rescaling module_width/height/quiet_zone directly instead
    # would shift module_height into a different font-size clamping regime
    # than what the aspect-fit solve assumed, throwing off the exact aspect
    # ratio it just solved for (confirmed: this broke an aspect-ratio test).
    common = {"write_text": opts.show_text, "quiet_zone": opts.quiet_zone,
              "module_width": opts.module_width, "module_height": opts.module_height,
              "font_size": _proportional_font_size(opts.module_height),
              "dpi": dpi}
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
                          target_aspect: float,
                          target_width_px: float = None) -> GenerateResult:
    """Like generate_barcode, but for linear symbologies solves for the
    module_height that makes the generated bitmap's own aspect ratio match
    target_aspect (the real shape of the quad it will be warped onto).

    Without this, the bitmap keeps whatever aspect ratio opts.module_width/
    module_height/quiet_zone happen to produce, and warp_onto's full-bleed
    stretch onto a differently-shaped quad squeezes bars unevenly (looks
    denser/thinner in one direction, sometimes visibly wavy). QR is skipped:
    it's inherently square, and its target quad's shape is already exactly
    reproduced by the perspective warp itself.

    target_width_px, if given (the actual on-photo placement's pixel width),
    additionally rescales the bitmap to roughly match that size with modest
    headroom. A fixed oversample factor can't work for every placement: too
    small relative to a large close-up blurs on the upscale, too large
    relative to a small placement forces an extreme downscale that aliases
    the bars' fine periodic pattern badly enough to break scanning entirely
    (confirmed empirically). Scaling relative to the actual target keeps the
    eventual warp a mild up- or down-scale either way.
    """
    symb = symbology.lower().replace("-", "")
    if symb not in _LINEAR or target_aspect <= 0:
        return generate_barcode(symbology, value, opts)

    # module_height affects only pixel height (confirmed empirically: pixel
    # width tracks module_width/quiet_zone only), but with a fixed additive
    # offset (quiet-zone margins etc.), not pure proportionality within a
    # given font size. `_proportional_font_size` is itself piecewise in
    # module_height (linear in the middle, clamped constant at each end), so
    # height-vs-module_height is only *exactly* linear within one of those
    # three regimes at a time -- not across all of them. Probe within
    # whichever regime the answer actually lands in, so the two-point fit
    # stays exact rather than averaging across a clamp boundary.
    def solve(h1: float, h2: float) -> float:
        probe1 = generate_barcode(symbology, value, replace(opts, module_height=h1))
        probe2 = generate_barcode(symbology, value, replace(opts, module_height=h2))
        ph1, pw = probe1.bitmap.shape[:2]
        ph2, _ = probe2.bitmap.shape[:2]
        slope = (ph2 - ph1) / (h2 - h1)
        if slope == 0:
            return h1
        intercept = ph1 - slope * h1
        target_height_px = pw / target_aspect
        return max((target_height_px - intercept) / slope, 0.1)

    UNCLAMPED_LO, UNCLAMPED_HI = 9.0, 21.0  # where _proportional_font_size clamps
    module_height = solve(12.0, 18.0)  # first pass, probing the unclamped regime
    if module_height < UNCLAMPED_LO:
        module_height = solve(4.0, 7.0)  # re-probe entirely inside the clamped-low regime
    elif module_height > UNCLAMPED_HI:
        module_height = solve(25.0, 40.0)  # re-probe entirely inside the clamped-high regime

    fitted_opts = replace(opts, module_height=module_height)
    result = _generate_linear(symb, value, fitted_opts)

    if target_width_px and target_width_px > 0:
        bw = result.bitmap.shape[1]
        oversample = 1.5  # headroom above the target so the eventual warp
                           # is a mild upscale at worst, never a big one
        scale = (target_width_px * oversample) / bw
        if abs(scale - 1.0) > 0.05:
            result = _generate_linear(symb, value, fitted_opts, dpi=_RENDER_DPI * scale)

    return result
