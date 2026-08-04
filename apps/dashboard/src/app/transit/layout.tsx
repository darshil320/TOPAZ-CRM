import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Truck } from "lucide-react";
import { getCurrentSalesperson } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Topaz Transit",
  description: "Inter-workshop goods movement for Topaz drivers",
};

/**
 * The mediator app shell — a driver's phone, nothing else.
 *
 * Deliberately WITHOUT the dashboard chrome the workshop PWA keeps (no "Live Board"
 * link, no back-to-dashboard): a `delivery` user has no dashboard to go back to, and
 * every link that 403s is a support call.
 *
 * MONEY: nothing on any screen under this layout shows a price, and it cannot — every
 * read goes through `/api/transfers`, whose projections omit unit_price/line_total/
 * gst_rate, and a `delivery` role has no `order_items` SELECT policy to fall back on.
 */
export default async function TransitLayout({ children }: { children: React.ReactNode }) {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Fixed h-16: the run list's sticky filter bar pins to `top-16`. */}
      <header className="sticky top-0 z-40 h-16 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-sky-500 text-slate-950 flex items-center justify-center font-bold shadow-md shadow-sky-500/20">
            <Truck className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight">
              टोपाज़ ट्रांज़िट / Topaz Transit
            </h1>
            <p className="text-[11px] text-slate-400 font-medium">
              {sp.name} <span className="text-slate-500">· {sp.role}</span>
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto p-4 sm:p-6 pb-24">{children}</main>

      <footer className="py-4 text-center text-slate-500 text-xs border-t border-slate-900 bg-slate-950">
        Topaz Showroom Intelligence · Workshop-to-workshop transit
      </footer>
    </div>
  );
}
