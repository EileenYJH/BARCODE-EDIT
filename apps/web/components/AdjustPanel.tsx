"use client";
import { useEditor } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { straightenQuad, quadCenter, quadRotation, rotateQuad } from "@/lib/transform";
import type { Corner } from "@/lib/types";

interface AdjustPanelProps {
  onConfirm: () => void;
  isPending: boolean;
}

export function AdjustPanel({ onConfirm, isPending }: AdjustPanelProps) {
  const {
    corners, detectedCorners, adjusting, result, updateCorner, commit, resetCorners,
    textCorners, separateTextPlacement, options, moveTextQuad, setTextCorners, setTextFontScale,
    setCorners,
  } = useEditor();

  if (!adjusting || !corners) return null;

  function handleNumberChange(i: number, axis: 0 | 1, raw: string) {
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    const c: Corner = [...corners![i]] as Corner;
    c[axis] = n;
    updateCorner(i, c);
  }

  function handleTextCenterChange(axis: 0 | 1, raw: string) {
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    const center = quadCenter(textCorners!);
    const delta: Corner = axis === 0 ? [n - center[0], 0] : [0, n - center[1]];
    moveTextQuad(delta);
  }

  function handleTextRotationChange(raw: string) {
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    const targetRad = (n * Math.PI) / 180;
    const currentRad = quadRotation(textCorners!);
    setTextCorners(rotateQuad(textCorners!, targetRad - currentRad));
  }

  function handleTextFontScaleChange(raw: string) {
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    setTextFontScale(n / 100);
  }

  function straightenBars() {
    setCorners(straightenQuad(corners!));
    commit();
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
      <Button variant="outline" size="sm" onClick={straightenBars}>
        Straighten
      </Button>
      {separateTextPlacement && textCorners && (
        <>
          <Label>Value text placement</Label>
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" value={quadCenter(textCorners)[0]}
                   onChange={(e) => handleTextCenterChange(0, e.target.value)}
                   onBlur={() => commit()} />
            <Input type="number" value={quadCenter(textCorners)[1]}
                   onChange={(e) => handleTextCenterChange(1, e.target.value)}
                   onBlur={() => commit()} />
          </div>
          <Label>Rotation (degrees)</Label>
          <Input type="number"
                 value={Math.round(((quadRotation(textCorners) * 180) / Math.PI) * 10) / 10}
                 onChange={(e) => handleTextRotationChange(e.target.value)}
                 onBlur={() => commit()} />
          <Label>Text size (%)</Label>
          <Input type="number" min={50} max={200}
                 value={Math.round(options.text_font_scale * 100)}
                 onChange={(e) => handleTextFontScaleChange(e.target.value)}
                 onBlur={() => commit()} />
        </>
      )}
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
