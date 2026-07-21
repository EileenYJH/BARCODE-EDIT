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
