"use client";
import { useState } from "react";
import { useEditor } from "@/lib/store";
import { Slider } from "@/components/ui/slider";

export function Comparison() {
  const { image, result } = useEditor();
  const [pos, setPos] = useState(50);
  if (!image || !result) return null;
  return (
    <div className="space-y-2">
      <div className="relative w-full overflow-hidden rounded border">
        <img src={result.result} className="block w-full" alt="edited" />
        <div className="absolute inset-0 overflow-hidden" style={{ width: `${pos}%` }}>
          <img src={image} className="block h-full w-auto max-w-none" alt="original" />
        </div>
        <div className="absolute top-0 bottom-0 w-0.5 bg-cyan-400" style={{ left: `${pos}%` }} />
      </div>
      <Slider value={[pos]} max={100} onValueChange={(v) => setPos(Array.isArray(v) ? v[0] : v)} />
      <p className="text-xs text-muted-foreground text-center">Original / swipe / Edited</p>
    </div>
  );
}
