"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useVisitAlerts, type VisitAlert } from "@/hooks/useVisitAlerts";

export default function VisitAlertBanner({ salespersonId }: { salespersonId: string }) {
  const { alerts, dismissAlert } = useVisitAlerts(salespersonId);
  if (alerts.length === 0) return null;

  return (
    <div className="fixed top-16 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none">
      {alerts.map((alert) => (
        <AlertCard key={alert.id} alert={alert} onDismiss={() => dismissAlert(alert.id)} />
      ))}
    </div>
  );
}

function AlertCard({ alert, onDismiss }: { alert: VisitAlert; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 8000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const isRepeat = alert.match_band === "REPEAT";

  return (
    <div
      className={`rounded-xl shadow-lg border pointer-events-auto px-4 py-3.5 bg-white ${
        isRepeat ? "border-green-200" : "border-slate-200"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
            isRepeat ? "bg-green-100" : "bg-slate-100"
          }`}>
            {isRepeat ? (
              <svg className="w-3.5 h-3.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {isRepeat ? "Repeat visitor" : "New visitor"}
            </p>
            <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-md mt-0.5 ${
              isRepeat ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-600"
            }`}>
              {alert.match_band}
            </span>
          </div>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-slate-400 hover:text-slate-600 transition-colors p-0.5 rounded"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      {alert.customer_id && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <Link
            href={`/dashboard/customers/${alert.customer_id}`}
            onClick={onDismiss}
            className="flex items-center justify-between text-xs text-blue-600 hover:text-blue-700 font-medium group"
          >
            <span>View customer profile</span>
            <svg className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      )}
    </div>
  );
}
