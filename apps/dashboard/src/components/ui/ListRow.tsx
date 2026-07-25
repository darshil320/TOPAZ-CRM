import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TRAILING_TONE = {
  t1: "text-t1",
  pos: "text-pos",
  warn: "text-warn",
} as const;

export interface ListRowProps {
  primary: ReactNode;
  secondary?: ReactNode;
  trailing?: ReactNode;
  trailingTone?: keyof typeof TRAILING_TONE;
  href?: string;
}

export default function ListRow({ primary, secondary, trailing, trailingTone = "t1", href }: ListRowProps) {
  const content = (
    <div
      className={cn(
        "mt-2.5 flex items-center gap-3 rounded-card border border-ln bg-sf px-4 py-3.5 hover:border-accL",
        href && "cursor-pointer",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold font-mono text-t1">{primary}</div>
        {secondary && <div className="truncate text-caption text-t2 mt-[3px]">{secondary}</div>}
      </div>
      {trailing !== undefined && (
        <div className={cn("text-[14px] font-semibold font-mono tabular-nums shrink-0", TRAILING_TONE[trailingTone])}>
          {trailing}
        </div>
      )}
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}
