/**
 * The staff-only half of a product: status, price + GST, stock by location.
 *
 * Renders only what the caller's role was GIVEN — `price`/`stock` are null when the
 * reads in lib/products/reads.ts were skipped or the database refused them. Hiding
 * here is presentation; the product_prices gate and product_stock RLS are the rule.
 */
import Pill from "@/components/ui/Pill";
import { formatINR } from "@/lib/format";
import { round2 } from "@/lib/gst";
import {
  STOCK_STATUS_TONE,
  isStockStatus,
  stockStatusLabel,
  totalQuantity,
  type StaffProduct,
} from "@/lib/products/types";

export default function StaffProductPanel({ product }: { product: StaffProduct }) {
  const status = isStockStatus(product.stock_status) ? product.stock_status : null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {status && <Pill tone={STOCK_STATUS_TONE[status]}>{stockStatusLabel(status)}</Pill>}
        {!product.active && <Pill tone="warn">Inactive</Pill>}
        <span className="font-mono text-caption tabular-nums text-t3">#{product.code}</span>
      </div>

      {product.price && <PriceBlock price={product.price} unit={product.unit} />}
      {product.stock && <StockBlock product={product} />}
    </div>
  );
}

function PriceBlock({ price, unit }: { price: NonNullable<StaffProduct["price"]>; unit: string | null }) {
  const base = price.base_price;
  const withGst = base == null ? null : round2(base * (1 + price.gst_rate / 100));
  return (
    <div className="grid grid-cols-3 gap-px overflow-hidden rounded-card border border-ln bg-ln">
      <Metric label={`Price${unit ? ` / ${unit}` : ""}`} value={base == null ? "On request" : formatINR(base)} />
      <Metric label="GST" value={`${price.gst_rate}%`} sub={`HSN ${price.hsn}`} />
      <Metric label="Incl. GST" value={withGst == null ? "—" : formatINR(withGst)} />
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-sf px-3 py-2.5">
      <p className="text-label-sm uppercase text-t3">{label}</p>
      <p className="mt-0.5 font-mono text-section tabular-nums text-t1">{value}</p>
      {sub && <p className="font-mono text-meta tabular-nums text-t3">{sub}</p>}
    </div>
  );
}

function StockBlock({ product }: { product: StaffProduct }) {
  const stock = product.stock ?? [];
  return (
    <div className="rounded-card border border-ln bg-sf">
      <div className="flex items-center justify-between border-b border-ln2 px-3 py-2">
        <span className="text-label uppercase text-t3">Stock by location</span>
        <span className="font-mono text-ui font-semibold tabular-nums text-t1">
          {totalQuantity(stock)} total
        </span>
      </div>
      <ul className="grid grid-cols-2 gap-px bg-ln2">
        {stock.map(({ location, quantity }) => (
          <li key={location.id} className="flex items-center justify-between bg-sf px-3 py-2">
            <span className="text-caption text-t2">{location.name}</span>
            <span
              className={`font-mono text-ui font-semibold tabular-nums ${quantity > 0 ? "text-t1" : "text-t3"}`}
            >
              {quantity}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
