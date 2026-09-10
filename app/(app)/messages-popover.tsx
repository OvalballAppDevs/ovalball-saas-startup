"use client"

import { useState } from "react"
import Link from "next/link"
import { MessageSquare } from "lucide-react"

import { ConversationRow } from "@/components/messenger/conversation-row"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { badgeCount, unreadLabel, type MessengerRow } from "@/lib/messenger/view-model"
import { cn } from "@/lib/utils"

/**
 * THE COMPACT MESSENGER -- useful from anywhere in Ovalball.
 *
 * The same conversations as /messages, in the same rows, from the same query.
 * It used to be a separate implementation: its own row component, its own
 * relative-time function, and only fixture conversations, so the panel and the
 * workspace were two different inboxes wearing the same icon. Both now render
 * MessengerRow through ConversationRow, so opening the panel and opening
 * /messages show the same product.
 *
 * TWO PHYSICAL PRESENTATIONS, one behaviour. Desktop gets an anchored popover;
 * below sm it gets a real bottom sheet -- the shape a phone actually wants,
 * and the shape a native app would use, rather than the desktop popover
 * algebraically squeezed. This is the compact-communication-entry pattern
 * §10 asks translate cleanly into a native app later.
 */

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
      aria-label={unreadCount > 0 ? `Messages, ${unreadLabel(unreadCount)}` : "Messages"}
      className={cn(
        // size-11, not size-10: this is a primary control on a phone, and 40px
        // is below the 44px a thumb reliably hits.
        "relative flex size-11 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
        variant === "dark" ? "text-white/70 hover:bg-white/10 hover:text-white" : "text-ink/60 hover:bg-ink/5 hover:text-ink"
      )}
    >
      <MessageSquare className="size-5" aria-hidden="true" />
      {unreadCount > 0 && (
        // min-w rather than a fixed circle: "99+" is a real value for a
        // fixture secretary in September, and a three-digit count inside a
        // 16px circle is a broken header rather than a large number.
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

function FilterToggle({ filter, setFilter }: { filter: "all" | "unread"; setFilter: (f: "all" | "unread") => void }) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-ink/5 p-0.5" role="group" aria-label="Filter conversations">
      {(["all", "unread"] as const).map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => setFilter(f)}
          aria-pressed={filter === f}
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-medium capitalize outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
            filter === f ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink/75"
          )}
        >
          {f}
        </button>
      ))}
    </div>
  )
}

function EmptyState({ filter }: { filter: "all" | "unread" }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <MessageSquare className="size-5 text-ink-subtle" aria-hidden="true" />
      <p className="text-sm font-medium text-ink">
        {filter === "unread" ? "Nothing unread" : "No conversations yet"}
      </p>
      <p className="max-w-[26ch] text-xs text-ink-muted">
        {filter === "unread"
          ? "You're up to date with every conversation."
          : "Fixture requests, fixture conversations and club messages arrive here."}
      </p>
    </div>
  )
}

export function MessagesPopover({
  conversations,
  unreadCount: canonicalUnreadCount,
  variant = "dark",
}: {
  /** The SAME rows /messages lists, built once by getMessengerRows. */
  conversations: MessengerRow[]
  /**
   * THE CANONICAL MESSENGER UNREAD COUNT, from public.my_unread_counts.
   *
   * Not the sum of the rows below. The badge and the bell come from one
   * calculation, so clearing a message moves both; previously the bell counted
   * every unread notification including messages and the two disagreed by
   * exactly the number of messages you had.
   *
   * supabase/tests/unread_truth.sql asserts the badge and the per-conversation
   * counts agree, so a divergence is a test failure rather than a number a
   * person has to reconcile by eye.
   */
  unreadCount?: number
  variant?: "dark" | "light"
}) {
  const [filter, setFilter] = useState<"all" | "unread">("all")
  const [sheetOpen, setSheetOpen] = useState(false)
  const unreadCount = canonicalUnreadCount ?? conversations.reduce((sum, c) => sum + c.unreadCount, 0)
  const visible = filter === "unread" ? conversations.filter((c) => c.unreadCount > 0) : conversations
  // Recent and actionable, not history. The full workspace is one click away
  // and is where browsing belongs.
  const recent = visible.slice(0, 8)

  const heading = unreadCount > 0 ? unreadLabel(unreadCount) : "You're all caught up"

  return (
    <>
      {/* Desktop / tablet: anchored popover */}
      <div className="hidden sm:block">
        <DropdownMenu>
          <DropdownMenuTrigger render={<TriggerButton unreadCount={unreadCount} variant={variant} />} />
          <DropdownMenuContent align="end" className="w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden p-0">
            <div className="flex items-center justify-between gap-3 border-b border-ink/10 px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Messages</p>
                <p className="truncate text-xs text-ink-muted">{heading}</p>
              </div>
              <FilterToggle filter={filter} setFilter={setFilter} />
            </div>
            {recent.length === 0 ? (
              <EmptyState filter={filter} />
            ) : (
              <ul className="max-h-[26rem] divide-y divide-ink/[0.07] overflow-y-auto overscroll-contain">
                {recent.map((row) => (
                  <li key={row.key}>
                    {/* Deliberately NOT a DropdownMenuItem: a conversation row
                        is a link with its own internal structure, and wrapping
                        it in a menu item makes it a menuitem to assistive
                        technology -- which it is not. */}
                    <ConversationRow row={row} density="compact" />
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/messages"
              className="block border-t border-ink/10 px-3.5 py-3 text-center text-sm font-medium text-forest-800 outline-none hover:bg-ink/[0.02] hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-inset"
            >
              Open Messages
            </Link>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Mobile: a genuine bottom sheet, opened from a plain button rather
          than Sheet's portal Trigger fighting the popover's positioning. */}
      <div className="sm:hidden">
        <TriggerButton unreadCount={unreadCount} variant={variant} onClick={() => setSheetOpen(true)} />
      </div>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="bottom"
          // pb-[env(safe-area-inset-bottom)] so the last row and the footer
          // button clear the home indicator on a modern phone.
          className="flex max-h-[82dvh] flex-col rounded-t-2xl bg-white p-0 pb-[env(safe-area-inset-bottom)] sm:hidden"
        >
          <SheetHeader className="shrink-0 flex-row items-center justify-between gap-3 border-b border-ink/10 px-4 py-3">
            <div className="min-w-0 text-left">
              <SheetTitle className="text-sm font-medium text-ink">Messages</SheetTitle>
              <p className="truncate text-xs text-ink-muted">{heading}</p>
            </div>
            <FilterToggle filter={filter} setFilter={setFilter} />
          </SheetHeader>
          {recent.length === 0 ? (
            <EmptyState filter={filter} />
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-ink/[0.07] overflow-y-auto overscroll-contain">
              {recent.map((row) => (
                <li key={row.key}>
                  <ConversationRow row={row} density="compact" onNavigate={() => setSheetOpen(false)} />
                </li>
              ))}
            </ul>
          )}
          <div className="shrink-0 border-t border-ink/10 p-3">
            <Button render={<Link href="/messages" onClick={() => setSheetOpen(false)} />} variant="outline" className="h-11 w-full">
              Open Messages
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
