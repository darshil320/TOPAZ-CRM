"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type VisitAlert = {
  id: string;
  customer_id: string | null;
  match_band: string;
  occurred_at: string;
};

export function useVisitAlerts(salespersonId: string) {
  const [alerts, setAlerts] = useState<VisitAlert[]>([]);
  // Stable client — must not re-create on every render
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    if (!salespersonId) return;
    const supabase = supabaseRef.current;
    const channel = supabase
      .channel(`visits-alerts-${salespersonId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "visits",
          filter: `salesperson_id=eq.${salespersonId}`,
        },
        (payload) => {
          const alert = payload.new as VisitAlert;
          setAlerts((prev) => [alert, ...prev].slice(0, 5));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [salespersonId]);

  function dismissAlert(id: string) {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }

  return { alerts, dismissAlert };
}
