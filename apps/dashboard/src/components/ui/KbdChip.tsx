export default function KbdChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10.5px] font-medium font-mono text-t3 bg-sf3 rounded-kbd px-[5px] py-[2px]">
      {children}
    </span>
  );
}
