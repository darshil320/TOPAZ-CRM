"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

import Pill from "@/components/ui/Pill";

export type AlertItem = {
  id: string;
  type: string;
  detail: string | null;
  created_at: string;
  customer_id: string;
  customer_name: string | null;
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
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-body font-semibold text-t1">No triggers yet</p>
        <p className="text-caption text-t3 mt-1">
          Intent signals from customer replies (call / visit / buying / confusion) appear here live.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-ln2">
      {alerts.map((alert) => (
        <li key={alert.id} className="py-2.5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Pill tone={alert.type === "intent_call" || alert.type === "confusion" ? "warn" : "pos"} dot={false}>
                {alert.type.replace("_", " ")}
              </Pill>
              <span className="text-ui font-semibold text-t1 truncate">
                {alert.customer_name ?? "Customer"}
              </span>
              <span className="text-caption font-mono text-t3">{relativeTime(alert.created_at)}</span>
            </div>
            {alert.detail && (
              <p className="text-caption text-t2 mt-1 truncate">“{alert.detail}”</p>
            )}
          </div>
          <Link
            href={`/dashboard/customers/${alert.customer_id}`}
            className="shrink-0 text-caption font-semibold text-t1 hover:text-acc transition-colors"
          >
            View →
          </Link>
        </li>
      ))}
    </ul>
  );
}
