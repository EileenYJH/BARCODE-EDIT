import { create } from "zustand";
import type { Corner, BarcodeOptions, ReplaceResponse } from "./types";

interface LayerState { visible: boolean; opacity: number; }

interface EditorState {
  image: string | null;
  corners: Corner[] | null;
  symbology: string;
  value: string;
  options: BarcodeOptions;
  blendMode: string;
  result: ReplaceResponse | null;
  layers: Record<string, LayerState>;
  setImage: (img: string | null) => void;
  setCorners: (c: Corner[] | null) => void;
  updateCorner: (i: number, c: Corner) => void;
  setField: <K extends keyof EditorState>(k: K, v: EditorState[K]) => void;
  setOption: <K extends keyof BarcodeOptions>(k: K, v: BarcodeOptions[K]) => void;
  setResult: (r: ReplaceResponse | null) => void;
  setLayer: (name: string, patch: Partial<LayerState>) => void;
}

const defaultLayers = {
  original: { visible: true, opacity: 1 },
  new_barcode: { visible: true, opacity: 1 },
  result: { visible: true, opacity: 1 },
};

export const useEditor = create<EditorState>((set) => ({
  image: null,
  corners: null,
  symbology: "code128",
  value: "",
  options: { show_text: true, quiet_zone: 6.5, module_width: 0.2, module_height: 15 },
  blendMode: "normal",
  result: null,
  layers: defaultLayers,
  setImage: (img) => set({ image: img, corners: null, result: null }),
  setCorners: (c) => set({ corners: c }),
  updateCorner: (i, c) => set((s) => {
    if (!s.corners) return s;
    const next = s.corners.slice();
    next[i] = c;
    return { corners: next };
  }),
  setField: (k, v) => set({ [k]: v } as Partial<EditorState>),
  setOption: (k, v) => set((s) => ({ options: { ...s.options, [k]: v } })),
  setResult: (r) => set({ result: r }),
  setLayer: (name, patch) => set((s) => ({
    layers: { ...s.layers, [name]: { ...s.layers[name], ...patch } },
  })),
}));
