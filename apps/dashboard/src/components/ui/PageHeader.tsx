export default function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h1 className="text-title text-t1">{title}</h1>
      {subtitle && <p className="text-body text-t2 mt-1">{subtitle}</p>}
    </div>
  );
}
