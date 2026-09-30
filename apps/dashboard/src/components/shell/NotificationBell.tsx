"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import CountBadge from "@/components/ui/CountBadge";
import { Popover, PopoverPanel } from "@/components/ui/Popover";
import {
  clearAllNotifications,
  listNotifications,
  type LeadFollowUpNotification,
} from "@/app/dashboard/leads/notifications";
import NotificationListItem from "@/app/dashboard/leads/NotificationListItem";

type Props = {
  initialUnreadCount: number;
};

/**
 * Lead follow-up notifications: bell trigger + slide-out panel. Same
 * useState(false) + Popover/PopoverPanel pattern AccountMenu.tsx already uses
 * for this exact kind of trigger+panel in this file's sibling component —
 * owns its own trigger button rather than TopBar owning it externally, same
 * ownership shape AccountMenu already has.
 *
 * Replaces TopBar's previous inert bell (a plain dot indicator with no click
 * handler, sourced from the `alerts` table's unread count — see AppShell.tsx).
 */
export default function NotificationBell({ initialUnreadCount }: Props) {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [notifications, setNotifications] = useState<LeadFollowUpNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

  async function refresh() {
    const res = await listNotifications();
    if (res.error) {
      setError(res.error);
      return;
    }
    setError(null);
    setNotifications(res.notifications ?? []);
    setUnreadCount(res.unreadCount ?? 0);
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    // Always refetch on open — cheap indexed query, avoids any staleness
    // between this dashboard tab and a clear made elsewhere.
    if (next) refresh();
  }

  function handleItemCleared(id: string) {
    // Optimistic local-state removal: this component already holds the list
    // in memory, so a single-row clear doesn't need a round-trip refetch —
    // Clear All (below) is the one action that refetches wholesale.
    setNotifications((prev) => (prev ? prev.filter((n) => n.id !== id) : prev));
    setUnreadCount((prev) => Math.max(0, prev - 1));
  }

  async function handleClearAll() {
    setClearingAll(true);
    setError(null);
    const res = await clearAllNotifications();
    setClearingAll(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    await refresh();
  }

  return (
    <Popover open={open} onClose={() => setOpen(false)} className="relative">
      <IconButton title="Notifications" className="relative" onClick={toggle}>
        <Bell className="w-4 h-4" strokeWidth={1.7} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1">
            <CountBadge count={unreadCount} tone="warn" />
          </span>
        )}
      </IconButton>

      {open && (
        // right-0 with a fixed 340px width overflowed off the LEFT edge on
        // narrow screens — TopBar's header sits right up against the bell, so
        // there's no room to its left for a fixed width. Stays `absolute`
        // (not `fixed`: the header has backdrop-blur, which creates a new
        // containing block for fixed descendants in every major browser, so a
        // viewport-anchored fixed panel would actually still be positioned
        // relative to the header, not the screen). Instead the width itself
        // is clamped to the viewport via calc(100vw - ...): right-0 keeps the
        // panel's right edge at the bell regardless of screen size, and the
        // clamped width stops the left edge running off-screen.
        <PopoverPanel
          className="absolute right-0 top-9 w-[min(340px,calc(100vw-2rem))] max-h-[420px] flex flex-col"
        >
          <div className="flex items-center justify-between px-2.5 pt-1.5 pb-2.5 border-b border-ln2 mb-1">
            <span className="text-ui font-semibold text-t1">
              Notifications{unreadCount > 0 ? ` (${unreadCount})` : ""}
            </span>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={unreadCount === 0 || clearingAll}
              className="text-caption font-medium text-t3 hover:text-t1 disabled:opacity-50 disabled:pointer-events-none"
            >
              {clearingAll ? "Clearing…" : "Clear All"}
            </button>
          </div>

          <div className="overflow-y-auto flex-1">
            {error ? (
              <p className="px-2.5 py-3 text-caption text-neg">{error}</p>
            ) : notifications === null ? (
              <p className="px-2.5 py-3 text-caption text-t3">Loading…</p>
            ) : notifications.length === 0 ? (
              <p className="px-2.5 py-3 text-caption text-t3">No notifications.</p>
            ) : (
              <ul className="space-y-0.5">
                {notifications.map((n) => (
                  <NotificationListItem
                    key={n.id}
                    notification={n}
                    onCleared={() => handleItemCleared(n.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </PopoverPanel>
      )}
    </Popover>
  );
}
