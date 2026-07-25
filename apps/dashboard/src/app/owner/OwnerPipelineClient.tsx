"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { STAGE_LABELS } from "../dashboard/pipeline/stages";
import { StatCard, StatCardGrid } from "@/components/ui/Card";
import Pill from "@/components/ui/Pill";

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
    <div className="space-y-5">
      {/* Executive Metric Cards */}
      <StatCardGrid>
        <StatCard label="Total Active Pipeline" value={totalCount} />
        <StatCard label="In-Flight Deals" value={inFlightCount} />
        <StatCard label="Orders Confirmed" value={wonCount} />
        <StatCard label="Stale Deals (>7d)" value={staleCount} />
      </StatCardGrid>

      {/* Control Bar: Search, Stage Filter & View Mode Switcher */}
      <div className="bg-sf rounded-card p-3 border border-ln shadow-sh flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2">
          {/* Search Input */}
          <div className="relative flex-1 max-w-xs">
            <svg className="w-4 h-4 text-t3 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search customer, interest, phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-sf2 border border-ln rounded-md text-ui text-t1 placeholder-t3 focus:outline-none focus:border-acc transition-all"
            />
          </div>

          {/* Stage Filter */}
          <select
            value={selectedStage}
            onChange={(e) => setSelectedStage(e.target.value)}
            className="py-1.5 px-3 bg-sf2 border border-ln rounded-md text-ui text-t1 font-medium focus:outline-none focus:border-acc transition-all"
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
        <div className="flex items-center bg-sf2 border border-ln p-0.5 rounded-md shrink-0 self-end sm:self-auto">
          <button
            type="button"
            onClick={() => setView("board")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-caption font-semibold transition-all ${
              view === "board"
                ? "bg-sf text-t1 shadow-sh border border-ln"
                : "text-t3 hover:text-t1"
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
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-caption font-semibold transition-all ${
              view === "table"
                ? "bg-sf text-t1 shadow-sh border border-ln"
                : "text-t3 hover:text-t1"
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
                  className="w-72 sm:w-80 shrink-0 rounded-card border border-ln bg-sf2 shadow-sh flex flex-col transition-all"
                >
                  {/* Column Header */}
                  <div className="p-3 border-b border-ln flex items-center justify-between bg-sf rounded-t-card">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full ${theme.dot} shrink-0`} />
                      <span className="text-ui font-semibold text-t1 truncate">
                        {theme.label}
                      </span>
                    </div>
                    <Pill tone="neutral" dot={false}>
                      {stageCustomers.length}
                    </Pill>
                  </div>

                  {/* Cards Area */}
                  <div className="p-2.5 space-y-2.5 min-h-[160px] max-h-[calc(100vh-280px)] overflow-y-auto">
                    {stageCustomers.length === 0 ? (
                      <div className="h-24 border border-dashed border-ln rounded-card flex items-center justify-center text-caption text-t3">
                        No customers in stage
                      </div>
                    ) : (
                      stageCustomers.map((c) => {
                        const isStale = c.ageDays >= STALE_DAYS;

                        return (
                          <div
                            key={c.id}
                            className="bg-sf rounded-card border border-ln p-3.5 shadow-sh hover:border-accL transition-all group"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <Link
                                href={`/dashboard/customers/${c.id}`}
                                className="min-w-0 flex-1 group/link"
                              >
                                <h4 className="text-ui font-semibold text-t1 group-hover/link:text-acc transition-colors truncate">
                                  {c.name}
                                </h4>
                                {c.phone && (
                                  <p className="text-caption font-mono text-t3 truncate mt-0.5">
                                    {c.phone}
                                  </p>
                                )}
                              </Link>

                              {isStale && (
                                <Pill tone="warn" dot={true}>
                                  {c.ageDays}d
                                </Pill>
                              )}
                            </div>

                            {/* Details Tags */}
                            <div className="mt-3 pt-2 border-t border-ln2 flex flex-wrap items-center gap-1.5">
                              {c.primaryInterest && (
                                <span className="text-[10.5px] font-medium bg-sf2 border border-ln px-2 py-0.5 rounded-kbd text-t2 truncate max-w-[140px]">
                                  {c.primaryInterest}
                                </span>
                              )}

                              {c.budgetRange && (
                                <span className="text-[10.5px] font-mono bg-sf3 px-2 py-0.5 rounded-kbd text-t2">
                                  ₹{c.budgetRange}
                                </span>
                              )}
                            </div>

                            {/* Footer info: Salesperson & Time */}
                            <div className="mt-2 flex items-center justify-between text-caption text-t3">
                              <span className="truncate font-medium text-t2">
                                {c.assignedSalesperson ?? "Unassigned"}
                              </span>
                              <span className="font-mono text-t3 shrink-0">
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
        <div className="bg-sf rounded-card border border-ln shadow-sh overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-ui">
              <thead>
                <tr className="bg-sf2 border-b border-ln text-caption font-semibold text-t3 uppercase tracking-wider">
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Primary Interest</th>
                  <th className="py-3 px-4">Budget</th>
                  <th className="py-3 px-4">Assigned To</th>
                  <th className="py-3 px-4">Current Stage</th>
                  <th className="py-3 px-4 text-right">Age in Stage</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ln2">
                {filteredCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-t3 text-caption">
                      No matching pipeline customers found.
                    </td>
                  </tr>
                ) : (
                  filteredCustomers.map((c) => {
                    const theme = STAGE_THEMES[c.stage as Stage] ?? STAGE_THEMES.inquiry;
                    const isStale = c.ageDays >= STALE_DAYS;

                    return (
                      <tr key={c.id} className="hover:bg-sf2 transition-colors">
                        <td className="py-3 px-4 font-semibold text-t1">
                          <Link href={`/dashboard/customers/${c.id}`} className="hover:text-acc transition-colors">
                            {c.name}
                          </Link>
                          {c.phone && <p className="text-caption font-mono text-t3">{c.phone}</p>}
                        </td>

                        <td className="py-3 px-4">
                          {c.primaryInterest ? (
                            <span className="bg-sf2 border border-ln text-t2 px-2 py-0.5 rounded-kbd text-[11px] font-medium">
                              {c.primaryInterest}
                            </span>
                          ) : (
                            <span className="text-t3">—</span>
                          )}
                        </td>

                        <td className="py-3 px-4 font-mono text-t2">
                          {c.budgetRange ? `₹${c.budgetRange}` : <span className="text-t3">—</span>}
                        </td>

                        <td className="py-3 px-4 font-medium text-t2">
                          {c.assignedSalesperson ?? <span className="text-t3 italic">Unassigned</span>}
                        </td>

                        <td className="py-3 px-4">
                          <Pill tone="neutral" dot={true}>
                            {theme.label}
                          </Pill>
                        </td>

                        <td className="py-3 px-4 text-right font-mono text-caption">
                          {isStale ? (
                            <Pill tone="warn" dot={true}>
                              {c.ageDays}d Stale
                            </Pill>
                          ) : (
                            <span className="text-t2">{c.ageDays === 0 ? "Today" : `${c.ageDays}d`}</span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right">
                          <Link
                            href={`/dashboard/customers/${c.id}`}
                            className="text-caption font-semibold text-t1 hover:text-acc transition-colors"
                          >
                            View
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
