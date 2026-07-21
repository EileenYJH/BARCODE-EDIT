import { describe, it, expect, beforeEach } from "vitest";
import { useEditor, selectCanUndo, selectCanRedo } from "./store";

const defaultLayers = {
  original: { visible: true, opacity: 1 },
  new_barcode: { visible: true, opacity: 1 },
  result: { visible: true, opacity: 1 },
};

function reset() {
  useEditor.setState({
    image: null,
    corners: null,
    detectedCorners: null,
    adjusting: true,
    symbology: "code128",
    value: "",
    options: { show_text: true, quiet_zone: 6.5, module_width: 0.2, module_height: 15 },
    blendMode: "normal",
    result: null,
    layers: defaultLayers,
    history: [],
    historyIndex: -1,
  });
}

describe("history: commit/undo/redo", () => {
  beforeEach(reset);

  it("commit pushes a snapshot and advances the index", () => {
    useEditor.getState().setField("value", "A");
    useEditor.getState().commit();
    expect(useEditor.getState().history).toHaveLength(1);
    expect(useEditor.getState().historyIndex).toBe(0);
  });

  it("undo restores the previous snapshot's fields", () => {
    useEditor.getState().setField("value", "A");
    useEditor.getState().commit();
    useEditor.getState().setField("value", "B");
    useEditor.getState().commit();
    expect(useEditor.getState().value).toBe("B");

    useEditor.getState().undo();
    expect(useEditor.getState().value).toBe("A");
    expect(selectCanUndo(useEditor.getState())).toBe(false);
    expect(selectCanRedo(useEditor.getState())).toBe(true);
  });

  it("redo re-applies the undone snapshot", () => {
    useEditor.getState().setField("value", "A");
    useEditor.getState().commit();
    useEditor.getState().setField("value", "B");
    useEditor.getState().commit();
    useEditor.getState().undo();
    useEditor.getState().redo();
    expect(useEditor.getState().value).toBe("B");
  });

  it("committing after an undo truncates the discarded redo branch", () => {
    useEditor.getState().setField("value", "A");
    useEditor.getState().commit();
    useEditor.getState().setField("value", "B");
    useEditor.getState().commit();
    useEditor.getState().undo(); // back to A
    useEditor.getState().setField("value", "C");
    useEditor.getState().commit(); // discards B
    expect(useEditor.getState().history).toHaveLength(2);
    expect(useEditor.getState().history.map((h) => h.value)).toEqual(["A", "C"]);
    expect(selectCanRedo(useEditor.getState())).toBe(false);
  });

  it("undo/redo at the boundaries are safe no-ops", () => {
    expect(selectCanUndo(useEditor.getState())).toBe(false);
    useEditor.getState().undo();
    expect(useEditor.getState().historyIndex).toBe(-1);

    useEditor.getState().setField("value", "A");
    useEditor.getState().commit();
    expect(selectCanRedo(useEditor.getState())).toBe(false);
    useEditor.getState().redo();
    expect(useEditor.getState().historyIndex).toBe(0);
  });
});
