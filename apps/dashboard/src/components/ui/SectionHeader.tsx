export default function SectionHeader({ label, total }: { label: string; total?: string | number }) {
  return (
    <div className="flex items-baseline mt-6">
      <span className="text-section text-t1">{label}</span>
      {total !== undefined && (
        <span className="ml-auto text-[12px] font-medium font-mono text-t2 tabular-nums">{total}</span>
      )}
    </div>
  );
}
