export type PillTone = "pos" | "warn" | "neutral";

const TONE_CLASS: Record<PillTone, string> = {
  pos: "bg-posS text-pos",
  warn: "bg-warnS text-warn",
  neutral: "bg-sf2 text-t2",
};

const DOT_CLASS: Record<PillTone, string> = {
  pos: "bg-pos",
  warn: "bg-warn",
  neutral: "bg-t3",
};

/**
 * A status chip. Single line, always.
 *
 * `whitespace-nowrap` + `shrink-0` are load-bearing, not defensive: the height is a
 * fixed 29px, so a label allowed to wrap renders TWO lines of text inside a one-line
 * rounded background and spills out of it — which is what "Own floor" did in the
 * workshops table, where the Type column is narrow. A chip that cannot fit its column
 * must make the column wider (its table scrolls) rather than break its own shape.
 *
 * `min-h` rather than `h` for the same reason from the other direction: if a caller
 * ever passes something genuinely taller than one line, the pill grows instead of
 * clipping it.
 */
export default function Pill({ tone, dot = true, children }: { tone: PillTone; dot?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`min-h-[29px] shrink-0 inline-flex items-center gap-1.5 pl-2 pr-2.5 rounded-pill whitespace-nowrap ${TONE_CLASS[tone]}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT_CLASS[tone]}`} />}
      <span className="text-[12px] font-560">{children}</span>
    </span>
  );
}
