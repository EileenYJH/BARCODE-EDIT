import { describe, it, expect, beforeEach } from "vitest";
import { useEditor, selectCanUndo, selectCanRedo } from "./store";

function reset() {
  useEditor.setState({
    image: null,
    corners: null,
    textCorners: null,
    separateTextPlacement: false,
    detectedCorners: null,
    adjusting: true,
    retouching: false,
    activeLayer: "retouch",
    tool: "brush",
    brushSize: 12,
    brushColor: "#000000",
    brushOpacity: 1,
    symbology: "code128",
    value: "",
    options: { show_text: true, quiet_zone: 6.5, module_width: 0.2, module_height: 15, text_font_scale: 1 },
    blendMode: "normal",
    result: null,
    retouchStrokes: [],
    resultMaskStrokes: [],
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

  it("undo/redo round-trips textCorners through the snapshot", () => {
    useEditor.getState().setTextCorners([[1, 1], [2, 1], [2, 2], [1, 2]]);
    useEditor.getState().commit();
    useEditor.getState().setTextCorners([[9, 9], [8, 9], [8, 8], [9, 8]]);
    useEditor.getState().commit();
    expect(useEditor.getState().textCorners).toEqual([[9, 9], [8, 9], [8, 8], [9, 8]]);

    useEditor.getState().undo();
    expect(useEditor.getState().textCorners).toEqual([[1, 1], [2, 1], [2, 2], [1, 2]]);

    useEditor.getState().redo();
    expect(useEditor.getState().textCorners).toEqual([[9, 9], [8, 9], [8, 8], [9, 8]]);
  });

  it("undo/redo round-trips separateTextPlacement through the snapshot", () => {
    // separateTextPlacement must be part of the snapshot, not just
    // textCorners -- otherwise undoing past a toggle leaves the switch (and
    // the text quad's visibility) out of sync with the restored corners
    useEditor.getState().setCorners([[0, 0], [200, 0], [200, 50], [0, 50]]);
    useEditor.getState().setSeparateTextPlacement(true);
    useEditor.getState().commit();
    useEditor.getState().setSeparateTextPlacement(false);
    useEditor.getState().commit();
    expect(useEditor.getState().separateTextPlacement).toBe(false);

    useEditor.getState().undo();
    expect(useEditor.getState().separateTextPlacement).toBe(true);

    useEditor.getState().redo();
    expect(useEditor.getState().separateTextPlacement).toBe(false);
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

describe("placement: detectedCorners, resetCorners, moveQuad", () => {
  beforeEach(reset);

  it("resetCorners restores detectedCorners and commits once", () => {
    useEditor.getState().setDetectedCorners([[10, 10], [20, 10], [20, 20], [10, 20]]);
    useEditor.getState().setCorners([[15, 15], [25, 15], [25, 25], [15, 25]]);
    useEditor.getState().resetCorners();
    expect(useEditor.getState().corners).toEqual([[10, 10], [20, 10], [20, 20], [10, 20]]);
    expect(useEditor.getState().history).toHaveLength(1);
  });

  it("resetCorners is a no-op when there are no detected corners", () => {
    useEditor.getState().setCorners([[1, 1], [2, 1], [2, 2], [1, 2]]);
    useEditor.getState().resetCorners();
    expect(useEditor.getState().corners).toEqual([[1, 1], [2, 1], [2, 2], [1, 2]]);
  });

  it("resetCorners also re-offsets the text quad when separate text placement is on", () => {
    // otherwise the text quad stays wherever it was relative to the OLD
    // (drifted) bars quad, orphaned from the freshly-reset one. Drift the
    // bars quad BEFORE enabling separate text placement, so the auto-offset
    // is computed from the drifted position -- distinct from what it would
    // be computed from detectedCorners, so a fix that fails to re-offset
    // can't coincidentally produce the same textCorners value.
    useEditor.getState().setDetectedCorners([[0, 0], [200, 0], [200, 50], [0, 50]]);
    useEditor.getState().setCorners([[300, 300], [500, 300], [500, 350], [300, 350]]); // drifted far away
    useEditor.getState().setSeparateTextPlacement(true);
    expect(useEditor.getState().textCorners).toEqual([[300, 350], [500, 350], [500, 370], [300, 370]]);

    useEditor.getState().resetCorners();
    expect(useEditor.getState().corners).toEqual([[0, 0], [200, 0], [200, 50], [0, 50]]);
    expect(useEditor.getState().textCorners).toEqual([[0, 50], [200, 50], [200, 70], [0, 70]]);
  });

  it("resetCorners leaves textCorners alone when separate text placement is off", () => {
    useEditor.getState().setDetectedCorners([[0, 0], [200, 0], [200, 50], [0, 50]]);
    useEditor.getState().setCorners([[300, 300], [500, 300], [500, 350], [300, 350]]);
    useEditor.getState().setTextCorners([[10, 10], [20, 10], [20, 20], [10, 20]]);
    useEditor.getState().resetCorners();
    expect(useEditor.getState().textCorners).toEqual([[10, 10], [20, 10], [20, 20], [10, 20]]);
  });

  it("moveQuad translates all corners by the same delta, preserving shape", () => {
    useEditor.getState().setCorners([[10, 10], [30, 10], [30, 30], [10, 30]]);
    useEditor.getState().moveQuad([5, -3]);
    expect(useEditor.getState().corners).toEqual([[15, 7], [35, 7], [35, 27], [15, 27]]);
  });

  it("moveQuad is a no-op when there are no corners", () => {
    useEditor.getState().moveQuad([5, 5]);
    expect(useEditor.getState().corners).toBeNull();
  });

  it("setImage resets placement and history state", () => {
    useEditor.getState().setDetectedCorners([[1, 1], [2, 1], [2, 2], [1, 2]]);
    useEditor.getState().setAdjusting(false);
    useEditor.getState().commit();
    useEditor.getState().setImage("data:image/png;base64,zzz");
    expect(useEditor.getState().detectedCorners).toBeNull();
    expect(useEditor.getState().adjusting).toBe(true);
    expect(useEditor.getState().history).toHaveLength(0);
    expect(useEditor.getState().historyIndex).toBe(-1);
  });
});

describe("retouching: mode, strokes, mutual exclusion", () => {
  beforeEach(reset);

  it("setRetouching(true) turns off adjusting", () => {
    useEditor.getState().setAdjusting(true);
    useEditor.getState().setRetouching(true);
    expect(useEditor.getState().retouching).toBe(true);
    expect(useEditor.getState().adjusting).toBe(false);
  });

  it("setAdjusting(true) turns off retouching", () => {
    useEditor.getState().setRetouching(true);
    useEditor.getState().setAdjusting(true);
    expect(useEditor.getState().adjusting).toBe(true);
    expect(useEditor.getState().retouching).toBe(false);
  });

  it("addStroke with tool 'brush' always lands in retouchStrokes, regardless of activeLayer", () => {
    useEditor.getState().setActiveLayer("result");
    const stroke = { tool: "brush" as const, color: "#000000", size: 10, opacity: 1, points: [[1, 1]] as [number, number][] };
    useEditor.getState().addStroke(stroke);
    expect(useEditor.getState().retouchStrokes).toEqual([stroke]);
    expect(useEditor.getState().resultMaskStrokes).toEqual([]);
  });

  it("addStroke with tool 'eraser' lands in retouchStrokes when activeLayer is 'retouch'", () => {
    useEditor.getState().setActiveLayer("retouch");
    const stroke = { tool: "eraser" as const, color: "#000000", size: 10, opacity: 1, points: [[1, 1]] as [number, number][] };
    useEditor.getState().addStroke(stroke);
    expect(useEditor.getState().retouchStrokes).toEqual([stroke]);
    expect(useEditor.getState().resultMaskStrokes).toEqual([]);
  });

  it("addStroke with tool 'eraser' lands in resultMaskStrokes when activeLayer is 'result'", () => {
    useEditor.getState().setActiveLayer("result");
    const stroke = { tool: "eraser" as const, color: "#000000", size: 10, opacity: 1, points: [[1, 1]] as [number, number][] };
    useEditor.getState().addStroke(stroke);
    expect(useEditor.getState().resultMaskStrokes).toEqual([stroke]);
    expect(useEditor.getState().retouchStrokes).toEqual([]);
  });

  it("addStroke commits exactly once", () => {
    useEditor.getState().addStroke({ tool: "brush", color: "#000000", size: 10, opacity: 1, points: [[1, 1]] });
    expect(useEditor.getState().history).toHaveLength(1);
  });

  it("undo/redo restore the stroke arrays", () => {
    useEditor.getState().addStroke({ tool: "brush", color: "#000000", size: 10, opacity: 1, points: [[1, 1]] });
    useEditor.getState().addStroke({ tool: "brush", color: "#000000", size: 10, opacity: 1, points: [[2, 2]] });
    expect(useEditor.getState().retouchStrokes).toHaveLength(2);

    useEditor.getState().undo();
    expect(useEditor.getState().retouchStrokes).toHaveLength(1);

    useEditor.getState().redo();
    expect(useEditor.getState().retouchStrokes).toHaveLength(2);
  });

  it("setImage resets retouching mode and both stroke arrays", () => {
    useEditor.getState().setRetouching(true);
    useEditor.getState().addStroke({ tool: "brush", color: "#000000", size: 10, opacity: 1, points: [[1, 1]] });
    useEditor.getState().setImage("data:image/png;base64,zzz");
    expect(useEditor.getState().retouching).toBe(false);
    expect(useEditor.getState().retouchStrokes).toEqual([]);
    expect(useEditor.getState().resultMaskStrokes).toEqual([]);
  });
});

describe("separate text placement", () => {
  beforeEach(reset);

  it("turning it on with no existing text quad auto-offsets below the bars quad", () => {
    useEditor.getState().setCorners([[0, 0], [200, 0], [200, 50], [0, 50]]);
    useEditor.getState().setSeparateTextPlacement(true);
    expect(useEditor.getState().separateTextPlacement).toBe(true);
    expect(useEditor.getState().textCorners).toEqual([[0, 50], [200, 50], [200, 70], [0, 70]]);
  });

  it("turning it on again does not overwrite an already-adjusted text quad", () => {
    useEditor.getState().setCorners([[0, 0], [200, 0], [200, 50], [0, 50]]);
    useEditor.getState().setSeparateTextPlacement(true);
    useEditor.getState().setTextCorners([[10, 60], [210, 60], [210, 80], [10, 80]]);
    useEditor.getState().setSeparateTextPlacement(false);
    useEditor.getState().setSeparateTextPlacement(true);
    expect(useEditor.getState().textCorners).toEqual([[10, 60], [210, 60], [210, 80], [10, 80]]);
  });

  it("moveTextQuad translates all text corners by the same delta", () => {
    useEditor.getState().setTextCorners([[10, 10], [30, 10], [30, 30], [10, 30]]);
    useEditor.getState().moveTextQuad([5, -3]);
    expect(useEditor.getState().textCorners).toEqual([[15, 7], [35, 7], [35, 27], [15, 27]]);
  });

  it("moveTextQuad is a no-op when there are no text corners", () => {
    useEditor.getState().moveTextQuad([5, 5]);
    expect(useEditor.getState().textCorners).toBeNull();
  });

  it("updateTextCorner is a no-op when there are no text corners", () => {
    useEditor.getState().updateTextCorner(0, [99, 99]);
    expect(useEditor.getState().textCorners).toBeNull();
  });

  it("setImage resets text placement state", () => {
    useEditor.getState().setCorners([[0, 0], [200, 0], [200, 50], [0, 50]]);
    useEditor.getState().setSeparateTextPlacement(true);
    useEditor.getState().setImage("data:image/png;base64,zzz");
    expect(useEditor.getState().textCorners).toBeNull();
    expect(useEditor.getState().separateTextPlacement).toBe(false);
  });

  it("turning show_text off turns separateTextPlacement off too, not just hiding its toggle", () => {
    // otherwise separateTextPlacement stays stuck true with no UI control
    // left to reach it, and EditorCanvas would keep showing an orphaned
    // text-placement box with no way to turn it off
    useEditor.getState().setCorners([[0, 0], [200, 0], [200, 50], [0, 50]]);
    useEditor.getState().setSeparateTextPlacement(true);
    useEditor.getState().setOption("show_text", false);
    expect(useEditor.getState().separateTextPlacement).toBe(false);
  });

  it("switching symbology to qr turns separateTextPlacement off too", () => {
    useEditor.getState().setCorners([[0, 0], [200, 0], [200, 50], [0, 50]]);
    useEditor.getState().setSeparateTextPlacement(true);
    useEditor.getState().setField("symbology", "qr");
    expect(useEditor.getState().separateTextPlacement).toBe(false);
  });

  it("setTextFontScale updates options.text_font_scale and rescales textCorners around their center", () => {
    useEditor.getState().setTextCorners([[0, 0], [100, 0], [100, 40], [0, 40]]); // center [50, 20]
    useEditor.getState().setTextFontScale(1.5);
    expect(useEditor.getState().options.text_font_scale).toBe(1.5);
    expect(useEditor.getState().textCorners).toEqual([[-25, -10], [125, -10], [125, 50], [-25, 50]]);
  });

  it("setTextFontScale updates the option even when there are no text corners yet", () => {
    useEditor.getState().setTextFontScale(1.2);
    expect(useEditor.getState().options.text_font_scale).toBe(1.2);
    expect(useEditor.getState().textCorners).toBeNull();
  });

  it("setTextFontScale clamps to a safe positive minimum instead of allowing zero/negative", () => {
    useEditor.getState().setTextCorners([[0, 0], [100, 0], [100, 40], [0, 40]]);
    useEditor.getState().setTextFontScale(0);
    expect(useEditor.getState().options.text_font_scale).toBeGreaterThan(0);
    // a subsequent call must not divide by zero / produce NaN
    useEditor.getState().setTextFontScale(1.0);
    expect(Number.isFinite(useEditor.getState().textCorners![0][0])).toBe(true);
  });

  it("resetCorners preserves the current text_font_scale instead of snapping back to 100%", () => {
    useEditor.getState().setDetectedCorners([[0, 0], [200, 0], [200, 50], [0, 50]]);
    useEditor.getState().setCorners([[0, 0], [200, 0], [200, 50], [0, 50]]);
    useEditor.getState().setSeparateTextPlacement(true); // textCorners = offsetTextQuad(...): [[0,50],[200,50],[200,70],[0,70]]
    useEditor.getState().setTextFontScale(2.0); // textCorners doubles around its own center
    useEditor.getState().resetCorners();
    // offsetTextQuad(detectedCorners) is [[0,50],[200,50],[200,70],[0,70]] (center [100,60]),
    // scaled by 2.0 around that same center
    expect(useEditor.getState().textCorners).toEqual([[-100, 40], [300, 40], [300, 80], [-100, 80]]);
  });
});
