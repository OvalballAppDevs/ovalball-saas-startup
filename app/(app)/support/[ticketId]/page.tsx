import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, Paperclip } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { getSupportTicketDetail, getSupportTicketEvents } from "@/lib/support/queries"
import { SUPPORT_CATEGORY_LABELS, SUPPORT_STATUS_LABELS } from "@/lib/support/types"

import { FollowupForm } from "./followup-form"
import { SupportTimeline } from "./support-timeline"

const STATUS_BADGE_STYLE: Record<string, string> = {
  new: "bg-pitch-600/12 text-forest-800",
  in_progress: "bg-amber-500/15 text-amber-800",
  closed: "bg-ink/8 text-ink/55",
}

/**
 * The requester's own experience -- deliberately filters to
 * visibility="requester" events even though RLS would also let a
 * manage-level Site Admin fetch internal notes here (they're allowed to
 * read any ticket): this specific route is the user-facing surface, and
 * internal notes only ever render on the separate /admin/support
 * workspace, never here, regardless of who is looking.
 */
export default async function SupportTicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ticket = await getSupportTicketDetail(supabase, ticketId)
  if (!ticket) notFound()

  const { data: profile } = ticket.createdByUserId
    ? await supabase.from("profiles").select("first_name, surname").eq("id", ticket.createdByUserId).maybeSingle()
    : { data: null }
  const requesterName = [profile?.first_name, profile?.surname].filter(Boolean).join(" ") || "You"

  const allEvents = await getSupportTicketEvents(supabase, ticket.id, ticket.createdByUserId, requesterName)
  const events = allEvents.filter((e) => e.visibility === "requester")
  const isRequester = ticket.createdByUserId === user.id

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <Link href="/support" className="inline-flex items-center gap-1 text-sm text-ink/50 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400">
        <ChevronLeft className="size-4" />
        Support
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-[0.04em] text-ink/40">{ticket.reference}</p>
          <h1 className="mt-1 font-display text-display-m text-ink">{ticket.subject}</h1>
          <p className="mt-1 text-sm text-ink/50">
            {SUPPORT_CATEGORY_LABELS[ticket.category]}
            {ticket.clubName ? ` · ${ticket.clubName}` : ""}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium ${STATUS_BADGE_STYLE[ticket.status]}`}>
          {SUPPORT_STATUS_LABELS[ticket.status]}
        </span>
      </div>

      <div className="mt-6 rounded-xl border border-ink/10 bg-white p-5">
        <p className="text-xs font-medium tracking-[0.04em] text-ink/40 uppercase">Original request</p>
        <p className="mt-2 text-sm whitespace-pre-wrap text-ink">{ticket.description}</p>
        {ticket.attachments.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5">
            {ticket.attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-1.5 text-xs text-ink/50">
                <Paperclip className="size-3" />
                {a.fileName}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-8 rounded-xl border border-ink/10 bg-white p-5">
        <p className="text-xs font-medium tracking-[0.04em] text-ink/40 uppercase">Timeline</p>
        <div className="mt-4">
          <SupportTimeline events={events} viewerIsRequester={isRequester} />
        </div>

        {isRequester && ticket.status !== "closed" && <FollowupForm ticketId={ticket.id} />}
        {isRequester && ticket.status === "closed" && (
          <div className="mt-4 border-t border-ink/8 pt-4 text-sm text-ink/55">
            This request is closed.
            <Link href="/support" className="ml-1 font-medium text-forest-800 underline underline-offset-2">
              Create a follow-up request
            </Link>{" "}
            if you need anything else.
          </div>
        )}
      </div>
    </div>
  )
}
