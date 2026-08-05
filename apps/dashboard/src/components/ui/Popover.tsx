"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Wraps a trigger + panel pair; closes on outside click or Escape while open. */
export function Popover({
  open,
  onClose,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  return (
    <div ref={ref} className={cn("relative", className)}>
      {children}
    </div>
  );
}

export function PopoverPanel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("bg-sf rounded-pop shadow-shp p-[5px] animate-popIn z-50 origin-top", className)}>
      {children}
    </div>
  );
}
