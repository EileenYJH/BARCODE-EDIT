"use client";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/lib/store";
import { computeHeatmap } from "@/lib/heatmap";

export function DifferenceHeatmap() {
  const { image, result } = useEditor();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

  useEffect(() => {
    if (!image || !result || !canvasRef.current) return;
    const imageSrc = image;
    const resultSrc = result.result;
    setStatus("loading");

    let cancelled = false;
    async function run() {
      try {
        const [imgA, imgB] = await Promise.all([loadImage(imageSrc), loadImage(resultSrc)]);
        if (cancelled) return;
        const w = imgA.width, h = imgA.height;

        const canvasA = document.createElement("canvas");
        canvasA.width = w; canvasA.height = h;
        const ctxA = canvasA.getContext("2d")!;
        ctxA.drawImage(imgA, 0, 0, w, h);
        const dataA = ctxA.getImageData(0, 0, w, h);

        const canvasB = document.createElement("canvas");
        canvasB.width = w; canvasB.height = h;
        const ctxB = canvasB.getContext("2d")!;
        ctxB.drawImage(imgB, 0, 0, w, h);
        const dataB = ctxB.getImageData(0, 0, w, h);

        const outData = computeHeatmap(dataA.data, dataB.data, w, h);
        // computeHeatmap returns Uint8ClampedArray<ArrayBufferLike>, but the ImageData
        // constructor requires the buffer to be typed as ArrayBuffer specifically.
        // Copy into a freshly allocated ArrayBuffer-backed array to satisfy that.
        const outBuffer = new Uint8ClampedArray(new ArrayBuffer(outData.length));
        outBuffer.set(outData);
        const outImageData = new ImageData(outBuffer, w, h);

        const visible = canvasRef.current!;
        visible.width = w; visible.height = h;
        visible.getContext("2d")!.putImageData(outImageData, 0, 0);
        if (!cancelled) setStatus("done");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }
    run();
    return () => { cancelled = true; };
  }, [image, result]);

  if (!image || !result) return null;
  return (
    <div className="space-y-2">
      <canvas ref={canvasRef} className="w-full rounded border" />
      {status === "loading" && <p className="text-xs text-muted-foreground text-center">Computing difference...</p>}
      {status === "error" && <p className="text-xs text-red-500 text-center">Could not compute heatmap</p>}
      <p className="text-xs text-muted-foreground text-center">Difference heatmap</p>
    </div>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
