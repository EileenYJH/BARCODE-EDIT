"use client";
import { useEffect, useState } from "react";
import { Stage, Layer, Image as KImage, Line, Circle } from "react-konva";
import type Konva from "konva";
import { useEditor } from "@/lib/store";

export function EditorCanvas() {
  const { image, corners, adjusting, updateCorner, moveQuad, commit, result } = useEditor();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const shown = adjusting ? image : (result?.result ?? image);

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

  function handleQuadDragMove(e: Konva.KonvaEventObject<DragEvent>) {
    const node = e.target;
    const dx = node.x() / scale;
    const dy = node.y() / scale;
    node.position({ x: 0, y: 0 }); // the quad itself doesn't move; corners do
    moveQuad([dx, dy]);
  }

  return (
    <Stage width={w} height={h} className="border rounded">
      <Layer>
        <KImage image={img} width={w} height={h} />
        {corners && adjusting && (
          <>
            <Line
              points={[...flat, flat[0], flat[1]]}
              stroke="#22d3ee"
              strokeWidth={2}
              closed
              fill="rgba(34,211,238,0.08)"
              draggable
              onDragMove={handleQuadDragMove}
              onDragEnd={() => commit()}
            />
            {corners.map((c, i) => (
              <Circle key={i} x={c[0] * scale} y={c[1] * scale} radius={7}
                      fill="#22d3ee" draggable
                      onDragMove={(e) => updateCorner(i, [e.target.x() / scale, e.target.y() / scale])}
                      onDragEnd={() => commit()} />
            ))}
          </>
        )}
      </Layer>
    </Stage>
  );
}
