"use client"

import { useState } from "react"
import Link from "next/link"
import { Bell } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

import { markAllNotificationsRead, markNotificationRead } from "./notification-actions"
import type { NotificationItem } from "@/lib/app-context/notifications"

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

/**
 * "Minimal, elegant... no architectural expansion" from the brief -- reads
 * the notifications rows the DB triggers already write (see
 * lib/app-context/notifications.ts), reuses the existing DropdownMenu
 * primitive, and marks read through the existing self-only, read_at-only
 * update policy. No separate notification-center page, no realtime
 * subscription, no new schema.
 */
export function NotificationBell({
  initialItems,
  initialUnreadCount,
  variant = "dark",
}: {
  initialItems: NotificationItem[]
  initialUnreadCount: number
  /** "dark" for the forest-950 sidebar/topbar chrome, "light" if ever placed on a chalk surface. */
  variant?: "dark" | "light"
}) {
  const [items, setItems] = useState(initialItems)
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount)

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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
            className={cn(
              "relative flex size-10 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
              variant === "dark" ? "text-white/70 hover:bg-white/10 hover:text-white" : "text-ink/60 hover:bg-ink/5 hover:text-ink"
            )}
          />
        }
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full bg-pitch-600 text-[10px] font-semibold text-white ring-2 ring-forest-950">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-0">
        <div className="flex items-center justify-between border-b border-ink/10 px-3.5 py-2.5">
          <p className="text-sm font-medium text-ink">Notifications</p>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="rounded px-1.5 py-1 text-xs font-medium text-forest-800 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              Mark all read
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <p className="px-3.5 py-6 text-center text-sm text-ink/45">You&rsquo;re all caught up.</p>
        ) : (
          <ul className="max-h-96 overflow-y-auto py-1">
            {items.map((n) => (
              <li key={n.id}>
                <DropdownMenuItem
                  render={<Link href={n.href} onClick={() => handleItemClick(n.id)} />}
                  className="flex items-start gap-2.5 rounded-none px-3.5 py-2.5"
                >
                  <span
                    className={cn(
                      "mt-1.5 size-1.5 shrink-0 rounded-full",
                      n.readAt ? "bg-transparent" : "bg-pitch-600"
                    )}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm", n.readAt ? "text-ink/70" : "font-medium text-ink")}>{n.title}</p>
                    <p className="truncate text-xs text-ink/50">{n.body}</p>
                  </div>
                  <span className="shrink-0 pt-0.5 text-[11px] text-ink/35">{relativeTime(n.createdAt)}</span>
                </DropdownMenuItem>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
