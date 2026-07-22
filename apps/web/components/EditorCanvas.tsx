"use client";
import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Image as KImage, Line, Circle, Rect } from "react-konva";
import type Konva from "konva";
import { useEditor } from "@/lib/store";
import { quadCenter, scaleQuad, rotateQuad } from "@/lib/transform";
import type { Corner } from "@/lib/types";

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

interface DragStart {
  corners: Corner[];
  center: Corner;
  startValue: number; // distance-from-center for scale, angle-from-center for rotate
  referenceDist: number; // scale only: average corner-to-center distance, used to normalize sensitivity
}

interface QuadTransformBoxProps {
  corners: Corner[];
  scale: number;
  color: string;
  onUpdateCorner: (i: number, c: Corner) => void;
  onMoveQuad: (delta: Corner) => void;
  onSetCorners: (c: Corner[]) => void;
  onCommit: () => void;
}

function QuadTransformBox({ corners, scale, color, onUpdateCorner, onMoveQuad, onSetCorners, onCommit }: QuadTransformBoxProps) {
  const dragStart = useRef<DragStart | null>(null);
  const flat = corners.flatMap((c) => [c[0] * scale, c[1] * scale]);

  function handleQuadDragMove(e: Konva.KonvaEventObject<DragEvent>) {
    const node = e.target;
    const dx = node.x() / scale;
    const dy = node.y() / scale;
    node.position({ x: 0, y: 0 });
    onMoveQuad([dx, dy]);
  }

  function handleScaleDragStart(e: Konva.KonvaEventObject<DragEvent>) {
    const center = quadCenter(corners);
    const pos = e.target.getAbsolutePosition();
    const startValue = Math.hypot(pos.x - center[0] * scale, pos.y - center[1] * scale);
    // Average corner-to-center distance, not the handle's own (possibly small)
    // starting distance -- an edge-midpoint handle can sit close to center on a
    // wide/short quad, and dividing by that tiny distance turned small mouse
    // movements into huge scale swings. This is a stable denominator instead.
    const referenceDist = corners.reduce(
      (sum, c) => sum + Math.hypot(c[0] - center[0], c[1] - center[1]), 0
    ) / corners.length || 1;
    dragStart.current = { corners, center, startValue, referenceDist };
  }

  function handleScaleDragMove(e: Konva.KonvaEventObject<DragEvent>) {
    if (!dragStart.current) return;
    const { corners: startCorners, center, startValue, referenceDist } = dragStart.current;
    const pos = e.target.getAbsolutePosition();
    const currentDist = Math.hypot(pos.x - center[0] * scale, pos.y - center[1] * scale);
    const deltaImageSpace = (currentDist - startValue) / scale;
    const factor = Math.max(0.05, 1 + deltaImageSpace / referenceDist);
    onSetCorners(scaleQuad(startCorners, factor));
  }

  function handleTransformDragEnd() {
    dragStart.current = null;
    onCommit();
  }

  function handleRotateDragStart(e: Konva.KonvaEventObject<DragEvent>) {
    const center = quadCenter(corners);
    const pos = e.target.getAbsolutePosition();
    const startValue = Math.atan2(pos.y - center[1] * scale, pos.x - center[0] * scale);
    dragStart.current = { corners, center, startValue, referenceDist: 1 }; // unused for rotate
  }

  function handleRotateDragMove(e: Konva.KonvaEventObject<DragEvent>) {
    if (!dragStart.current) return;
    const { corners: startCorners, center, startValue: startAngle } = dragStart.current;
    const pos = e.target.getAbsolutePosition();
    const currentAngle = Math.atan2(pos.y - center[1] * scale, pos.x - center[0] * scale);
    onSetCorners(rotateQuad(startCorners, currentAngle - startAngle));
  }

  const center = quadCenter(corners);
  const edgeMidpoints: Corner[] = [
    [(corners[0][0] + corners[1][0]) / 2, (corners[0][1] + corners[1][1]) / 2],
    [(corners[1][0] + corners[2][0]) / 2, (corners[1][1] + corners[2][1]) / 2],
    [(corners[2][0] + corners[3][0]) / 2, (corners[2][1] + corners[3][1]) / 2],
    [(corners[3][0] + corners[0][0]) / 2, (corners[3][1] + corners[0][1]) / 2],
  ];
  const rotateHandlePos: Corner = [
    edgeMidpoints[0][0] + (edgeMidpoints[0][0] - center[0]) * 0.4,
    edgeMidpoints[0][1] + (edgeMidpoints[0][1] - center[1]) * 0.4,
  ];

  return (
    <>
      <Line
        points={[...flat, flat[0], flat[1]]}
        stroke={color}
        strokeWidth={2}
        closed
        fill={hexToRgba(color, 0.08)}
        draggable
        onDragMove={handleQuadDragMove}
        onDragEnd={() => onCommit()}
      />
      {corners.map((c, i) => (
        <Circle key={i} x={c[0] * scale} y={c[1] * scale} radius={7}
                fill={color} draggable
                onDragMove={(e) => onUpdateCorner(i, [e.target.x() / scale, e.target.y() / scale])}
                onDragEnd={() => onCommit()} />
      ))}
      {edgeMidpoints.map((m, i) => (
        <Rect key={`scale-${i}`} x={m[0] * scale - 5} y={m[1] * scale - 5} width={10} height={10}
              fill="#f97316" draggable
              onDragStart={handleScaleDragStart}
              onDragMove={handleScaleDragMove}
              onDragEnd={handleTransformDragEnd} />
      ))}
      <Circle x={rotateHandlePos[0] * scale} y={rotateHandlePos[1] * scale} radius={6}
              fill="#f97316" draggable
              onDragStart={handleRotateDragStart}
              onDragMove={handleRotateDragMove}
              onDragEnd={handleTransformDragEnd} />
    </>
  );
}

export function EditorCanvas() {
  const {
    image, corners, adjusting, updateCorner, moveQuad, setCorners, commit, result,
    textCorners, separateTextPlacement, updateTextCorner, moveTextQuad, setTextCorners,
  } = useEditor();
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

  return (
    <Stage width={w} height={h} className="border rounded">
      <Layer>
        <KImage image={img} width={w} height={h} />
        {corners && adjusting && (
          <QuadTransformBox corners={corners} scale={scale} color="#22d3ee"
            onUpdateCorner={updateCorner} onMoveQuad={moveQuad} onSetCorners={setCorners} onCommit={commit} />
        )}
        {textCorners && separateTextPlacement && adjusting && (
          <QuadTransformBox corners={textCorners} scale={scale} color="#a855f7"
            onUpdateCorner={updateTextCorner} onMoveQuad={moveTextQuad} onSetCorners={setTextCorners} onCommit={commit} />
        )}
      </Layer>
    </Stage>
  );
}
