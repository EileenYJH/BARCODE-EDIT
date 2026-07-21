"use client";
import { useEditor } from "@/lib/store";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";

const NAMES = ["original", "new_barcode", "result"] as const;

export function LayerPanel() {
  const { layers, setLayer, result, commit } = useEditor();
  if (!result) return null;
  return (
    <div className="space-y-3">
      {NAMES.map((n) => (
        <div key={n} className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm capitalize">{n.replace("_", " ")}</span>
            <Switch checked={layers[n].visible}
                    onCheckedChange={(v) => { setLayer(n, { visible: v }); commit(); }} />
          </div>
          <Slider value={[layers[n].opacity * 100]} max={100} step={1}
                  onValueChange={(v) => {
                    const val = Array.isArray(v) ? v[0] : v;
                    setLayer(n, { opacity: val / 100 });
                  }}
                  onValueCommitted={() => commit()} />
        </div>
      ))}
    </div>
  );
}
