"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
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

const STAGE_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  inquiry: { label: "Inquiry", color: "bg-slate-100 text-slate-700 border-slate-200", dot: "bg-slate-400" },
  contacted: { label: "Contacted", color: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
  visit_scheduled: { label: "Visit Scheduled", color: "bg-indigo-50 text-indigo-700 border-indigo-200", dot: "bg-indigo-500" },
  walk_in: { label: "Walk-in", color: "bg-cyan-50 text-cyan-800 border-cyan-200", dot: "bg-cyan-500" },
  design_discussion: { label: "Design", color: "bg-violet-50 text-violet-700 border-violet-200", dot: "bg-violet-500" },
  quotation_sent: { label: "Quote Sent", color: "bg-amber-50 text-amber-800 border-amber-200", dot: "bg-amber-500" },
  negotiation: { label: "Negotiation", color: "bg-orange-50 text-orange-800 border-orange-200", dot: "bg-orange-500" },
  order_confirmed: { label: "Order Confirmed", color: "bg-emerald-50 text-emerald-800 border-emerald-200", dot: "bg-emerald-500" },
  lost: { label: "Lost", color: "bg-rose-50 text-rose-700 border-rose-200", dot: "bg-rose-500" },
};

export default function CustomerListClient({ initialCustomers }: { initialCustomers: MyCustomer[] }) {
  const [search, setSearch] = useState("");
  const [selectedStage, setSelectedStage] = useState<string>("all");

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

  return (
    <div className="space-y-5">
      {/* Control Bar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <svg className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search by customer name, interest, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
          />
        </div>

        <select
          value={selectedStage}
          onChange={(e) => setSelectedStage(e.target.value)}
          className="py-2 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
        >
          <option value="all">All Stages ({initialCustomers.length})</option>
          {Object.keys(STAGE_CONFIG).map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s] ?? s} ({initialCustomers.filter((c) => c.stage === s).length})
            </option>
          ))}
        </select>
      </div>

      {/* Customer List Grid */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center shadow-xs">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-3 text-slate-400">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          </div>
          <p className="text-sm font-bold text-slate-800">No matching customers found</p>
          <p className="text-xs text-slate-400 mt-1">Try adjusting your search criteria or stage filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filtered.map((c) => {
            const initials = c.name
              ? c.name
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()
              : "?";
            const cfg = STAGE_CONFIG[c.stage] ?? STAGE_CONFIG.inquiry;

            return (
              <Link
                key={c.id}
                href={`/dashboard/customers/${c.id}`}
                className="group bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm hover:shadow-md hover:border-blue-400 transition-all flex items-start justify-between gap-3"
              >
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-sm group-hover:scale-105 transition-transform">
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-extrabold text-slate-900 group-hover:text-blue-600 transition-colors truncate">
                      {c.name}
                    </h3>
                    {c.phone && (
                      <p className="text-xs text-slate-400 mt-0.5 font-medium">{c.phone}</p>
                    )}

                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {c.primaryInterest && (
                        <span className="text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-md">
                          {c.primaryInterest}
                        </span>
                      )}
                      {c.budgetRange && (
                        <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
                          ₹{c.budgetRange}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${cfg.color}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                    {cfg.label}
                  </span>

                  <span className="text-xs font-semibold text-blue-600 group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5 mt-2">
                    View
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
