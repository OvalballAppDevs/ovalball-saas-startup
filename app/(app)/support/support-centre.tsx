"use client"

import { useState } from "react"
import Link from "next/link"
import { CheckCircle2, ChevronRight, LifeBuoy } from "lucide-react"

import { Button } from "@/components/ui/button"

import { NewSupportRequestForm } from "./new-request-form"
import { SUPPORT_CATEGORY_LABELS, SUPPORT_STATUS_LABELS, type SupportTicketSummary } from "@/lib/support/types"

const STATUS_BADGE_STYLE: Record<string, string> = {
  new: "bg-pitch-600/12 text-forest-800",
  in_progress: "bg-amber-500/15 text-amber-800",
  closed: "bg-ink/8 text-ink/55",
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

type View = { mode: "list" } | { mode: "new" } | { mode: "success"; id: string; reference: string }

export function SupportCentre({ tickets }: { tickets: SupportTicketSummary[] }) {
  const [view, setView] = useState<View>({ mode: "list" })

  if (view.mode === "success") {
    return (
      <div className="rounded-xl border border-ink/10 bg-white px-6 py-10 text-center">
        <CheckCircle2 className="mx-auto size-10 text-pitch-600" />
        <p className="mt-4 text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Request received</p>
        <p className="mt-1 font-display text-display-m text-ink">{view.reference}</p>
        <p className="mx-auto mt-3 max-w-sm text-sm text-ink/60">
          We&apos;ve received your request. Ovalball Support will review it and updates will appear here and in your
          Notifications.
        </p>
        <div className="mt-6 flex justify-center gap-2.5">
          <Button nativeButton={false} render={<Link href={`/support/${view.id}`} />} className="h-10">
            View request
          </Button>
          <Button variant="outline" className="h-10" onClick={() => setView({ mode: "list" })}>
            Back to Support
          </Button>
        </div>
      </div>
    )
  }

  if (view.mode === "new") {
    return (
      <div className="rounded-xl border border-ink/10 bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-display-s text-ink">New Support Request</h2>
          <Button variant="ghost" size="sm" className="h-8" onClick={() => setView({ mode: "list" })}>
            Cancel
          </Button>
        </div>
        <div className="mt-5">
          <NewSupportRequestForm onCreated={(id, reference) => setView({ mode: "success", id, reference })} />
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink/10 bg-white p-6">
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-pitch-600/12 text-forest-800">
            <LifeBuoy className="size-5" />
          </div>
          <div>
            <p className="font-medium text-ink">Need help with Ovalball?</p>
            <p className="mt-0.5 text-sm text-ink/55">Submit a request and we&apos;ll get back to you here.</p>
          </div>
        </div>
        <Button className="h-10 shrink-0" onClick={() => setView({ mode: "new" })}>
          + New Support Request
        </Button>
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Your requests</h2>
        {tickets.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8 text-center">
            <p className="text-sm font-medium text-ink">No requests yet</p>
            <p className="mt-1 text-sm text-ink/55">Submit a new request above if you need a hand with anything.</p>
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {tickets.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/support/${t.id}`}
                  className="flex items-center gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5 outline-none hover:bg-ink/[0.02] focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium tracking-[0.04em] text-ink/40">{t.reference}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE_STYLE[t.status]}`}>
                        {SUPPORT_STATUS_LABELS[t.status]}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-sm font-medium text-ink">{t.subject}</p>
                    <p className="mt-0.5 text-xs text-ink/45">
                      {SUPPORT_CATEGORY_LABELS[t.category]} &middot; Updated {relativeTime(t.updatedAt)}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-ink/30" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
