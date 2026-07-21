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

export interface EditorSnapshot {
  corners: Corner[] | null;
  symbology: string;
  value: string;
  options: BarcodeOptions;
  blendMode: string;
  result: ReplaceResponse | null;
  layers: Record<string, { visible: boolean; opacity: number }>;
}
