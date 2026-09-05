"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { MessageSquare } from "lucide-react"

import { ClubAvatar } from "@/components/club/club-avatar"

export interface ConversationRow {
  key: string
  kind: "request" | "fixture" | "club"
  href: string
  logoUrl: string | null
  clubName: string
  title: string
  preview: string | null
  status: string
  statusLabel: string
  /** ISO timestamp used for both display and "Recent activity" sort -- never a separately-tracked field, so a row can never show one time and sort by another. */
  activityAt: string | null
  unreadCount: number
}

const STATUS_STYLES: Record<string, string> = {
  sent: "bg-amber-500/12 text-amber-800",
  pending: "bg-amber-500/12 text-amber-800",
  accepted: "bg-mint-100 text-forest-900",
  Booked: "bg-mint-100 text-forest-900",
  Confirmed: "bg-mint-100 text-forest-900",
  declined: "bg-destructive/10 text-destructive",
  Cancelled: "bg-destructive/10 text-destructive",
  cancelled: "bg-destructive/10 text-destructive",
  expired: "bg-ink/5 text-ink/50",
  counter_proposed: "bg-amber-500/12 text-amber-800",
  read: "bg-ink/5 text-ink/60",
}

const FILTERS = [
  { value: "all", label: "All conversations" },
  { value: "request", label: "Fixture requests" },
  { value: "fixture", label: "Fixtures" },
  { value: "club", label: "Club messages" },
] as const

type SortValue = "recent" | "club-asc" | "club-desc"

/**
 * Presentation layer only, over the SAME real conversation data
 * `page.tsx` already fetches via getConversationSummaries/
 * getClubConversationSummaries -- this component filters/sorts/renders,
 * it never fetches or mutates. Reconciliation pass: same messages, same
 * backend, same permissions, same records, different presentation.
 */
export function ConversationList({ rows }: { rows: ConversationRow[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("all")
  const [sort, setSort] = useState<SortValue>("recent")

  const visible = useMemo(() => {
    const filtered = filter === "all" ? rows : rows.filter((r) => r.kind === filter)
    const sorted = [...filtered]
    if (sort === "recent") {
      sorted.sort((a, b) => (b.activityAt ?? "").localeCompare(a.activityAt ?? ""))
    } else if (sort === "club-asc") {
      sorted.sort((a, b) => a.clubName.localeCompare(b.clubName))
    } else {
      sorted.sort((a, b) => b.clubName.localeCompare(a.clubName))
    }
    return sorted
  }, [rows, filter, sort])

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`h-8 rounded-full px-3.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 ${
                filter === f.value ? "bg-forest-950 text-white" : "border border-ink/15 bg-white text-ink/70 hover:border-ink/30"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-ink/55">
          Sort by:
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortValue)}
            className="h-8 rounded-lg border border-ink/15 bg-white px-2 text-sm text-ink outline-none focus-visible:border-pitch-600"
          >
            <option value="recent">Recent activity</option>
            <option value="club-asc">Club name A–Z</option>
            <option value="club-desc">Club name Z–A</option>
          </select>
        </label>
      </div>

      {visible.length === 0 ? (
        <div className="mt-6 flex flex-col items-start gap-3 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8">
          <MessageSquare className="size-5 text-ink/30" />
          <div>
            <p className="text-sm font-medium text-ink">No conversations{filter === "all" ? " yet" : " in this filter"}</p>
            <p className="mt-1 text-sm text-ink/55">
              {filter === "all"
                ? "Once you send or receive a fixture request, or start a club message, it will appear here."
                : "Try a different filter to see other conversations."}
            </p>
          </div>
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {visible.map((c) => (
            <li key={c.key}>
              <Link
                href={c.href}
                className="flex items-start gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5 outline-none transition-colors hover:border-ink/20 focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                <ClubAvatar logoUrl={c.logoUrl} name={c.clubName} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-ink">{c.clubName}</p>
                    {c.unreadCount > 0 && (
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-pitch-600 text-[11px] font-semibold text-white">
                        {c.unreadCount}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-ink/50">{c.title}</p>
                  <p className="mt-1.5 truncate text-sm text-ink/70">{c.preview ?? <span className="text-ink/40 italic">No messages yet</span>}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[c.status] ?? "bg-ink/5 text-ink/60"}`}>{c.statusLabel}</span>
                  <span className="text-xs text-ink/40">{formatActivityTime(c.activityAt)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function formatActivityTime(iso: string | null): string {
  if (!iso) return ""
  const date = new Date(iso)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  const days = Math.floor((now.getTime() - date.getTime()) / 86400000)
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days} days ago`
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}
