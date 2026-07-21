"use client";
import { useEditor } from "@/lib/store";
import { Button } from "@/components/ui/button";

function download(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href; a.download = name; a.click();
}

export function ExportBar() {
  const { result } = useEditor();
  if (!result) return null;
  return (
    <div className="flex gap-2">
      <Button onClick={() => download(result.result, "edited.png")}>Download PNG</Button>
      <Button variant="outline" onClick={() => {
        const blob = new Blob([result.svg], { type: "image/svg+xml" });
        download(URL.createObjectURL(blob), "barcode.svg");
      }}>Download SVG</Button>
    </div>
  );
}
