"use client";

import { useMemo, useState } from "react";
import ListRow from "@/components/ui/ListRow";
import Pagination from "@/components/ui/Pagination";
import { formatINR } from "@/lib/format";

export interface OpenOrder {
  id: string;
  order_no: string;
  name: string;
  due: number;
  age: number;
}

export default function OpenBalancesListClient({ openOrders }: { openOrders: OpenOrder[] }) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const paginated = useMemo(() => {
    const from = (page - 1) * limit;
    return openOrders.slice(from, from + limit);
  }, [openOrders, page, limit]);

  if (openOrders.length === 0) {
    return (
      <p className="mt-6 text-center text-body text-t2">
        All orders are fully paid — there are no outstanding balances at this time.
      </p>
    );
  }

  return (
    <div className="space-y-3 mt-3">
      <div className="space-y-2">
        {paginated.map((o) => (
          <ListRow
            key={o.id}
            href={`/dashboard/orders/${o.id}`}
            primary={o.order_no}
            secondary={`${o.name} · ${o.age}d old`}
            trailing={formatINR(o.due)}
            trailingTone="warn"
          />
        ))}
      </div>

      <div className="bg-sf rounded-card border border-ln p-4 shadow-sh">
        <Pagination
          page={page}
          limit={limit}
          total={openOrders.length}
          onPageChange={setPage}
          onLimitChange={(newLimit) => {
            setLimit(newLimit);
            setPage(1);
          }}
        />
      </div>
    </div>
  );
}
