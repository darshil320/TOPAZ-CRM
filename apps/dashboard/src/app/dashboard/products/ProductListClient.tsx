"use client";

/**
 * The product list rows + bulk QR printing. Rows are server-computed (price/stock are
 * already null for roles that may not see them); this component only adds selection.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { ImageOff } from "lucide-react";
import Pill from "@/components/ui/Pill";
import StickerPrintForm from "@/components/products/StickerPrintForm";
import { formatINR } from "@/lib/format";
import {
  STOCK_STATUS_TONE,
  isStockStatus,
  stockStatusLabel,
  totalQuantity,
  type ProductPrice,
  type StockAt,
} from "@/lib/products/types";

export interface ProductCard {
  id: string;
  name: string;
  category: string | null;
  dimensions: string | null;
  stock_status: string;
  qr_code: string;
  active: boolean;
  thumbUrl: string | null;
  price: ProductPrice | null;
  stock: StockAt[] | null;
}

export default function ProductListClient({
  products,
  canPrint,
}: {
  products: ProductCard[];
  canPrint: boolean;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const allSelected = products.length > 0 && products.every((p) => selected.has(p.id));
  const selectedIds = useMemo(() => products.filter((p) => selected.has(p.id)).map((p) => p.id), [products, selected]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(products.map((p) => p.id)));

  return (
    <>
      {canPrint && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ln bg-sf2 px-4 py-2.5">
          <label className="flex items-center gap-2 text-caption font-semibold text-t2">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded-kbd border-ln" />
            {selectedIds.length > 0 ? `${selectedIds.length} selected` : "Select all on this page"}
          </label>
          {selectedIds.length > 0 && <StickerPrintForm productIds={selectedIds} label="Print stickers" />}
        </div>
      )}

      <ul className="divide-y divide-ln2">
        {products.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-4 py-3 hover:bg-sf2 transition-colors">
            {canPrint && (
              <input
                type="checkbox"
                checked={selected.has(p.id)}
                onChange={() => toggle(p.id)}
                aria-label={`Select ${p.name}`}
                className="shrink-0 rounded-kbd border-ln"
              />
            )}
            <Link href={`/dashboard/products/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-ln bg-sf2">
                {p.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                  <img src={p.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <ImageOff className="h-4 w-4 text-t3" strokeWidth={1.7} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-body font-semibold ${p.active ? "text-t1" : "text-t3 line-through"}`}>
                  {p.name}
                </span>
                <span className="block truncate text-caption text-t3">
                  {[p.category, p.dimensions].filter(Boolean).join(" · ") || "—"}
                </span>
                <span className="font-mono text-meta tabular-nums text-t3">#{p.qr_code}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                {isStockStatus(p.stock_status) && (
                  <Pill tone={STOCK_STATUS_TONE[p.stock_status]} dot={false}>
                    {stockStatusLabel(p.stock_status)}
                  </Pill>
                )}
                {p.price && (
                  <span className="font-mono text-ui font-semibold tabular-nums text-t1">
                    {p.price.base_price == null ? "On request" : formatINR(p.price.base_price)}
                  </span>
                )}
                {p.stock && <StockSummary stock={p.stock} />}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

/** "3 pcs · Godown 2 · Bhatar 1" — only locations that hold something. */
function StockSummary({ stock }: { stock: StockAt[] }) {
  const held = stock.filter((s) => s.quantity > 0);
  return (
    <span className="max-w-[14rem] truncate text-right font-mono text-meta tabular-nums text-t3">
      {totalQuantity(stock)} pcs
      {held.length > 0 && ` · ${held.map((s) => `${s.location.name} ${s.quantity}`).join(" · ")}`}
    </span>
  );
}
