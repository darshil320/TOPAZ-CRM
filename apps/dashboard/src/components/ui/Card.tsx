import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-card border border-ln bg-sf p-[13px] px-[14px]", className)}>
      {children}
    </div>
  );
}

export function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <div className="text-label-sm uppercase text-t3 truncate">{label}</div>
      <div className="text-metric font-mono text-t1 mt-[9px] tabular-nums">{value}</div>
    </Card>
  );
}

export function StatCardGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 sm:grid-cols-4 gap-[11px] mt-5">{children}</div>;
}
