"use client";
import { useState } from "react";
import { useEditor } from "@/lib/store";
import { Slider } from "@/components/ui/slider";

export function FadeComparison() {
  const { image, result } = useEditor();
  const [fade, setFade] = useState(50);
  if (!image || !result) return null;
  return (
    <div className="space-y-2">
      <div className="relative w-full overflow-hidden rounded border">
        <img src={image} className="block w-full" alt="original" />
        <img src={result.result} className="absolute inset-0 block w-full"
             style={{ opacity: fade / 100 }} alt="edited overlay" />
      </div>
      <Slider value={[fade]} max={100}
              onValueChange={(v) => setFade(Array.isArray(v) ? v[0] : v)} />
      <p className="text-xs text-muted-foreground text-center">Fade: Original -&gt; Edited</p>
    </div>
  );
}
