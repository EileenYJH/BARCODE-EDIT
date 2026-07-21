import type { Detection, BarcodeOptions, ReplaceResponse } from "./types";

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export async function detect(image: string): Promise<Detection[]> {
  const r = await fetch(`${BASE}/api/detect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image }),
  });
  if (!r.ok) throw new Error(`detect failed: ${r.status}`);
  return (await r.json()).detections;
}

export async function replace(params: {
  image: string;
  corners: number[][];
  symbology: string;
  value: string;
  options: BarcodeOptions;
  blend_mode: string;
}): Promise<ReplaceResponse> {
  const r = await fetch(`${BASE}/api/replace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    throw new Error(detail.detail ?? `replace failed: ${r.status}`);
  }
  return r.json();
}
