"use client";
import { useEditor } from "@/lib/store";
import { detect } from "@/lib/api";

export function UploadPanel() {
  const setImage = useEditor((s) => s.setImage);
  const setCorners = useEditor((s) => s.setCorners);
  const setDetectedCorners = useEditor((s) => s.setDetectedCorners);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl: string = await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result as string);
      fr.readAsDataURL(file);
    });
    setImage(dataUrl);
    try {
      const dets = await detect(dataUrl);
      if (dets.length) {
        setCorners(dets[0].corners);
        setDetectedCorners(dets[0].corners);
      }
    } catch {
      /* leave corners null; user draws manually (future) */
    }
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Upload image</label>
      <input type="file" accept="image/png,image/jpeg" onChange={onFile}
             className="block w-full text-sm" />
    </div>
  );
}
