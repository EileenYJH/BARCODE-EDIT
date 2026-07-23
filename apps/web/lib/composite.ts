import { rasterizeStroke } from "./paint";
import type { Stroke } from "./types";

export async function compositeLayers(
  originalSrc: string,
  resultSrc: string,
  resultMaskStrokes: Stroke[],
  retouchStrokes: Stroke[]
): Promise<ImageData> {
  const [originalImg, resultImg] = await Promise.all([loadImage(originalSrc), loadImage(resultSrc)]);
  const w = originalImg.width, h = originalImg.height;

  const originalCanvas = document.createElement("canvas");
  originalCanvas.width = w; originalCanvas.height = h;
  const originalCtx = originalCanvas.getContext("2d")!;
  originalCtx.drawImage(originalImg, 0, 0, w, h);
  const originalData = originalCtx.getImageData(0, 0, w, h);

  const resultCanvas = document.createElement("canvas");
  resultCanvas.width = w; resultCanvas.height = h;
  const resultCtx = resultCanvas.getContext("2d")!;
  resultCtx.drawImage(resultImg, 0, 0, w, h);
  const resultData = resultCtx.getImageData(0, 0, w, h);

  // Reveal mask: starts fully opaque (Result fully visible); eraser-on-Result
  // strokes punch alpha=0 holes, revealing Original beneath.
  const maskBuffer = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const stroke of resultMaskStrokes) rasterizeStroke(maskBuffer, w, h, stroke);

  // Retouch layer: starts fully transparent; brush/eraser-on-Retouch strokes
  // paint or remove its own content.
  const retouchBuffer = new Uint8ClampedArray(w * h * 4);
  for (const stroke of retouchStrokes) rasterizeStroke(retouchBuffer, w, h, stroke);

  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < out.length; i += 4) {
    const maskAlpha = maskBuffer[i + 3] / 255;
    for (let c = 0; c < 3; c++) {
      out[i + c] = originalData.data[i + c] * (1 - maskAlpha) + resultData.data[i + c] * maskAlpha;
    }
    out[i + 3] = 255;

    const retouchAlpha = retouchBuffer[i + 3] / 255;
    if (retouchAlpha > 0) {
      for (let c = 0; c < 3; c++) {
        out[i + c] = out[i + c] * (1 - retouchAlpha) + retouchBuffer[i + c] * retouchAlpha;
      }
    }
  }

  return new ImageData(out, w, h);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
