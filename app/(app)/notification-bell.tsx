"use client"

import { useState } from "react"
import Link from "next/link"
import { Bell } from "lucide-react"

import { ActivityList } from "@/components/notifications/activity-list"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { badgeCount, unreadLabel } from "@/lib/messenger/view-model"
import { activityContext, type ActivityItem } from "@/lib/notifications/activity"
import { cn } from "@/lib/utils"

import { markAllNotificationsRead, markNotificationRead } from "./notification-actions"
import type { NotificationItem } from "@/lib/app-context/notifications"

/**
 * THE COMPACT ACTIVITY PANEL.
 *
 * Recent and actionable. The full history lives at /notifications, and both
 * render the SAME rows through the SAME component from the SAME source -- the
 * bell is a short window onto the page, not a second implementation of it.
 *
 * OPENING THE PANEL DOES NOT MARK ANYTHING READ. Looking at a list is not the
 * same as dealing with what is in it; a bell that empties itself the moment
 * you glance at it is a bell that loses things. Reading happens when a row is
 * opened, or when somebody says so.
 *
 * Desktop gets an anchored popover, mobile a real bottom sheet -- the same
 * pairing the compact Messenger uses, so the two header controls behave
 * identically.
 */

function toActivity(items: NotificationItem[]): ActivityItem[] {
  return items.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    href: n.href,
    createdAt: n.createdAt,
    readAt: n.readAt,
    context: activityContext(n.type),
  }))
}

function TriggerButton({
  unreadCount,
  variant,
  onClick,
}: {
  unreadCount: number
  variant: "dark" | "light"
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={unreadCount > 0 ? `Notifications, ${unreadLabel(unreadCount, "unread notification")}` : "Notifications"}
      className={cn(
        // size-11, not size-10: this is a primary control on a phone, and 40px
        // is below the 44px a thumb reliably hits.
        "relative flex size-11 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
        variant === "dark" ? "text-white/70 hover:bg-white/10 hover:text-white" : "text-ink/60 hover:bg-ink/5 hover:text-ink"
      )}
    >
      <Bell className="size-5" aria-hidden="true" />
      {unreadCount > 0 && (
        <span
          className={cn(
            "absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-pitch-600 px-1 text-[10px] font-semibold tabular-nums text-white",
            variant === "dark" ? "ring-2 ring-forest-950" : "ring-2 ring-white"
          )}
          aria-hidden="true"
        >
          {badgeCount(unreadCount)}
        </span>
      )}
    </button>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <Bell className="size-5 text-ink-subtle" aria-hidden="true" />
      <p className="text-sm font-medium text-ink">You&rsquo;re all caught up</p>
      <p className="max-w-[26ch] text-xs text-ink-muted">
        Fixture changes, training updates and club decisions land here.
      </p>
    </div>
  )
}

export function NotificationBell({
  initialItems,
  initialUnreadCount,
  variant = "dark",
}: {
  initialItems: NotificationItem[]
  /** From public.my_unread_counts -- the bell's own slice, never the total. */
  initialUnreadCount: number
  variant?: "dark" | "light"
}) {
  const [items, setItems] = useState(initialItems)
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount)
  const [sheetOpen, setSheetOpen] = useState(false)

  function handleItemClick(id: string) {
    if (items.find((n) => n.id === id)?.readAt) return
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)))
    setUnreadCount((c) => Math.max(0, c - 1))
    void markNotificationRead(id)
  }

  function handleMarkAllRead() {
    setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })))
    setUnreadCount(0)
    void markAllNotificationsRead()
  }

  const activity = toActivity(items)
  const heading = unreadCount > 0 ? unreadLabel(unreadCount, "unread notification") : "You're all caught up"

  const panelBody =
    activity.length === 0 ? (
      <EmptyState />
    ) : (
      // No group headings in the panel: it holds eight rows, and four
      // headings over eight rows is furniture rather than structure.
      <ActivityList items={activity} onOpen={handleItemClick} density="compact" showGroups={false} />
    )

  return (
    <>
      {/* Desktop / tablet: anchored popover */}
      <div className="hidden sm:block">
        <DropdownMenu>
          <DropdownMenuTrigger render={<TriggerButton unreadCount={unreadCount} variant={variant} />} />
          <DropdownMenuContent align="end" className="w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden p-0">
            <div className="flex items-center justify-between gap-3 border-b border-ink/10 px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Activity</p>
                <p className="truncate text-xs text-ink-muted">{heading}</p>
              </div>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="shrink-0 rounded px-1.5 py-1 text-xs font-medium text-forest-800 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  Mark All Read
                </button>
              )}
            </div>
            <div className="max-h-[26rem] overflow-y-auto overscroll-contain">{panelBody}</div>
            <Link
              href="/notifications"
              className="block border-t border-ink/10 px-3.5 py-3 text-center text-sm font-medium text-forest-800 outline-none hover:bg-ink/[0.02] hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-inset"
            >
              Open Activity
            </Link>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Mobile: bottom sheet, matching the compact Messenger beside it. */}
      <div className="sm:hidden">
        <TriggerButton unreadCount={unreadCount} variant={variant} onClick={() => setSheetOpen(true)} />
      </div>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="bottom"
          className="flex max-h-[82dvh] flex-col rounded-t-2xl bg-white p-0 pb-[env(safe-area-inset-bottom)] sm:hidden"
        >
          <SheetHeader className="shrink-0 flex-row items-center justify-between gap-3 border-b border-ink/10 px-4 py-3">
            <div className="min-w-0 text-left">
              <SheetTitle className="text-sm font-medium text-ink">Activity</SheetTitle>
              <p className="truncate text-xs text-ink-muted">{heading}</p>
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="shrink-0 rounded px-2 py-1.5 text-xs font-medium text-forest-800 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                Mark All Read
              </button>
            )}
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{panelBody}</div>
          <div className="shrink-0 border-t border-ink/10 p-3">
            <Button render={<Link href="/notifications" onClick={() => setSheetOpen(false)} />} variant="outline" className="h-11 w-full">
              Open Activity
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
