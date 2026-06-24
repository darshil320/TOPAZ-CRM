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
  const title = isRepeat ? "🔔 Repeat visitor" : "👤 New visitor";

  return (
    <div className="bg-white rounded-xl shadow-lg border border-blue-200 px-4 py-3 pointer-events-auto">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold text-gray-900">{title}</span>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-gray-400 hover:text-gray-700 transition-colors text-lg leading-none"
        >
          ×
        </button>
      </div>
      <div className="flex items-center justify-between mt-2">
        <span
          className={`text-xs px-2 py-0.5 rounded-md border font-medium ${
            isRepeat
              ? "bg-green-50 text-green-700 border-green-200"
              : "bg-gray-50 text-gray-600 border-gray-200"
          }`}
        >
          {alert.match_band}
        </span>
        {alert.customer_id && (
          <Link
            href={`/dashboard/customers/${alert.customer_id}`}
            onClick={onDismiss}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium hover:underline"
          >
            View →
          </Link>
        )}
      </div>
    </div>
  );
}
