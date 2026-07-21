"use client";
import { useEditor } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Corner } from "@/lib/types";

interface AdjustPanelProps {
  onConfirm: () => void;
  isPending: boolean;
}

export function AdjustPanel({ onConfirm, isPending }: AdjustPanelProps) {
  const { corners, detectedCorners, adjusting, result, updateCorner, commit, resetCorners } = useEditor();

  if (!adjusting || !corners) return null;

  function handleNumberChange(i: number, axis: 0 | 1, raw: string) {
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    const c: Corner = [...corners![i]] as Corner;
    c[axis] = n;
    updateCorner(i, c);
  }

  return (
    <div className="space-y-3">
      <Label>Placement</Label>
      <div className="grid grid-cols-2 gap-2">
        {corners.map((c, i) => (
          <div key={i} className="contents">
            <Input type="number" value={c[0]}
                   onChange={(e) => handleNumberChange(i, 0, e.target.value)}
                   onBlur={() => commit()} />
            <Input type="number" value={c[1]}
                   onChange={(e) => handleNumberChange(i, 1, e.target.value)}
                   onBlur={() => commit()} />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        {detectedCorners && (
          <Button variant="outline" size="sm" onClick={resetCorners}>
            Reset to detected
          </Button>
        )}
        {result && (
          <Button size="sm" disabled={isPending} onClick={onConfirm}>
            {isPending ? "Confirming..." : "Confirm placement"}
          </Button>
        )}
      </div>
    </div>
  );
}
