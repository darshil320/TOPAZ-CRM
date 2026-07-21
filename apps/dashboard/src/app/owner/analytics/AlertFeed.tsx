"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export type AlertItem = {
  id: string;
  type: string;
  detail: string | null;
  created_at: string;
  customer_id: string;
  customer_name: string | null;
};

const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  intent_call: { label: "Wants a call", color: "bg-red-100 text-red-700 border-red-200" },
  intent_visit: { label: "Plans to visit", color: "bg-blue-100 text-blue-700 border-blue-200" },
  confusion: { label: "Needs help", color: "bg-amber-100 text-amber-700 border-amber-200" },
  buying_signal: { label: "Buying signal", color: "bg-green-100 text-green-700 border-green-200" },
};

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function AlertFeed({ initialAlerts }: { initialAlerts: AlertItem[] }) {
  const [alerts, setAlerts] = useState<AlertItem[]>(initialAlerts);
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    const supabase = supabaseRef.current;
    const channel = supabase
      .channel("alerts-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "alerts" },
        (payload) => {
          const row = payload.new as {
            id: string;
            type: string;
            detail: string | null;
            created_at: string;
            customer_id: string;
          };
          setAlerts((prev) => {
            if (prev.some((a) => a.id === row.id)) return prev;
            return [{ ...row, customer_name: null }, ...prev].slice(0, 50);
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm font-medium text-slate-600">No triggers yet</p>
        <p className="text-xs text-slate-400 mt-1">
          Intent signals from customer replies (call / visit / buying / confusion) appear here live.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-100">
      {alerts.map((alert) => {
        const cfg = TYPE_CONFIG[alert.type] ?? { label: alert.type, color: "bg-slate-100 text-slate-600 border-slate-200" };
        return (
          <li key={alert.id} className="py-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${cfg.color}`}>
                  {cfg.label}
                </span>
                <span className="text-sm font-medium text-slate-800 truncate">
                  {alert.customer_name ?? "Customer"}
                </span>
                <span className="text-[11px] text-slate-400">{relativeTime(alert.created_at)}</span>
              </div>
              {alert.detail && (
                <p className="text-xs text-slate-500 mt-1 truncate">“{alert.detail}”</p>
              )}
            </div>
            <Link
              href={`/dashboard/customers/${alert.customer_id}`}
              className="shrink-0 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              View →
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
