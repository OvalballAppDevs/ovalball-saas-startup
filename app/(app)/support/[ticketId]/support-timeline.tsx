import { CheckCircle2, MessageSquare, PlayCircle, User } from "lucide-react"

import type { SupportTicketEvent } from "@/lib/support/types"

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

/**
 * System events (created/status_changed) render as small centered
 * dashed-line entries, visually distinct from human replies -- the same
 * "system event" treatment already established in fixture conversations,
 * reused here rather than inventing a second visual language.
 */
export function SupportTimeline({ events, viewerIsRequester }: { events: SupportTicketEvent[]; viewerIsRequester: boolean }) {
  return (
    <ol className="flex flex-col gap-4">
      {events.map((e) => {
        if (e.eventType === "created") {
          return (
            <li key={e.id} className="flex items-center gap-3 text-xs text-ink/40">
              <span className="h-px flex-1 border-t border-dashed border-ink/15" />
              <span>
                {viewerIsRequester ? "You submitted this request." : `${e.actorName} submitted this request.`} &middot;{" "}
                {formatDateTime(e.createdAt)}
              </span>
              <span className="h-px flex-1 border-t border-dashed border-ink/15" />
            </li>
          )
        }
        if (e.eventType === "status_changed") {
          const to = (e.metadata.to as string) ?? ""
          const label = to === "in_progress" ? "In Progress" : to === "closed" ? "Closed" : to
          return (
            <li key={e.id} className="flex items-center gap-3 text-xs text-ink/40">
              <span className="h-px flex-1 border-t border-dashed border-ink/15" />
              <span className="inline-flex items-center gap-1">
                {to === "closed" ? <CheckCircle2 className="size-3.5" /> : <PlayCircle className="size-3.5" />}
                Ovalball Support changed status to {label} &middot; {formatDateTime(e.createdAt)}
              </span>
              <span className="h-px flex-1 border-t border-dashed border-ink/15" />
            </li>
          )
        }

        const isSupport = e.eventType === "support_reply" || e.eventType === "internal_note"
        const isInternal = e.eventType === "internal_note"
        return (
          <li
            key={e.id}
            className={`max-w-[85%] rounded-lg px-4 py-3 ${
              isInternal
                ? "self-start border border-amber-400/40 bg-amber-50"
                : isSupport
                  ? "self-start border border-ink/10 bg-white"
                  : "self-end bg-mint-100"
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-medium text-ink/50">
              <User className="size-3" />
              {isInternal ? "Internal note (Site Admin only)" : e.actorName}
              <span className="text-ink/30">&middot; {formatDateTime(e.createdAt)}</span>
            </div>
            <p className="mt-1.5 text-sm whitespace-pre-wrap text-ink">{e.body}</p>
          </li>
        )
      })}
      {events.length === 0 && (
        <li className="flex items-center gap-2 text-sm text-ink/40">
          <MessageSquare className="size-4" />
          No activity yet.
        </li>
      )}
    </ol>
  )
}
