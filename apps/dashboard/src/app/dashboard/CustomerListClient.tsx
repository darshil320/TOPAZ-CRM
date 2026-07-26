"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import Pill, { type PillTone } from "@/components/ui/Pill";
import { STAGE_LABELS } from "./pipeline/stages";

export interface MyCustomer {
  id: string;
  name: string;
  phone: string | null;
  primaryInterest: string | null;
  budgetRange: string | null;
  stage: string;
  createdAt: string;
}

function pillToneForStage(stage: string): PillTone {
  if (stage === "order_confirmed") return "pos";
  if (stage === "lost") return "warn";
  return "neutral";
}

import Pagination from "@/components/ui/Pagination";

export default function CustomerListClient({ initialCustomers }: { initialCustomers: MyCustomer[] }) {
  const [search, setSearch] = useState("");
  const [selectedStage, setSelectedStage] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const filtered = useMemo(() => {
    return initialCustomers.filter((c) => {
      const matchSearch =
        search.trim() === "" ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.phone && c.phone.includes(search)) ||
        (c.primaryInterest && c.primaryInterest.toLowerCase().includes(search.toLowerCase()));

      const matchStage = selectedStage === "all" || c.stage === selectedStage;

      return matchSearch && matchStage;
    });
  }, [initialCustomers, search, selectedStage]);

  const paginated = useMemo(() => {
    const from = (page - 1) * limit;
    return filtered.slice(from, from + limit);
  }, [filtered, page, limit]);

  return (
    <div className="space-y-4">
      {/* Control Bar */}
      <div className="bg-sf rounded-card p-3 border border-ln shadow-sh flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-t3 absolute left-3 top-1/2 -translate-y-1/2" strokeWidth={1.8} />
          <input
            type="text"
            placeholder="Search by customer name, interest, phone..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-3 py-1.5 bg-sf2 border border-ln rounded-md text-ui text-t1 placeholder-t3 focus:outline-none focus:border-acc focus:bg-sf transition-all"
          />
        </div>

        <select
          value={selectedStage}
          onChange={(e) => {
            setSelectedStage(e.target.value);
            setPage(1);
          }}
          className="py-1.5 px-3 bg-sf2 border border-ln rounded-md text-ui text-t1 font-medium focus:outline-none focus:border-acc transition-all"
        >
          <option value="all">All Stages ({initialCustomers.length})</option>
          {Object.keys(STAGE_LABELS).map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s] ?? s} ({initialCustomers.filter((c) => c.stage === s).length})
            </option>
          ))}
        </select>
      </div>

      {/* Customer List Grid */}
      {filtered.length === 0 ? (
        <div className="bg-sf rounded-card border border-ln p-12 text-center shadow-sh">
          <p className="text-body font-semibold text-t1">No matching customers found</p>
          <p className="text-caption text-t3 mt-1">Try adjusting your search criteria or stage filter.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {paginated.map((c) => (
              <Link
                key={c.id}
                href={`/dashboard/customers/${c.id}`}
                className="bg-sf rounded-card border border-ln p-4 shadow-sh hover:border-accL transition-all flex items-start justify-between gap-3 group"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-nav font-semibold text-t1 truncate">{c.name}</span>
                    <Pill tone={pillToneForStage(c.stage)}>
                      {STAGE_LABELS[c.stage] ?? c.stage}
                    </Pill>
                  </div>
                  {c.phone && <p className="text-caption text-t3 font-mono mt-0.5">{c.phone}</p>}

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {c.primaryInterest && (
                      <span className="text-[10.5px] font-medium bg-sf2 border border-ln px-2 py-0.5 rounded-kbd text-t2">
                        {c.primaryInterest}
                      </span>
                    )}
                    {c.budgetRange && (
                      <span className="text-[10.5px] font-mono bg-sf3 px-2 py-0.5 rounded-kbd text-t2">
                        ₹{c.budgetRange}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>

          <div className="bg-sf rounded-card border border-ln p-4 shadow-sh">
            <Pagination
              page={page}
              limit={limit}
              total={filtered.length}
              onPageChange={setPage}
              onLimitChange={(newLimit) => {
                setLimit(newLimit);
                setPage(1);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
