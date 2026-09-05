"use client"

import { useState, type ReactNode } from "react"
import Link from "next/link"
import { MessageSquare } from "lucide-react"

import { ClubAvatar } from "@/components/club/club-avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { ConversationSummary } from "@/lib/app-context/conversations"
import { cn } from "@/lib/utils"

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days}d`
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
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
      aria-label={unreadCount > 0 ? `Messages, ${unreadCount} unread` : "Messages"}
      className={cn(
        "relative flex size-10 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
        variant === "dark" ? "text-white/70 hover:bg-white/10 hover:text-white" : "text-ink/60 hover:bg-ink/5 hover:text-ink"
      )}
    >
      <MessageSquare className="size-5" />
      {unreadCount > 0 && (
        <span className="absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full bg-pitch-600 text-[10px] font-semibold text-white ring-2 ring-forest-950">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </button>
  )
}

function FilterToggle({ filter, setFilter }: { filter: "all" | "unread"; setFilter: (f: "all" | "unread") => void }) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-ink/5 p-0.5">
      {(["all", "unread"] as const).map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => setFilter(f)}
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-medium capitalize outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
            filter === f ? "bg-white text-ink shadow-sm" : "text-ink/50 hover:text-ink/75"
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
    <div className="flex flex-col items-center gap-2 px-3.5 py-8 text-center">
      <MessageSquare className="size-5 text-ink/25" />
      <p className="text-sm font-medium text-ink">{filter === "unread" ? "No unread fixture messages" : "No fixture messages yet"}</p>
      <p className="max-w-[220px] text-xs text-ink/45">Conversations about your fixtures will show up here.</p>
    </div>
  )
}

function previewText(c: ConversationSummary): ReactNode {
  if (!c.latestMessagePreview) return <span className="italic text-ink/40">No messages yet</span>
  return c.latestMessagePreview.replace(/^Shared document:/, "Shared")
}

/**
 * Leads with the OPPONENT club's identity (crest + club name) -- "who is
 * this conversation with" is the useful first question in an inbox row,
 * never "which of my own teams" (that's secondary context, shown smaller
 * underneath). Matches the brief's explicit correction away from the
 * team-only "U12 A <-> U12 A" row this replaced.
 */
function ConversationRow({ c, onNavigate }: { c: ConversationSummary; onNavigate?: () => void }) {
  const unread = c.unreadCount > 0
  return (
    <Link
      href={`/messages/${c.kind}/${c.id}`}
      onClick={onNavigate}
      className={cn(
        "flex items-start gap-2.5 px-3.5 py-2.5 outline-none transition-colors hover:bg-mint-100/50 focus-visible:bg-mint-100/50",
        unread && "bg-pitch-600/[0.05]"
      )}
    >
      <ClubAvatar logoUrl={c.opponentClubLogoUrl} name={c.opponentClubName} size="sm" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className={cn("truncate text-sm", unread ? "font-semibold text-ink" : "font-medium text-ink/85")}>{c.opponentClubName}</p>
          {unread && <span className="mt-0.5 size-2 shrink-0 rounded-full bg-pitch-600" aria-hidden="true" />}
        </div>
        <p className="truncate text-xs text-ink/45">
          {c.oppositionLabel} <span className="text-ink/25">&middot;</span> {c.myClubName} {c.myTeamDisplayName}
        </p>
        <p className={cn("mt-1 truncate text-sm", unread ? "font-medium text-ink/80" : "text-ink/60")}>{previewText(c)}</p>
        {c.latestMessageAt && (
          <p className="mt-0.5 text-[11px] text-ink/40">
            {c.latestMessageSenderName} &middot; {relativeTime(c.latestMessageAt)}
          </p>
        )}
      </div>
      {c.unreadCount > 1 && (
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-pitch-600 text-[11px] font-semibold text-white">
          {c.unreadCount}
        </span>
      )}
    </Link>
  )
}

/**
 * A distinct sibling to NotificationBell -- own icon, own unread count
 * (sum of ConversationSummary.unreadCount, itself sourced from real
 * unread new_fixture_message notifications, never a fabricated React
 * state number), own popover. Messages and notifications are related but
 * different concepts per the brief -- two icons, two counts, never merged.
 * Reuses the exact same fixture-scoped conversation data the full /messages
 * inbox already computes (getConversationSummaries) -- no second
 * messaging architecture, no new schema.
 *
 * Desktop renders an anchored popover (DropdownMenu); below sm it renders
 * a genuine bottom sheet (the same Sheet primitive the mobile nav's own
 * slide-out menu already uses) -- not the desktop popover algebraically
 * squeezed, a different physical presentation for a different context,
 * sharing the same data/filter state.
 */
export function MessagesPopover({ conversations, variant = "dark" }: { conversations: ConversationSummary[]; variant?: "dark" | "light" }) {
  const [filter, setFilter] = useState<"all" | "unread">("all")
  const [sheetOpen, setSheetOpen] = useState(false)
  const unreadCount = conversations.reduce((sum, c) => sum + c.unreadCount, 0)
  const visible = filter === "unread" ? conversations.filter((c) => c.unreadCount > 0) : conversations

  return (
    <>
      {/* Desktop / tablet: anchored popover */}
      <div className="hidden sm:block">
        <DropdownMenu>
          <DropdownMenuTrigger render={<TriggerButton unreadCount={unreadCount} variant={variant} />} />
          <DropdownMenuContent align="end" className="w-96 max-w-[calc(100vw-2rem)] p-0">
            <div className="flex items-center justify-between border-b border-ink/10 px-3.5 py-2.5">
              <div>
                <p className="text-sm font-medium text-ink">Messages</p>
                <p className="text-xs text-ink/45">{unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}</p>
              </div>
              <FilterToggle filter={filter} setFilter={setFilter} />
            </div>
            {visible.length === 0 ? (
              <EmptyState filter={filter} />
            ) : (
              <ul className="max-h-[26rem] overflow-y-auto py-1">
                {visible.map((c) => (
                  <li key={`${c.kind}:${c.id}`}>
                    <DropdownMenuItem render={<ConversationRow c={c} />} className="rounded-none p-0" />
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/messages"
              className="block border-t border-ink/10 px-3.5 py-2.5 text-center text-sm font-medium text-forest-800 outline-none hover:bg-ink/[0.02] hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              View all messages
            </Link>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Mobile: bottom sheet -- a plain button opening Sheet's own open
          state directly, never Sheet's portal-based Trigger fighting a
          second popover's positioning. */}
      <div className="sm:hidden">
        <TriggerButton unreadCount={unreadCount} variant={variant} onClick={() => setSheetOpen(true)} />
      </div>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] rounded-t-2xl bg-chalk p-0 sm:hidden">
          <SheetHeader className="flex-row items-center justify-between border-b border-ink/10 px-4 py-3">
            <div>
              <SheetTitle className="text-sm font-medium text-ink">Messages</SheetTitle>
              <p className="text-xs text-ink/45">{unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}</p>
            </div>
            <FilterToggle filter={filter} setFilter={setFilter} />
          </SheetHeader>
          {visible.length === 0 ? (
            <EmptyState filter={filter} />
          ) : (
            <ul className="flex-1 overflow-y-auto py-1">
              {visible.map((c) => (
                <li key={`${c.kind}:${c.id}`}>
                  <ConversationRow c={c} onNavigate={() => setSheetOpen(false)} />
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-ink/10 p-3">
            <Button render={<Link href="/messages" onClick={() => setSheetOpen(false)} />} variant="outline" className="w-full">
              View all messages
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
