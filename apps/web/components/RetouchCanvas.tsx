"use client";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/lib/store";
import { rasterizeStroke } from "@/lib/paint";
import { compositeLayers } from "@/lib/composite";
import type { Stroke, Corner } from "@/lib/types";

export function RetouchCanvas() {
  const {
    image, result, retouchStrokes, resultMaskStrokes,
    tool, brushColor, brushSize, addStroke,
  } = useEditor();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [displaySize, setDisplaySize] = useState<{ w: number; h: number } | null>(null);
  const currentStroke = useRef<Stroke | null>(null);

  useEffect(() => {
    if (!image || !result) return;
    let cancelled = false;
    (async () => {
      const composite = await compositeLayers(image, result.result, resultMaskStrokes, retouchStrokes);
      if (cancelled || !canvasRef.current) return;
      const s = Math.min(900 / composite.width, 600 / composite.height, 1);
      setDisplaySize({ w: composite.width * s, h: composite.height * s });
      const canvas = canvasRef.current;
      canvas.width = composite.width;
      canvas.height = composite.height;
      canvas.getContext("2d")!.putImageData(composite, 0, 0);
    })();
    return () => { cancelled = true; };
  }, [image, result, retouchStrokes, resultMaskStrokes]);

  if (!image || !result) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>;
  }

  function toImageSpace(e: React.PointerEvent<HTMLCanvasElement>): Corner {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const displayScale = rect.width / canvas.width;
    return [(e.clientX - rect.left) / displayScale, (e.clientY - rect.top) / displayScale];
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    currentStroke.current = { tool, color: brushColor, size: brushSize, points: [toImageSpace(e)] };
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!currentStroke.current) return;
    currentStroke.current.points.push(toImageSpace(e));
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    rasterizeStroke(imgData.data, imgData.width, imgData.height, currentStroke.current);
    ctx.putImageData(imgData, 0, 0);
  }

  function onPointerUp() {
    if (!currentStroke.current) return;
    addStroke(currentStroke.current);
    currentStroke.current = null;
  }

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        style={displaySize ? { width: displaySize.w, height: displaySize.h } : { display: "none" }}
        className="border rounded touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
      {!displaySize && (
        <div className="flex h-40 w-40 items-center justify-center text-muted-foreground">Loading...</div>
      )}
    </div>
  );
}
