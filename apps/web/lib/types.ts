export type Corner = [number, number];

export interface Detection {
  corners: Corner[];
  type: string | null;
  value: string | null;
  confidence: number;
  bbox: number[];
}

export interface BarcodeOptions {
  show_text: boolean;
  quiet_zone: number;
  module_width: number;
  module_height: number;
}

export interface ReplaceResponse {
  result: string;
  svg: string;
  layers: Record<"original" | "new_barcode" | "mask", string>;
}

export type ActiveLayer = "retouch" | "result";

export interface Stroke {
  tool: "brush" | "eraser";
  color: string;
  size: number;
  opacity: number;
  points: Corner[];
}

export interface EditorSnapshot {
  corners: Corner[] | null;
  textCorners: Corner[] | null;
  separateTextPlacement: boolean;
  symbology: string;
  value: string;
  options: BarcodeOptions;
  blendMode: string;
  result: ReplaceResponse | null;
  retouchStrokes: Stroke[];
  resultMaskStrokes: Stroke[];
}
