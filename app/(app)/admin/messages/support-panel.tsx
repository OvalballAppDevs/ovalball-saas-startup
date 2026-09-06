import Link from "next/link"
import { ChevronRight, LifeBuoy } from "lucide-react"

import type { SupportConversationSummary } from "@/lib/support/conversations"
import { SUPPORT_STATUS_LABEL } from "@/lib/support/conversations"

/**
 * Support conversations, inside Site Admin Messages.
 *
 * The reported problem was that support requests were invisible here. They
 * are now present and, importantly, visibly SEPARATE: support is
 * person-to-Ovalball, whereas everything else on this page is club-to-club
 * fixture and conversation traffic. Mixing them into the same table would
 * have implied they share participants, moderation policy and content
 * rules, and none of that is true.
 *
 * Each row links to the existing `/admin/support/[ticketId]` thread -- the
 * one place a support reply is written. This panel is a view, never a
 * second reply surface.
 */
const STATUS_TONE: Record<string, string> = {
  Open: "bg-amber-500/12 text-amber-800",
  "With Ovalball": "bg-amber-500/12 text-amber-800",
  Resolved: "bg-mint-100 text-forest-900",
}

export function SupportPanel({ threads }: { threads: SupportConversationSummary[] }) {
  return (
    <section aria-labelledby="admin-support-threads" className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-center gap-2">
          <LifeBuoy aria-hidden="true" className="size-4 text-forest-800" />
          <h2 id="admin-support-threads" className="font-display text-xl text-ink">
            Ovalball Support
          </h2>
        </div>
        <Link
          href="/admin/support"
          className="inline-flex items-center gap-1 text-sm font-medium text-forest-800 underline underline-offset-4 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          Support requests queue
          <ChevronRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-ink/55">
        Conversations between a person and Ovalball. Separate from club and fixture messaging below:
        different participants, and internal notes are never shown to the requester.
      </p>

      {threads.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-ink/15 px-5 py-6 text-center text-sm text-ink/55">
          No support conversations yet.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-ink/8 rounded-lg border border-ink/10 bg-white">
          {threads.map((t) => {
            const label = SUPPORT_STATUS_LABEL[t.status]
            return (
              <li key={t.ticketId}>
                <Link
                  href={`/admin/support/${t.ticketId}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3.5 outline-none transition-colors hover:bg-ink/[0.02] focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-inset"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{t.subject}</p>
                    <p className="mt-0.5 truncate text-xs text-ink/55">
                      <span className="font-mono">{t.reference}</span>
                      {t.clubName ? ` · ${t.clubName}` : ""}
                      {t.latestPreview
                        ? ` · ${t.latestFrom === "support" ? "Ovalball Support" : "Requester"}: ${t.latestPreview}`
                        : ""}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[label] ?? "bg-ink/5 text-ink/60"}`}
                  >
                    {label}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
