"use client";
import { useEffect } from "react";
import { useEditor, selectCanUndo, selectCanRedo } from "@/lib/store";
import { Button } from "@/components/ui/button";

export function HistoryControls() {
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor(selectCanUndo);
  const canRedo = useEditor(selectCanRedo);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={!canUndo} onClick={undo}>Undo</Button>
      <Button variant="outline" size="sm" disabled={!canRedo} onClick={redo}>Redo</Button>
    </div>
  );
}
