"use client";
import dynamic from "next/dynamic";
import { useMutation } from "@tanstack/react-query";
import { useEditor } from "@/lib/store";
import { replace } from "@/lib/api";
import { UploadPanel } from "@/components/UploadPanel";
import { BarcodeSettings } from "@/components/BarcodeSettings";
import { AdjustPanel } from "@/components/AdjustPanel";
import { HistoryControls } from "@/components/HistoryControls";
import { LayerPanel } from "@/components/LayerPanel";
import { Comparison } from "@/components/Comparison";
import { FadeComparison } from "@/components/FadeComparison";
import { DifferenceHeatmap } from "@/components/DifferenceHeatmap";
import { ExportBar } from "@/components/ExportBar";
import { Button } from "@/components/ui/button";

const EditorCanvas = dynamic(
  () => import("@/components/EditorCanvas").then((m) => m.EditorCanvas),
  { ssr: false }
);

export default function Page() {
  const s = useEditor();
  const m = useMutation({
    mutationFn: () => replace({
      image: s.image!, corners: s.corners!, symbology: s.symbology,
      value: s.value, options: s.options, blend_mode: s.blendMode,
    }),
    onSuccess: (r) => {
      s.setResult(r);
      s.setAdjusting(false);
      s.commit();
    },
  });
  const canRun = !!s.image && !!s.corners && !!s.value && !m.isPending;

  return (
    <main className="grid grid-cols-[280px_1fr_300px] h-screen">
      <aside className="border-r p-4 space-y-6 overflow-y-auto">
        <UploadPanel />
        <BarcodeSettings />
        <AdjustPanel onConfirm={() => m.mutate()} isPending={m.isPending} />
        {s.result && !s.adjusting && (
          <Button variant="outline" className="w-full" onClick={() => s.setAdjusting(true)}>
            Adjust placement
          </Button>
        )}
        <HistoryControls />
        <Button className="w-full" disabled={!canRun} onClick={() => m.mutate()}>
          {m.isPending ? "Processing..." : "Replace barcode"}
        </Button>
        {m.error && <p className="text-sm text-red-500">{(m.error as Error).message}</p>}
      </aside>

      <section className="p-4 flex items-center justify-center overflow-auto">
        <EditorCanvas />
      </section>

      <aside className="border-l p-4 space-y-6 overflow-y-auto">
        <LayerPanel />
        <Comparison />
        <FadeComparison />
        <DifferenceHeatmap />
        <ExportBar />
      </aside>
    </main>
  );
}
