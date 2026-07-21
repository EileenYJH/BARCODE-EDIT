"use client";
import { useEffect, useState } from "react";
import { Stage, Layer, Image as KImage, Line, Circle } from "react-konva";
import { useEditor } from "@/lib/store";

export function EditorCanvas() {
  const { image, corners, updateCorner, result } = useEditor();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const shown = result?.result ?? image;

  useEffect(() => {
    if (!shown) { setImg(null); return; }
    const i = new window.Image();
    i.src = shown;
    i.onload = () => setImg(i);
  }, [shown]);

  if (!img) return <div className="flex h-full items-center justify-center text-muted-foreground">Upload an image to begin</div>;

  const scale = Math.min(900 / img.width, 600 / img.height, 1);
  const w = img.width * scale, h = img.height * scale;
  const flat = corners?.flatMap((c) => [c[0] * scale, c[1] * scale]) ?? [];

  return (
    <Stage width={w} height={h} className="border rounded">
      <Layer>
        <KImage image={img} width={w} height={h} />
        {corners && !result && (
          <>
            <Line points={[...flat, flat[0], flat[1]]} stroke="#22d3ee" strokeWidth={2} closed />
            {corners.map((c, i) => (
              <Circle key={i} x={c[0] * scale} y={c[1] * scale} radius={7}
                      fill="#22d3ee" draggable
                      onDragMove={(e) => updateCorner(i, [e.target.x() / scale, e.target.y() / scale])} />
            ))}
          </>
        )}
      </Layer>
    </Stage>
  );
}
