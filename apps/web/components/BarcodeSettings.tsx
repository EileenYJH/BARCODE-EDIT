"use client";
import { useEditor } from "@/lib/store";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const SYMBOLOGIES = ["ean13", "ean8", "upca", "code128", "code39", "qr"];

export function BarcodeSettings() {
  const { symbology, value, options, setField, setOption } = useEditor();
  return (
    <div className="space-y-3">
      <div>
        <Label>Symbology</Label>
        <Select value={symbology} onValueChange={(v) => v !== null && setField("symbology", v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {SYMBOLOGIES.map((s) => <SelectItem key={s} value={s}>{s.toUpperCase()}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Value</Label>
        <Input value={value} onChange={(e) => setField("value", e.target.value)}
               placeholder="e.g. 5901234123457" />
      </div>
      <div className="flex items-center justify-between">
        <Label>Show text</Label>
        <Switch checked={options.show_text}
                onCheckedChange={(v) => setOption("show_text", v)} />
      </div>
    </div>
  );
}
