import { redirect } from "next/navigation";
import { AlertTriangle, PackageCheck } from "lucide-react";
import { getCurrentSalesperson } from "@/lib/auth";
import { getMyRuns } from "@/lib/production/reads";
import TransitClient from "./TransitClient";

/**
 * "આજની ટ્રિપ / Today's runs" — the mediator app's home screen.
 *
 * The client's ask, verbatim: "mediator app for sending the product with its data to
 * another workshop, like for delivery guy who know which product to transfer to which
 * workshop". So each run card carries: which goods (photo, description, size, material),
 * from where (address + a tap-to-call number), to where (same), and by when.
 *
 * An empty list is a NORMAL state, not an error: "no runs today" is most days for most
 * drivers, and it must render as a calm empty state rather than a failure.
 */
export default async function TransitPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");

  const { data, error } = await getMyRuns();
  const runs = data?.transfers ?? [];

  const pending = runs.filter((r) => r.status === "ready").length;
  const onRoad = runs.filter((r) => r.status === "picked_up" || r.status === "in_transit").length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-4 rounded-xl">
        <div>
          <h2 className="text-lg font-extrabold text-white">आज की ट्रिप / Today&apos;s runs</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {pending} कलेक्ट करना है / to collect
            {onRoad > 0 && <span className="text-sky-300 font-bold"> · {onRoad} on the road</span>}
          </p>
        </div>
        <span className="font-mono text-xs font-bold text-sky-300 bg-sky-500/10 border border-sky-500/30 px-2.5 py-1 rounded-md shrink-0">
          {runs.length} run{runs.length === 1 ? "" : "s"}
        </span>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs font-semibold text-red-400 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {runs.length === 0 && !error ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center space-y-3">
          <PackageCheck className="w-12 h-12 text-emerald-400 mx-auto" />
          <h3 className="text-base font-bold text-white">कोई ट्रिप बाकी नहीं / No runs pending</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            वर्कशॉप्स के बीच अभी कुछ भी मूव नहीं करना है। जैसे ही कोई वर्कशॉप सामान हैंडओवर करेगा, नए रन यहाँ दिखाई देंगे।
          </p>
        </div>
      ) : (
        <TransitClient initialRuns={runs} />
      )}
    </div>
  );
}
