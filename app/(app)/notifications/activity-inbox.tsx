"use client"

import { useMemo, useState } from "react"
import { Bell, CheckCheck } from "lucide-react"

import { ActivityList } from "@/components/notifications/activity-list"
import {
  ACTIVITY_FILTERS,
  matchesFilter,
  type ActivityFilter,
  type ActivityItem,
} from "@/lib/notifications/activity"
import { cn } from "@/lib/utils"

import { markAllNotificationsRead, markNotificationRead } from "../notification-actions"

/**
 * THE ACTIVITY INBOX -- the full-page half of the pair.
 *
 * Same source, same rows, same destinations, same renderer as the bell panel.
 * The only differences are the ones a bigger surface earns: chronological
 * group headings, and four broad filters.
 *
 * FOUR FILTERS, NOT TWELVE TABS. Sixty-nine notification types exist; a tab
 * per type would be a menu of the implementation. These four are the questions
 * a person actually arrives with -- what happened with the games, with
 * training, with the club -- and they map cleanly onto the registry's own
 * families, which is the only reason they are here at all.
 */
export function ActivityInbox({ initialItems }: { initialItems: ActivityItem[] }) {
  const [items, setItems] = useState(initialItems)
  const [filter, setFilter] = useState<ActivityFilter>("all")

  const visible = useMemo(() => items.filter((item) => matchesFilter(item, filter)), [items, filter])
  const unreadCount = items.filter((i) => !i.readAt).length

  function handleOpen(id: string) {
    if (items.find((n) => n.id === id)?.readAt) return
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)))
    void markNotificationRead(id)
  }

  function handleMarkAllRead() {
    setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })))
    void markAllNotificationsRead()
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col">
      <header className="shrink-0 px-4 pt-6 pb-3 sm:px-6 md:pt-10">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-display-l text-ink">Activity</h1>
            <p className="mt-1.5 text-sm text-ink-muted">
              {unreadCount > 0
                ? `${unreadCount} unread. Everything Ovalball has told you, newest first.`
                : "Everything Ovalball has told you, newest first."}
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-3 text-sm font-medium text-ink outline-none transition-colors hover:border-ink/30 focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              <CheckCheck className="size-4 text-ink-muted" aria-hidden="true" />
              Mark All Read
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Filter activity">
          {ACTIVITY_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              aria-pressed={filter === f.value}
              className={cn(
                // h-11 where a thumb is doing the pressing, h-9 where a pointer is.
                "h-11 rounded-full px-3.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 sm:h-9",
                filter === f.value
                  ? "bg-forest-950 text-white"
                  : "border border-ink/15 bg-white text-ink/70 hover:border-ink/30 hover:text-ink"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
        {visible.length === 0 ? (
          <Empty filtered={filter !== "all"} everythingRead={items.length > 0} />
        ) : (
          <div className="overflow-hidden border-y border-ink/10 sm:mx-6 sm:rounded-xl sm:border">
            <ActivityList items={visible} onOpen={handleOpen} />
          </div>
        )}
      </div>
    </div>
  )
}

function Empty({ filtered, everythingRead }: { filtered: boolean; everythingRead: boolean }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-white ring-1 ring-ink/10">
        <Bell className="size-5 text-forest-800" aria-hidden="true" />
      </span>
      <p className="mt-4 text-sm font-medium text-ink">
        {filtered ? "Nothing here" : everythingRead ? "You're all caught up" : "No activity yet"}
      </p>
      <p className="mt-1.5 max-w-[36ch] text-sm text-ink-muted">
        {filtered
          ? "Try another filter — there may be activity in a different part of the club."
          : "Fixture changes, training updates, requests and club decisions all arrive here."}
      </p>
    </div>
  )
}
