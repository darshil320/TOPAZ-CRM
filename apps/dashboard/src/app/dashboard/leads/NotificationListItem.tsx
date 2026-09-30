"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { formatDate } from "@/lib/format";
import { clearNotification, type LeadFollowUpNotification } from "./notifications";

type Props = {
  notification: LeadFollowUpNotification;
  onCleared: () => void;
};

/**
 * One row in the notification bell panel. Page-specific content, not a new
 * design-system primitive — modeled on AlertFeed.tsx's shape (link + relative
 * detail), minus its type-branching since every row here is the same kind.
 */
export default function NotificationListItem({ notification, onCleared }: Props) {
  async function handleClear(e: React.MouseEvent) {
    e.preventDefault(); // the row itself is inert; only the link and the X are clickable
    e.stopPropagation();
    const res = await clearNotification(notification.id);
    if (!res.error) onCleared();
  }

  return (
    <li className="flex items-start gap-2 px-2 py-2 rounded-sm hover:bg-sf2">
      <Link href={`/dashboard/leads/${notification.lead_id}`} className="flex-1 min-w-0">
        <p className="text-ui font-560 text-t1 truncate">
          {notification.lead_name || notification.lead_phone}
        </p>
        <p className="text-caption text-t3">
          Follow-up was due <span className="font-mono tabular-nums">{formatDate(notification.due_on)}</span>
        </p>
      </Link>
      <button
        type="button"
        onClick={handleClear}
        aria-label="Clear notification"
        className="shrink-0 w-6 h-6 flex items-center justify-center rounded-sm text-t3 hover:bg-sf3 hover:text-t1"
      >
        <X className="w-3.5 h-3.5" strokeWidth={2} />
      </button>
    </li>
  );
}
