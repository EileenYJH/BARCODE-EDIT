import { create } from "zustand";
import type { Corner, BarcodeOptions, ReplaceResponse, EditorSnapshot, ActiveLayer, Stroke } from "./types";
import { offsetTextQuad } from "./transform";

interface EditorState {
  image: string | null;
  corners: Corner[] | null;
  textCorners: Corner[] | null;
  separateTextPlacement: boolean;
  detectedCorners: Corner[] | null;
  adjusting: boolean;
  retouching: boolean;
  activeLayer: ActiveLayer;
  tool: "brush" | "eraser";
  brushSize: number;
  brushColor: string;
  brushOpacity: number;
  symbology: string;
  value: string;
  options: BarcodeOptions;
  blendMode: string;
  result: ReplaceResponse | null;
  retouchStrokes: Stroke[];
  resultMaskStrokes: Stroke[];
  history: EditorSnapshot[];
  historyIndex: number;
  setImage: (img: string | null) => void;
  setCorners: (c: Corner[] | null) => void;
  updateCorner: (i: number, c: Corner) => void;
  setTextCorners: (c: Corner[] | null) => void;
  updateTextCorner: (i: number, c: Corner) => void;
  moveTextQuad: (delta: Corner) => void;
  setSeparateTextPlacement: (v: boolean) => void;
  setDetectedCorners: (c: Corner[] | null) => void;
  setAdjusting: (v: boolean) => void;
  setRetouching: (v: boolean) => void;
  setActiveLayer: (l: ActiveLayer) => void;
  setTool: (t: "brush" | "eraser") => void;
  setBrushSize: (n: number) => void;
  setBrushColor: (c: string) => void;
  setBrushOpacity: (n: number) => void;
  addStroke: (stroke: Stroke) => void;
  moveQuad: (delta: Corner) => void;
  resetCorners: () => void;
  setField: <K extends keyof EditorState>(k: K, v: EditorState[K]) => void;
  setOption: <K extends keyof BarcodeOptions>(k: K, v: BarcodeOptions[K]) => void;
  setResult: (r: ReplaceResponse | null) => void;
  commit: () => void;
  undo: () => void;
  redo: () => void;
}

export const useEditor = create<EditorState>((set, get) => ({
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
  options: { show_text: true, quiet_zone: 6.5, module_width: 0.2, module_height: 15 },
  blendMode: "normal",
  result: null,
  retouchStrokes: [],
  resultMaskStrokes: [],
  history: [],
  historyIndex: -1,
  setImage: (img) => set({
    image: img, corners: null, result: null,
    textCorners: null, separateTextPlacement: false,
    detectedCorners: null, adjusting: true, retouching: false,
    retouchStrokes: [], resultMaskStrokes: [],
    history: [], historyIndex: -1,
  }),
  setCorners: (c) => set({ corners: c }),
  updateCorner: (i, c) => set((s) => {
    if (!s.corners) return s;
    const next = s.corners.slice();
    next[i] = c;
    return { corners: next };
  }),
  setTextCorners: (c) => set({ textCorners: c }),
  updateTextCorner: (i, c) => set((s) => {
    if (!s.textCorners) return s;
    const next = s.textCorners.slice();
    next[i] = c;
    return { textCorners: next };
  }),
  moveTextQuad: (delta) => set((s) => {
    if (!s.textCorners) return s;
    const [dx, dy] = delta;
    return { textCorners: s.textCorners.map(([x, y]) => [x + dx, y + dy] as Corner) };
  }),
  setSeparateTextPlacement: (v) => set((s) => {
    if (v && !s.textCorners && s.corners) {
      return { separateTextPlacement: true, textCorners: offsetTextQuad(s.corners) };
    }
    return { separateTextPlacement: v };
  }),
  setDetectedCorners: (c) => set({ detectedCorners: c }),
  setAdjusting: (v) => set(v ? { adjusting: true, retouching: false } : { adjusting: false }),
  setRetouching: (v) => set(v ? { retouching: true, adjusting: false } : { retouching: false }),
  setActiveLayer: (l) => set({ activeLayer: l }),
  setTool: (t) => set({ tool: t }),
  setBrushSize: (n) => set({ brushSize: n }),
  setBrushColor: (c) => set({ brushColor: c }),
  setBrushOpacity: (n) => set({ brushOpacity: n }),
  addStroke: (stroke) => {
    set((s) => {
      if (stroke.tool === "brush") {
        return { retouchStrokes: [...s.retouchStrokes, stroke] };
      }
      return s.activeLayer === "retouch"
        ? { retouchStrokes: [...s.retouchStrokes, stroke] }
        : { resultMaskStrokes: [...s.resultMaskStrokes, stroke] };
    });
    get().commit();
  },
  moveQuad: (delta) => set((s) => {
    if (!s.corners) return s;
    const [dx, dy] = delta;
    return { corners: s.corners.map(([x, y]) => [x + dx, y + dy] as Corner) };
  }),
  resetCorners: () => {
    set((s) => {
      if (!s.detectedCorners) return s;
      // resetting the bars quad without also re-offsetting the text quad
      // would leave it positioned relative to wherever the bars quad used
      // to be (before scale/rotate/drag), orphaned from the freshly-reset
      // bars quad it's supposed to sit below
      return {
        corners: s.detectedCorners,
        textCorners: s.separateTextPlacement ? offsetTextQuad(s.detectedCorners) : s.textCorners,
      };
    });
    get().commit();
  },
  setField: (k, v) => set((s) => {
    // switching to QR removes the "Separate text placement" toggle (QR has
    // no separate readable-text caption in this app), which would otherwise
    // leave separateTextPlacement stuck true with no UI control left to
    // turn it off, and an orphaned text-placement box still shown on canvas
    if (k === "symbology" && v === "qr" && s.separateTextPlacement) {
      return { [k]: v, separateTextPlacement: false } as Partial<EditorState>;
    }
    return { [k]: v } as Partial<EditorState>;
  }),
  setOption: (k, v) => set((s) => {
    const options = { ...s.options, [k]: v };
    // turning off "Show text" removes the "Separate text placement" toggle
    // too -- same orphaned-state reasoning as the symbology case above
    if (k === "show_text" && v === false && s.separateTextPlacement) {
      return { options, separateTextPlacement: false };
    }
    return { options };
  }),
  setResult: (r) => set({ result: r }),
  commit: () => set((s) => {
    const snapshot: EditorSnapshot = {
      corners: s.corners, textCorners: s.textCorners, separateTextPlacement: s.separateTextPlacement,
      symbology: s.symbology, value: s.value,
      options: s.options, blendMode: s.blendMode, result: s.result,
      retouchStrokes: s.retouchStrokes, resultMaskStrokes: s.resultMaskStrokes,
    };
    const truncated = s.history.slice(0, s.historyIndex + 1);
    const history = [...truncated, snapshot];
    return { history, historyIndex: history.length - 1 };
  }),
  undo: () => set((s) => {
    if (s.historyIndex <= 0) return s;
    const idx = s.historyIndex - 1;
    return { historyIndex: idx, ...s.history[idx] };
  }),
  redo: () => set((s) => {
    if (s.historyIndex >= s.history.length - 1) return s;
    const idx = s.historyIndex + 1;
    return { historyIndex: idx, ...s.history[idx] };
  }),
}));

export const selectCanUndo = (s: EditorState) => s.historyIndex > 0;
export const selectCanRedo = (s: EditorState) => s.historyIndex < s.history.length - 1;
