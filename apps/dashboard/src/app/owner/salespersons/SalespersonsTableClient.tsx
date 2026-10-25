"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import Pill from "@/components/ui/Pill";
import Pagination from "@/components/ui/Pagination";
import ActiveToggle from "./ActiveToggle";
import { isOwnerLevel } from "@/lib/roles";

export interface SalespersonRow {
  id: string;
  name: string;
  whatsapp: string;
  role: string;
  active: boolean;
  auth_uid: string | null;
  created_at: string;
}

interface Props {
  salespersons: SalespersonRow[];
  /** Owner-level: may activate/deactivate. An admin sees the list read-only (0052). */
  canManage: boolean;
  /** Only a super admin may change a super admin row (0052 trigger). */
  isSuperAdmin: boolean;
}

export default function SalespersonsTableClient({ salespersons, canManage, isSuperAdmin }: Props) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const paginated = useMemo(() => {
    const from = (page - 1) * limit;
    return salespersons.slice(from, from + limit);
  }, [salespersons, page, limit]);

  return (
    <Card className="p-0 overflow-hidden space-y-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-ui whitespace-nowrap">
          <thead>
            <tr className="text-left text-caption font-semibold text-t3 uppercase tracking-wider border-b border-ln bg-sf2">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">WhatsApp</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Linked</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ln2">
            {paginated.map((s) => (
              <tr key={s.id} className="hover:bg-sf2 transition-colors">
                <td className="px-4 py-3 font-semibold text-t1">{s.name}</td>
                <td className="px-4 py-3 text-t2 font-mono">{s.whatsapp}</td>
                <td className="px-4 py-3">
                  <Pill tone={isOwnerLevel(s.role) ? "warn" : "neutral"} dot={false}>
                    {s.role}
                  </Pill>
                </td>
                <td className="px-4 py-3">
                  {s.auth_uid ? (
                    <span className="text-caption text-pos font-medium">Yes</span>
                  ) : (
                    <span className="text-caption text-t3">Awaiting first login</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {canManage && (s.role !== "super_admin" || isSuperAdmin) ? (
                    <ActiveToggle salespersonId={s.id} initialActive={s.active} />
                  ) : (
                    <Pill tone={s.active ? "pos" : "neutral"} dot={false}>
                      {s.active ? "Active" : "Deactivated"}
                    </Pill>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="p-4 border-t border-ln bg-sf">
        <Pagination
          page={page}
          limit={limit}
          total={salespersons.length}
          onPageChange={setPage}
          onLimitChange={(newLimit) => {
            setLimit(newLimit);
            setPage(1);
          }}
        />
      </div>
    </Card>
  );
}
