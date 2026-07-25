"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { STAGE_LABELS } from "../dashboard/pipeline/stages";

export interface OwnerCustomer {
  id: string;
  name: string;
  phone: string | null;
  budgetRange: string | null;
  primaryInterest: string | null;
  stage: string;
  updatedAt: string;
  ageDays: number;
  assignedSalesperson: string | null;
}

interface Props {
  initialCustomers: OwnerCustomer[];
}

const STAGES = [
  "inquiry",
  "contacted",
  "visit_scheduled",
  "walk_in",
  "design_discussion",
  "quotation_sent",
  "negotiation",
  "order_confirmed",
  "lost",
] as const;

type Stage = (typeof STAGES)[number];

const STAGE_THEMES: Record<
  Stage,
  {
    label: string;
    dot: string;
    badgeBg: string;
    badgeText: string;
    borderTop: string;
    colBg: string;
  }
> = {
  inquiry: {
    label: "Inquiry",
    dot: "bg-slate-400",
    badgeBg: "bg-slate-100",
    badgeText: "text-slate-700",
    borderTop: "border-t-slate-400",
    colBg: "bg-slate-50/80 border-slate-200/80",
  },
  contacted: {
    label: "Contacted",
    dot: "bg-blue-500",
    badgeBg: "bg-blue-100",
    badgeText: "text-blue-700",
    borderTop: "border-t-blue-500",
    colBg: "bg-blue-50/40 border-blue-200/60",
  },
  visit_scheduled: {
    label: "Visit Scheduled",
    dot: "bg-indigo-500",
    badgeBg: "bg-indigo-100",
    badgeText: "text-indigo-700",
    borderTop: "border-t-indigo-500",
    colBg: "bg-indigo-50/40 border-indigo-200/60",
  },
  walk_in: {
    label: "Walk-in",
    dot: "bg-cyan-500",
    badgeBg: "bg-cyan-100",
    badgeText: "text-cyan-800",
    borderTop: "border-t-cyan-500",
    colBg: "bg-cyan-50/40 border-cyan-200/60",
  },
  design_discussion: {
    label: "Design",
    dot: "bg-violet-500",
    badgeBg: "bg-violet-100",
    badgeText: "text-violet-700",
    borderTop: "border-t-violet-500",
    colBg: "bg-violet-50/40 border-violet-200/60",
  },
  quotation_sent: {
    label: "Quote Sent",
    dot: "bg-amber-500",
    badgeBg: "bg-amber-100",
    badgeText: "text-amber-800",
    borderTop: "border-t-amber-500",
    colBg: "bg-amber-50/40 border-amber-200/60",
  },
  negotiation: {
    label: "Negotiation",
    dot: "bg-orange-500",
    badgeBg: "bg-orange-100",
    badgeText: "text-orange-800",
    borderTop: "border-t-orange-500",
    colBg: "bg-orange-50/40 border-orange-200/60",
  },
  order_confirmed: {
    label: "Order Confirmed",
    dot: "bg-emerald-500",
    badgeBg: "bg-emerald-100",
    badgeText: "text-emerald-800",
    borderTop: "border-t-emerald-500",
    colBg: "bg-emerald-50/40 border-emerald-200/60",
  },
  lost: {
    label: "Lost",
    dot: "bg-rose-400",
    badgeBg: "bg-rose-100",
    badgeText: "text-rose-700",
    borderTop: "border-t-rose-400",
    colBg: "bg-rose-50/40 border-rose-200/60",
  },
};

const STALE_DAYS = 7;

export default function OwnerPipelineClient({ initialCustomers }: Props) {
  const [view, setView] = useState<"board" | "table">("board");
  const [search, setSearch] = useState("");
  const [selectedStage, setSelectedStage] = useState<string>("all");

  const filteredCustomers = useMemo(() => {
    return initialCustomers.filter((c) => {
      const matchSearch =
        search.trim() === "" ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.phone && c.phone.includes(search)) ||
        (c.primaryInterest && c.primaryInterest.toLowerCase().includes(search.toLowerCase())) ||
        (c.assignedSalesperson && c.assignedSalesperson.toLowerCase().includes(search.toLowerCase()));

      const matchStage = selectedStage === "all" || c.stage === selectedStage;

      return matchSearch && matchStage;
    });
  }, [initialCustomers, search, selectedStage]);

  // Metrics
  const totalCount = initialCustomers.length;
  const inFlightCount = initialCustomers.filter(
    (c) => c.stage === "quotation_sent" || c.stage === "negotiation"
  ).length;
  const wonCount = initialCustomers.filter((c) => c.stage === "order_confirmed").length;
  const staleCount = initialCustomers.filter((c) => c.ageDays >= STALE_DAYS).length;

  const byStage = useMemo(() => {
    const acc = STAGES.reduce(
      (map, s) => {
        map[s] = [];
        return map;
      },
      {} as Record<Stage, OwnerCustomer[]>
    );

    for (const c of filteredCustomers) {
      if (acc[c.stage as Stage]) {
        acc[c.stage as Stage].push(c);
      }
    }
    return acc;
  }, [filteredCustomers]);

  return (
    <div className="space-y-6">
      {/* Executive Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Active Pipeline</p>
            <p className="text-2xl font-extrabold text-slate-900 mt-1">{totalCount}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Customers tracked</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">In-Flight Deals</p>
            <p className="text-2xl font-extrabold text-amber-600 mt-1">{inFlightCount}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Quotes & Negotiations</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Orders Confirmed</p>
            <p className="text-2xl font-extrabold text-emerald-600 mt-1">{wonCount}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Closed deals</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Stale Deals</p>
            <p className="text-2xl font-extrabold text-rose-600 mt-1">{staleCount}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">&gt; 7 days in current stage</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Control Bar: Search, Stage Filter & View Mode Switcher */}
      <div className="bg-white rounded-2xl p-3 sm:p-4 border border-slate-200/80 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2">
          {/* Search Input */}
          <div className="relative flex-1 max-w-xs">
            <svg className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search customer, interest, phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            />
          </div>

          {/* Stage Filter */}
          <select
            value={selectedStage}
            onChange={(e) => setSelectedStage(e.target.value)}
            className="py-1.5 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
          >
            <option value="all">All Stages ({totalCount})</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]} ({initialCustomers.filter((c) => c.stage === s).length})
              </option>
            ))}
          </select>
        </div>

        {/* View Toggle */}
        <div className="flex items-center bg-slate-100 p-1 rounded-xl shrink-0 self-end sm:self-auto">
          <button
            type="button"
            onClick={() => setView("board")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
              view === "board"
                ? "bg-white text-blue-600 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v12a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z" />
            </svg>
            Kanban Board
          </button>
          <button
            type="button"
            onClick={() => setView("table")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
              view === "table"
                ? "bg-white text-blue-600 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
            Executive Table
          </button>
        </div>
      </div>

      {/* ── View 1: KANBAN BOARD VIEW ── */}
      {view === "board" && (
        <div className="-mx-4 sm:-mx-6 px-4 sm:px-6">
          <div className="flex gap-4 overflow-x-auto pb-6 pt-1 items-start scrollbar-thin">
            {STAGES.map((stage) => {
              const theme = STAGE_THEMES[stage];
              const stageCustomers = byStage[stage] ?? [];

              return (
                <div
                  key={stage}
                  className={`w-72 sm:w-80 shrink-0 rounded-2xl border ${theme.colBg} border-t-4 ${theme.borderTop} shadow-sm flex flex-col transition-all`}
                >
                  {/* Column Header */}
                  <div className="p-3.5 border-b border-slate-200/60 flex items-center justify-between bg-white/70 backdrop-blur-sm rounded-t-xl">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2.5 h-2.5 rounded-full ${theme.dot} shrink-0`} />
                      <span className="text-xs font-bold text-slate-800 truncate">
                        {theme.label}
                      </span>
                    </div>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${theme.badgeBg} ${theme.badgeText} shrink-0`}>
                      {stageCustomers.length}
                    </span>
                  </div>

                  {/* Cards Area */}
                  <div className="p-2.5 space-y-2.5 min-h-[160px] max-h-[calc(100vh-280px)] overflow-y-auto">
                    {stageCustomers.length === 0 ? (
                      <div className="h-24 border-2 border-dashed border-slate-200/80 rounded-xl flex items-center justify-center text-xs text-slate-400 font-medium">
                        No customers in stage
                      </div>
                    ) : (
                      stageCustomers.map((c) => {
                        const initials = c.name
                          ? c.name
                              .split(" ")
                              .map((n) => n[0])
                              .slice(0, 2)
                              .join("")
                              .toUpperCase()
                          : "?";

                        const isStale = c.ageDays >= STALE_DAYS;

                        return (
                          <div
                            key={c.id}
                            className="bg-white rounded-xl border border-slate-200/90 p-3.5 shadow-sm hover:shadow-md hover:border-blue-300 transition-all group"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <Link
                                href={`/dashboard/customers/${c.id}`}
                                className="flex items-center gap-2.5 min-w-0 group/link"
                              >
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 text-white flex items-center justify-center shrink-0 text-xs font-bold shadow-sm">
                                  {initials}
                                </div>
                                <div className="min-w-0">
                                  <h4 className="text-xs font-bold text-slate-900 group-hover/link:text-blue-600 transition-colors truncate">
                                    {c.name}
                                  </h4>
                                  {c.phone && (
                                    <p className="text-[11px] text-slate-400 truncate mt-0.5">
                                      {c.phone}
                                    </p>
                                  )}
                                </div>
                              </Link>

                              {isStale && (
                                <span className="text-[10px] font-bold text-rose-600 bg-rose-50 border border-rose-200/80 px-1.5 py-0.5 rounded-md shrink-0 flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                                  {c.ageDays}d
                                </span>
                              )}
                            </div>

                            {/* Details Tags */}
                            <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
                              {c.primaryInterest && (
                                <span className="text-[10px] font-semibold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md truncate max-w-[140px]">
                                  {c.primaryInterest}
                                </span>
                              )}

                              {c.budgetRange && (
                                <span className="text-[10px] font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
                                  ₹{c.budgetRange}
                                </span>
                              )}
                            </div>

                            {/* Footer info: Salesperson & Time */}
                            <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-400">
                              <span className="flex items-center gap-1 truncate max-w-[150px]">
                                <svg className="w-3 h-3 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                </svg>
                                <span className="truncate font-medium text-slate-600">
                                  {c.assignedSalesperson ?? "Unassigned"}
                                </span>
                              </span>

                              <span className="text-[10px] text-slate-400 font-medium shrink-0">
                                {c.ageDays === 0 ? "Today" : `${c.ageDays}d ago`}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── View 2: EXECUTIVE TABLE VIEW ── */}
      {view === "table" && (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Primary Interest</th>
                  <th className="py-3 px-4">Budget</th>
                  <th className="py-3 px-4">Assigned To</th>
                  <th className="py-3 px-4">Current Stage</th>
                  <th className="py-3 px-4 text-right">Age in Stage</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400 text-sm font-medium">
                      No matching pipeline customers found.
                    </td>
                  </tr>
                ) : (
                  filteredCustomers.map((c) => {
                    const theme = STAGE_THEMES[c.stage as Stage] ?? STAGE_THEMES.inquiry;
                    const isStale = c.ageDays >= STALE_DAYS;

                    return (
                      <tr key={c.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          <Link href={`/dashboard/customers/${c.id}`} className="hover:text-blue-600 transition-colors">
                            {c.name}
                          </Link>
                          {c.phone && <p className="text-[11px] font-normal text-slate-400">{c.phone}</p>}
                        </td>

                        <td className="py-3 px-4">
                          {c.primaryInterest ? (
                            <span className="inline-block bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md text-[11px] font-medium">
                              {c.primaryInterest}
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>

                        <td className="py-3 px-4 font-medium text-slate-600">
                          {c.budgetRange ? `₹${c.budgetRange}` : <span className="text-slate-300">—</span>}
                        </td>

                        <td className="py-3 px-4 font-medium text-slate-700">
                          {c.assignedSalesperson ?? <span className="text-slate-400 italic">Unassigned</span>}
                        </td>

                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${theme.badgeBg} ${theme.badgeText}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${theme.dot}`} />
                            {theme.label}
                          </span>
                        </td>

                        <td className="py-3 px-4 text-right font-medium">
                          {isStale ? (
                            <span className="inline-flex items-center gap-1 text-rose-600 font-bold bg-rose-50 px-2 py-0.5 rounded-md text-[11px]">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                              {c.ageDays}d (Stale)
                            </span>
                          ) : (
                            <span className="text-slate-600">{c.ageDays === 0 ? "Today" : `${c.ageDays}d`}</span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right">
                          <Link
                            href={`/dashboard/customers/${c.id}`}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors"
                          >
                            View
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
