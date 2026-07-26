"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Button from "./Button";

interface PaginationProps {
  /** Current 1-based page number */
  page: number;
  /** Number of items per page */
  limit: number;
  /** Total count of items matching the query */
  total: number;
  /** Optional custom page size options (defaults to [10, 25, 50, 100]) */
  pageSizeOptions?: number[];
  /** Optional custom URL parameter name for page (defaults to "page") */
  pageParam?: string;
  /** Optional custom URL parameter name for limit (defaults to "limit") */
  limitParam?: string;
  /** Optional client-side callback if not relying strictly on URL searchParams */
  onPageChange?: (newPage: number) => void;
  /** Optional client-side callback for limit changes */
  onLimitChange?: (newLimit: number) => void;
}

export default function Pagination({
  page,
  limit,
  total,
  pageSizeOptions = [10, 25, 50, 100],
  pageParam = "page",
  limitParam = "limit",
  onPageChange,
  onLimitChange,
}: PaginationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  const startItem = total === 0 ? 0 : (currentPage - 1) * limit + 1;
  const endItem = Math.min(currentPage * limit, total);

  function updateQueryParams(newPage: number, newLimit: number) {
    if (onPageChange && page !== newPage) {
      onPageChange(newPage);
    }
    if (onLimitChange && limit !== newLimit) {
      onLimitChange(newLimit);
    }

    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set(pageParam, String(newPage));
    params.set(limitParam, String(newLimit));

    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function handlePageChange(newPage: number) {
    if (newPage < 1 || newPage > totalPages || newPage === currentPage) return;
    updateQueryParams(newPage, limit);
  }

  function handleLimitChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newLimit = Number(e.target.value);
    updateQueryParams(1, newLimit); // reset to page 1 on page size change
  }

  if (total === 0) return null;

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-ln text-ui">
      {/* Items Summary & Page Size Selector */}
      <div className="flex items-center gap-3 text-t3 text-caption font-medium">
        <span>
          Showing <strong className="text-t1 font-semibold">{startItem}–{endItem}</strong> of{" "}
          <strong className="text-t1 font-semibold">{total}</strong>
        </span>

        <div className="flex items-center gap-1.5 ml-2 border-l border-ln pl-3">
          <label htmlFor="page-size-select" className="sr-only">Items per page</label>
          <select
            id="page-size-select"
            value={limit}
            onChange={handleLimitChange}
            className="py-1 px-2 bg-sf2 border border-ln rounded-md text-caption text-t1 font-semibold focus:outline-none focus:border-acc transition-colors cursor-pointer"
          >
            {pageSizeOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt} / page
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Page Navigation Controls */}
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          disabled={currentPage <= 1}
          onClick={() => handlePageChange(currentPage - 1)}
          className="px-2.5 py-1 text-caption"
        >
          ← Prev
        </Button>

        <span className="text-caption font-mono text-t2 px-1">
          <strong className="text-t1 font-semibold">{currentPage}</strong> / {totalPages}
        </span>

        <Button
          variant="secondary"
          disabled={currentPage >= totalPages}
          onClick={() => handlePageChange(currentPage + 1)}
          className="px-2.5 py-1 text-caption"
        >
          Next →
        </Button>
      </div>
    </div>
  );
}
