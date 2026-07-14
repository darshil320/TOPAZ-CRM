/**
 * Topaz brand mark shown in the header on mobile only. On desktop the Sidebar
 * already carries the logo; on mobile the Sidebar is hidden, so without this
 * the header would be brandless.
 */
export default function MobileBrand() {
  return (
    <div className="flex sm:hidden items-center gap-2">
      <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      </div>
      <span className="font-semibold text-slate-900 text-sm tracking-tight">Topaz CRM</span>
    </div>
  );
}
