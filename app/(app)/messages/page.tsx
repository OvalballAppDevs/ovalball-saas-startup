import { redirect } from "next/navigation"
import Link from "next/link"
import { MessageSquare } from "lucide-react"

import { getConversationSummaries } from "@/lib/app-context/conversations"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

const STATUS_STYLES: Record<string, string> = {
  sent: "bg-mint-100/60 text-forest-800",
  accepted: "bg-mint-100 text-forest-900",
  Booked: "bg-mint-100 text-forest-900",
  Confirmed: "bg-mint-100 text-forest-900",
  declined: "bg-destructive/10 text-destructive",
  Cancelled: "bg-destructive/10 text-destructive",
  cancelled: "bg-destructive/10 text-destructive",
  expired: "bg-ink/5 text-ink/50",
  counter_proposed: "bg-mint-100/60 text-forest-800",
}

const STATUS_LABELS: Record<string, string> = {
  sent: "Awaiting response",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
  counter_proposed: "Counter-proposed",
}

export default async function MessagesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const conversations = await getConversationSummaries(supabase, ctx, user.id)

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Messages</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Fixture conversations</h1>
      <p className="mt-2 max-w-md text-sm text-ink/55">
        Every conversation here belongs to a specific fixture or fixture request &mdash; not a general club inbox.
      </p>

      {conversations.length === 0 ? (
        <div className="mt-8 flex flex-col items-start gap-3 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8">
          <MessageSquare className="size-5 text-ink/30" />
          <div>
            <p className="text-sm font-medium text-ink">No conversations yet</p>
            <p className="mt-1 text-sm text-ink/55">
              Once you send or receive a fixture request, you can message the other side about it here.
            </p>
          </div>
        </div>
      ) : (
        <ul className="mt-8 flex flex-col gap-2">
          {conversations.map((c) => {
            const date = c.date ? new Date(c.date + "T00:00:00") : null
            const dateLabel = date?.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) ?? "TBC"
            return (
              <li key={`${c.kind}:${c.id}`}>
                <Link
                  href={`/messages/${c.kind}/${c.id}`}
                  className="flex items-start gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5 outline-none transition-colors hover:border-ink/20 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-ink">
                        {c.myTeamDisplayName} <span className="text-ink/40">vs</span> {c.oppositionLabel}
                      </p>
                      {c.unreadCount > 0 && (
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-pitch-600 text-[11px] font-semibold text-white">
                          {c.unreadCount}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink/50">{dateLabel}</p>
                    <p className="mt-1.5 truncate text-sm text-ink/70">
                      {c.latestMessagePreview ?? <span className="text-ink/40 italic">No messages yet</span>}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[c.status] ?? "bg-ink/5 text-ink/60"}`}
                  >
                    {STATUS_LABELS[c.status] ?? c.status}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
