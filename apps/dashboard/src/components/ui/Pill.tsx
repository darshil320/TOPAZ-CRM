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

export default function Pill({ tone, dot = true, children }: { tone: PillTone; dot?: boolean; children: React.ReactNode }) {
  return (
    <span className={`h-[29px] inline-flex items-center gap-1.5 pl-2 pr-2.5 rounded-pill ${TONE_CLASS[tone]}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${DOT_CLASS[tone]}`} />}
      <span className="text-[12px] font-560">{children}</span>
    </span>
  );
}
