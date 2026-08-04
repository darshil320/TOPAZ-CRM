import { formatINR, formatDate } from "@/lib/format";
import ApproveActions from "./ApproveActions";

type Props = { params: Promise<{ token: string }> };

// Server-side only. The approve/reject buttons no longer talk to the API from
// the browser — they go through a same-origin server action (./actions.ts).
const SERVER_API = process.env.TOPAZ_API_URL ?? "http://localhost:8000";
const HOME_STATE = process.env.NEXT_PUBLIC_HOME_STATE ?? "GJ";

interface PublicItem {
  description: string;
  dimensions: string | null;
  material: string | null;
  fabric: string | null;
  polish: string | null;
  customization: string | null;
  qty: number;
  unit: string | null;
  unit_price: number;
  hsn: string;
  gst_rate: number;
  line_total: number;
}

interface PublicQuote {
  quote_no: string;
  status: string;
  revision_no: number;
  valid_until: string | null;
  place_of_supply: string;
  subtotal: number;
  discount_amount: number;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  grand_total: number;
  terms: string | null;
  customer_name: string;
  items: PublicItem[];
}

async function loadQuote(token: string): Promise<PublicQuote | null> {
  try {
    const resp = await fetch(`${SERVER_API}/api/public/quotes/${token}`, { cache: "no-store" });
    if (!resp.ok) return null;
    return (await resp.json()) as PublicQuote;
  } catch {
    return null;
  }
}

export default async function PublicQuotePage({ params }: Props) {
  const { token } = await params;
  const quote = await loadQuote(token);

  if (!quote) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="text-center">
          <p className="text-sm font-medium text-slate-700">Quotation not found</p>
          <p className="mt-1 text-xs text-slate-400">
            This link may have expired. Please contact Topaz Furniture.
          </p>
        </div>
      </div>
    );
  }

  const intra = quote.place_of_supply === HOME_STATE;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="text-center">
          <p className="text-lg font-bold text-amber-700">Topaz Furniture</p>
          <p className="text-xs text-slate-400">Fine Furniture &amp; Interiors</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-slate-900">
                Quotation {quote.quote_no}
                {quote.revision_no > 1 && ` · Rev ${quote.revision_no}`}
              </p>
              <p className="text-xs text-slate-500">For {quote.customer_name}</p>
            </div>
            <p className="text-xs text-slate-400">Valid until {formatDate(quote.valid_until)}</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {quote.items.map((it, i) => {
            const specs = [it.dimensions, it.material, it.fabric, it.polish, it.customization].filter(Boolean);
            return (
              <div key={i} className="border-b border-slate-50 p-4 last:border-0">
                <div className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">{it.description}</p>
                    {specs.length > 0 && <p className="mt-0.5 text-xs text-slate-400">{specs.join(" · ")}</p>}
                    <p className="mt-0.5 text-xs text-slate-400">
                      {it.qty}
                      {it.unit ? ` ${it.unit}` : ""} × {formatINR(it.unit_price)}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-medium text-slate-800">{formatINR(it.line_total)}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <dl className="space-y-1.5 text-sm">
            <Row label="Subtotal" value={formatINR(quote.subtotal)} />
            {quote.discount_amount > 0 && <Row label="Discount" value={`− ${formatINR(quote.discount_amount)}`} />}
            <Row label="Taxable value" value={formatINR(quote.taxable_value)} />
            {intra ? (
              <>
                <Row label="CGST" value={formatINR(quote.cgst)} muted />
                <Row label="SGST" value={formatINR(quote.sgst)} muted />
              </>
            ) : (
              <Row label="IGST" value={formatINR(quote.igst)} muted />
            )}
            <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
              <dt className="font-semibold text-slate-900">Total</dt>
              <dd className="text-base font-bold text-slate-900">{formatINR(quote.grand_total)}</dd>
            </div>
          </dl>
        </div>

        {quote.terms && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Terms</p>
            <p className="whitespace-pre-wrap text-xs text-slate-500">{quote.terms}</p>
          </div>
        )}

        <ApproveActions token={token} initialStatus={quote.status} />

        <p className="pb-4 text-center text-[11px] text-slate-400">
          Questions? Reply on WhatsApp or call the showroom.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={muted ? "text-slate-400" : "text-slate-500"}>{label}</dt>
      <dd className={muted ? "text-slate-500" : "text-slate-700"}>{value}</dd>
    </div>
  );
}
