"use client"

import Link from "next/link"
import {
  CalendarDays,
  Dumbbell,
  LifeBuoy,
  Shield,
  Trophy,
  UserPlus,
  type LucideIcon,
} from "lucide-react"

import { activityTime, type ActivityContext, type ActivityItem } from "@/lib/notifications/activity"
import { cn } from "@/lib/utils"

/**
 * THE activity row. One component, two surfaces: the bell panel and the
 * Notifications page.
 *
 * Every row answers four questions in the order a person asks them:
 *
 *   WHAT HAPPENED   the title, in full weight when unread
 *   CONTEXT         which team, which fixture, which club
 *   WHEN            short, at the end, where the eye finishes
 *   WHERE TO        the whole row is the link to the canonical destination
 *
 * A ROW, NOT A CARD. Activity is scanned in a column of twenty; giving each
 * one a border and a shadow turns a list into a pile. Hairline between
 * siblings, hover wash, and the unread state carried by weight and an
 * indicator -- never by hue alone.
 */

const CONTEXT_MARK: Record<ActivityContext, { icon: LucideIcon; label: string; tint: string }> = {
  fixture: { icon: CalendarDays, label: "Fixture", tint: "bg-forest-800/10 text-forest-800" },
  training: { icon: Dumbbell, label: "Training", tint: "bg-pitch-600/12 text-rugby-700" },
  tournament: { icon: Trophy, label: "Tournament", tint: "bg-amber-500/12 text-amber-800" },
  request: { icon: UserPlus, label: "Request", tint: "bg-messenger-blue-soft text-messenger-blue" },
  club: { icon: Shield, label: "Club", tint: "bg-ink/8 text-ink/70" },
  support: { icon: LifeBuoy, label: "Support", tint: "bg-ink/8 text-ink/70" },
}

export function ActivityRow({
  item,
  onOpen,
  density = "comfortable",
}: {
  item: ActivityItem
  /** Marks this one read. Opening the list must never mark everything read. */
  onOpen?: (id: string) => void
  density?: "comfortable" | "compact"
}) {
  const unread = !item.readAt
  const { icon: Icon, label, tint } = CONTEXT_MARK[item.context]

  return (
    <Link
      href={item.href}
      onClick={() => onOpen?.(item.id)}
      className={cn(
        "group relative flex w-full items-start gap-3 outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-inset",
        density === "compact" ? "px-3.5 py-2.5" : "px-3 py-3 sm:px-4",
        unread ? "bg-pitch-600/[0.045] hover:bg-pitch-600/[0.075]" : "hover:bg-ink/[0.035]"
      )}
    >
      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", tint)}>
        <Icon className="size-4" aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className={cn("min-w-0 flex-1 text-sm leading-snug", unread ? "font-semibold text-ink" : "font-medium text-ink/85")}>
            {item.title}
          </p>
          <time dateTime={item.createdAt} className="shrink-0 text-[11px] tabular-nums text-ink-muted">
            {activityTime(item.createdAt)}
          </time>
        </div>
        <p className={cn("mt-0.5 text-xs leading-relaxed", unread ? "text-ink/75" : "text-ink-muted", density === "compact" ? "line-clamp-2" : "line-clamp-3")}>
          {item.body}
        </p>
      </div>

      {/* The unread dot is the third signal, after weight and surface -- and
          it carries the word too, so the state is never colour alone. */}
      {unread && (
        <span className="mt-2 flex shrink-0 items-center">
          <span className="size-2 rounded-full bg-pitch-600" aria-hidden="true" />
          <span className="sr-only">Unread</span>
        </span>
      )}
    </Link>
  )
}

/** Skeleton shaped like the row above, not a grey slab. */
export function ActivityRowSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-3" aria-hidden="true">
      <div className="size-8 shrink-0 animate-pulse rounded-lg bg-ink/8" />
      <div className="min-w-0 flex-1 space-y-2 py-0.5">
        <div className="h-3 w-2/5 animate-pulse rounded bg-ink/8" />
        <div className="h-2.5 w-4/5 animate-pulse rounded bg-ink/6" />
      </div>
    </div>
  )
}
