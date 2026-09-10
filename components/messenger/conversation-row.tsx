"use client"

import Link from "next/link"
import { CalendarDays, LifeBuoy, MessageSquare, Send } from "lucide-react"

import { ClubAvatar } from "@/components/club/club-avatar"
import {
  badgeCount,
  listTime,
  statusTone,
  unreadLabel,
  type MessengerRow,
} from "@/lib/messenger/view-model"
import { cn } from "@/lib/utils"

/**
 * THE conversation row. One component, three surfaces: the /messages
 * workspace, the compact Messenger panel, and the mobile list.
 *
 * DENSE BUT READABLE, not a card. A fixture secretary in September has forty
 * of these; giving each one a border, a shadow and its own white panel turns a
 * list into a stack of objects to work through. The row is a row -- a hairline
 * between siblings, a hover wash, and one clear selected state -- so twelve
 * fit on a laptop screen and the eye can run down the left edge.
 *
 * UNREAD IS OBVIOUS WITHOUT BEING LOUD, and never colour alone: the club name
 * goes to semibold ink, the preview goes from muted to full ink, and a count
 * appears. Take the colour away and the row still reads as unread.
 */

const KIND_MARK: Record<MessengerRow["kind"], { icon: typeof MessageSquare; label: string }> = {
  fixture: { icon: CalendarDays, label: "Fixture conversation" },
  request: { icon: Send, label: "Fixture request" },
  club: { icon: MessageSquare, label: "Club message" },
  support: { icon: LifeBuoy, label: "Ovalball Support" },
}

const TONE_CLASS = {
  awaiting: "bg-amber-500/12 text-amber-800",
  settled: "bg-mint-100 text-forest-900",
  closed: "bg-ink/8 text-ink-muted",
  neutral: "bg-ink/5 text-ink-muted",
} as const

export function ConversationRow({
  row,
  selected = false,
  density = "comfortable",
  onNavigate,
}: {
  row: MessengerRow
  /** Desktop split only: the conversation currently open in the main pane. */
  selected?: boolean
  /** "compact" for the header panel, where vertical space is borrowed. */
  density?: "comfortable" | "compact"
  onNavigate?: () => void
}) {
  const unread = row.unreadCount > 0
  const { icon: KindIcon, label: kindLabel } = KIND_MARK[row.kind]

  return (
    <Link
      href={row.href}
      onClick={onNavigate}
      // aria-current="page" is how a screen reader is told WHICH of these is
      // open -- the selected styling below says it to everyone else.
      aria-current={selected ? "page" : undefined}
      className={cn(
        "group relative flex w-full items-start gap-3 outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-inset",
        density === "compact" ? "px-3 py-2.5" : "px-3 py-3 sm:px-4",
        selected ? "bg-forest-950/[0.06]" : "hover:bg-ink/[0.035]"
      )}
    >
      {/* The selected marker is a rail, not a fill: it survives at any zoom,
          is not a hue, and does not repaint the row's text. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-1 left-0 w-[3px] rounded-r-full transition-colors",
          selected ? "bg-forest-800" : "bg-transparent"
        )}
      />

      <div className="relative shrink-0">
        <ClubAvatar logoUrl={row.logoUrl} name={row.title} size="sm" />
        {/* The sporting context marker. Small, on the crest, so the KIND of
            conversation is legible before any text is read. */}
        <span
          className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-chalk ring-1 ring-ink/10"
          title={kindLabel}
        >
          <KindIcon className="size-2.5 text-forest-800" aria-hidden="true" />
          <span className="sr-only">{kindLabel}</span>
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className={cn("min-w-0 flex-1 truncate text-sm", unread ? "font-semibold text-ink" : "font-medium text-ink/85")}>
            {row.title}
          </p>
          <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">{listTime(row.activityAt)}</span>
        </div>

        {row.context && <p className="mt-0.5 truncate text-xs text-ink-muted">{row.context}</p>}

        <div className="mt-1 flex items-center gap-2">
          <p className={cn("min-w-0 flex-1 truncate text-sm", unread ? "text-ink" : "text-ink-muted")}>
            {row.preview ?? <span className="italic text-ink-subtle">No messages yet</span>}
          </p>
          {unread && (
            <span
              className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-pitch-600 px-1.5 text-[11px] font-semibold tabular-nums text-white"
              aria-label={unreadLabel(row.unreadCount)}
            >
              {badgeCount(row.unreadCount)}
            </span>
          )}
        </div>

        {density === "comfortable" && (
          <span className={cn("mt-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", TONE_CLASS[statusTone(row.status)])}>
            {row.statusLabel}
          </span>
        )}
      </div>
    </Link>
  )
}
