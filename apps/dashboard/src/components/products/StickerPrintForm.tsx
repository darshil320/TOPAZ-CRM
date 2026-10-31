"use client";

/**
 * Print QR stickers as a PDF. A plain form POST (not fetch) to the route handler at
 * /dashboard/products/stickers, opened in a new tab: the browser's own PDF viewer then
 * handles print / save / share on every phone and desktop, with no blob plumbing.
 *
 * Size/layout keys mirror apps/api/src/services/qr_stickers.py STICKER_SIZES / LAYOUTS.
 */
import { Printer } from "lucide-react";
import Button from "@/components/ui/Button";

export const STICKER_SIZE_OPTIONS = [
  { id: "small", label: "Small · 25 × 25 mm" },
  { id: "medium", label: "Medium · 38 × 25 mm" },
  { id: "large", label: "Large · 50 × 50 mm" },
] as const;

export const STICKER_LAYOUT_OPTIONS = [
  { id: "sheet", label: "A4 sheet" },
  { id: "roll", label: "Label printer (1 per page)" },
] as const;

const MAX_COPIES = 20;

const SELECT =
  "py-1.5 px-2.5 bg-sf2 border border-ln rounded-md text-ui text-t1 focus:outline-none focus:border-acc";

export default function StickerPrintForm({
  productIds,
  label = "Print QR",
}: {
  productIds: string[];
  label?: string;
}) {
  return (
    <form
      method="post"
      action="/dashboard/products/stickers"
      target="_blank"
      className="flex flex-wrap items-center gap-2"
    >
      {productIds.map((id) => (
        <input key={id} type="hidden" name="id" value={id} />
      ))}
      <select name="size" defaultValue="small" aria-label="Sticker size" className={SELECT}>
        {STICKER_SIZE_OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <select name="layout" defaultValue="sheet" aria-label="Paper" className={SELECT}>
        {STICKER_LAYOUT_OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1.5 text-caption text-t2">
        Copies
        <input
          type="number"
          name="copies"
          min={1}
          max={MAX_COPIES}
          defaultValue={1}
          inputMode="numeric"
          className={`${SELECT} w-16 font-mono tabular-nums`}
        />
      </label>
      <Button type="submit" disabled={productIds.length === 0}>
        <Printer className="h-3.5 w-3.5" strokeWidth={2} />
        {label}
      </Button>
    </form>
  );
}
