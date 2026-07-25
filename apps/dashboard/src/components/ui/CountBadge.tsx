export type BadgeTone = "accent" | "warn" | "plain";

export default function CountBadge({ count, tone = "plain" }: { count: number; tone?: BadgeTone }) {
  if (tone === "plain") {
    return <span className="text-[11px] font-medium font-mono text-t3 tabular-nums">{count}</span>;
  }
  const toneClass = tone === "accent" ? "text-acc bg-accS" : "text-warn bg-warnS";
  return (
    <span className={`text-[10.5px] font-semibold font-mono tabular-nums rounded-badge px-[5px] py-[2px] ${toneClass}`}>
      {count}
    </span>
  );
}
