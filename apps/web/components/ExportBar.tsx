"use client";
import { useState } from "react";
import { useEditor } from "@/lib/store";
import { compositeLayers } from "@/lib/composite";
import { Button } from "@/components/ui/button";

function download(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href; a.download = name; a.click();
}

export function ExportBar() {
  const { image, result, retouchStrokes, resultMaskStrokes } = useEditor();
  const [exporting, setExporting] = useState(false);
  if (!result) return null;

  async function downloadPng() {
    if (!image || !result) return;
    setExporting(true);
    try {
      const composite = await compositeLayers(image, result.result, resultMaskStrokes, retouchStrokes);
      const canvas = document.createElement("canvas");
      canvas.width = composite.width;
      canvas.height = composite.height;
      canvas.getContext("2d")!.putImageData(composite, 0, 0);
      download(canvas.toDataURL("image/png"), "edited.png");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex gap-2">
      <Button disabled={exporting} onClick={downloadPng}>
        {exporting ? "Preparing..." : "Download PNG"}
      </Button>
      <Button variant="outline" onClick={() => {
        const blob = new Blob([result.svg], { type: "image/svg+xml" });
        download(URL.createObjectURL(blob), "barcode.svg");
      }}>Download SVG</Button>
    </div>
  );
}
