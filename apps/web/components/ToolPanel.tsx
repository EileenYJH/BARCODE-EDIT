"use client";
import { useEditor } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

export function ToolPanel() {
  const {
    retouching, tool, activeLayer, brushSize, brushColor,
    setTool, setActiveLayer, setBrushSize, setBrushColor,
  } = useEditor();
  if (!retouching) return null;

  return (
    <div className="space-y-3">
      <Label>Tool</Label>
      <div className="flex gap-2">
        <Button variant={tool === "brush" ? "default" : "outline"} size="sm"
                onClick={() => setTool("brush")}>Brush</Button>
        <Button variant={tool === "eraser" ? "default" : "outline"} size="sm"
                onClick={() => setTool("eraser")}>Eraser</Button>
      </div>

      {tool === "eraser" && (
        <div className="space-y-1">
          <Label>Active layer</Label>
          <div className="flex gap-2">
            <Button variant={activeLayer === "retouch" ? "default" : "outline"} size="sm"
                    onClick={() => setActiveLayer("retouch")}>Retouch</Button>
            <Button variant={activeLayer === "result" ? "default" : "outline"} size="sm"
                    onClick={() => setActiveLayer("result")}>Result</Button>
          </div>
        </div>
      )}

      <div className="space-y-1">
        <Label>Size</Label>
        <Slider value={[brushSize]} min={2} max={60} step={1}
                onValueChange={(v) => setBrushSize(Array.isArray(v) ? v[0] : v)} />
      </div>

      {tool === "brush" && (
        <div className="space-y-1">
          <Label>Color</Label>
          <Input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} />
        </div>
      )}
    </div>
  );
}
