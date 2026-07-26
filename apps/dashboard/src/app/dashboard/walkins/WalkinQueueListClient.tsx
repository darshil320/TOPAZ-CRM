"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import Pill from "@/components/ui/Pill";
import Pagination from "@/components/ui/Pagination";
import ClaimButton from "./ClaimButton";

export interface WalkinCustomer {
  id: string;
  name: string | null;
  phone: string | null;
  primary_interest: string | null;
  created_at: string;
  visits?: { match_band: string; occurred_at: string }[];
}

export default function WalkinQueueListClient({ unclaimed }: { unclaimed: WalkinCustomer[] }) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const paginated = useMemo(() => {
    const from = (page - 1) * limit;
    return unclaimed.slice(from, from + limit);
  }, [unclaimed, page, limit]);

  if (unclaimed.length === 0) {
    return (
      <Card className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-body font-semibold text-t1">No unclaimed walk-ins</p>
        <p className="text-caption text-t3 mt-1">New visitors will appear here until claimed.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2.5">
        {paginated.map((c) => {
          const visits = (c.visits ?? []).slice().sort(
            (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
          );
          const latest = visits[0];
          return (
            <Card
              key={c.id}
              className="flex items-center justify-between gap-3 p-3.5 sm:p-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-ui text-t1 truncate">
                    {c.name ?? "Unknown"}
                  </span>
                  {latest && (
                    <Pill tone={latest.match_band === "REPEAT" ? "pos" : latest.match_band === "UNCERTAIN" ? "warn" : "neutral"} dot={false}>
                      {latest.match_band}
                    </Pill>
                  )}
                </div>
                {c.primary_interest ? (
                  <p className="text-caption text-t2 mt-0.5 truncate">{c.primary_interest}</p>
                ) : c.phone ? (
                  <p className="text-caption font-mono text-t3 mt-0.5">{c.phone}</p>
                ) : null}
              </div>
              <ClaimButton customerId={c.id} />
            </Card>
          );
        })}
      </div>

      <div className="bg-sf rounded-card border border-ln p-4 shadow-sh">
        <Pagination
          page={page}
          limit={limit}
          total={unclaimed.length}
          onPageChange={setPage}
          onLimitChange={(newLimit) => {
            setLimit(newLimit);
            setPage(1);
          }}
        />
      </div>
    </div>
  );
}
