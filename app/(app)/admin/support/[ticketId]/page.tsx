import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, Paperclip, ShieldCheck } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { supportAccessLevel } from "@/lib/support/access"
import { getSupportTicketDetail, getSupportTicketEvents } from "@/lib/support/queries"
import { SUPPORT_CATEGORY_LABELS, type SupportCategory } from "@/lib/support/types"
import { createClient } from "@/lib/supabase/server"

import { SupportTimeline } from "../../../support/[ticketId]/support-timeline"
import { CategoryControl } from "../category-control"
import { InternalNoteForm, ReplyToUserForm } from "../reply-and-notes"
import { StatusControl } from "../status-control"

export default async function AdminSupportTicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Site Admin route-family guard (addendum): requires BOTH real Site
  // Admin authority AND that the account has actively switched into Site
  // Admin as its current operating context -- see requireActiveSiteAdmin()'s
  // own doc comment. An account that also happens to be, say, Burnley's
  // Club Admin must not reach this page while operating as Burnley.
  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok) redirect("/dashboard")
  const ctx = activeSiteAdmin.ctx
  const access = supportAccessLevel(ctx)
  if (access === "none") redirect("/admin/support")

  const ticket = await getSupportTicketDetail(supabase, ticketId)
  if (!ticket) notFound()

  const { data: profile } = ticket.createdByUserId
    ? await supabase.from("profiles").select("first_name, surname, email").eq("id", ticket.createdByUserId).maybeSingle()
    : { data: null }
  const requesterName = ticket.createdByUserId
    ? [profile?.first_name, profile?.surname].filter(Boolean).join(" ") || "Ovalball user"
    : (ticket.contactName ?? "Anonymous visitor")
  const requesterEmail = ticket.createdByUserId ? profile?.email : ticket.contactEmail

  const events = await getSupportTicketEvents(supabase, ticket.id, ticket.createdByUserId, requesterName)

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8 md:py-12">
      <Link href="/admin/support" className="inline-flex items-center gap-1 text-sm text-ink/50 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400">
        <ChevronLeft className="size-4" />
        Support
      </Link>

      <div className="mt-4 flex items-center gap-2.5">
        <ShieldCheck className="size-4 text-forest-800" />
        <p className="text-xs font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>

      <p className="mt-2 text-xs font-medium tracking-[0.04em] text-ink/40">{ticket.reference}</p>
      <h1 className="mt-1 font-display text-display-m text-ink">{ticket.subject}</h1>

      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-ink/10 bg-white p-5 sm:grid-cols-4">
        <div>
          <StatusControl ticketId={ticket.id} currentStatus={ticket.status} />
        </div>
        <div>
          <p className="text-xs font-medium tracking-[0.04em] text-ink/40 uppercase">Raised by</p>
          <p className="mt-1.5 text-sm text-ink">{requesterName}</p>
          <p className="text-xs text-ink/40">{requesterEmail}</p>
          {ticket.origin === "public" && (
            <span className="mt-1 inline-block rounded-full bg-ink/8 px-2 py-0.5 text-[10px] font-medium tracking-[0.04em] text-ink/55 uppercase">
              Public / anonymous
            </span>
          )}
        </div>
        <div>
          <p className="text-xs font-medium tracking-[0.04em] text-ink/40 uppercase">Club</p>
          <p className="mt-1.5 text-sm text-ink">{ticket.clubName ?? "—"}</p>
        </div>
        <div>{access === "manage" ? <CategoryControl ticketId={ticket.id} currentCategory={ticket.category} /> : <ReadOnlyCategory category={ticket.category} />}</div>
      </div>

      <p className="mt-3 text-xs text-ink/40">
        Created {new Date(ticket.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
      </p>

      <div className="mt-6 rounded-xl border border-ink/10 bg-white p-5">
        <p className="text-xs font-medium tracking-[0.04em] text-ink/40 uppercase">Original request (immutable)</p>
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
          <SupportTimeline events={events} viewerIsRequester={false} />
        </div>
      </div>

      {access === "manage" && ticket.status !== "closed" && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <ReplyToUserForm ticketId={ticket.id} />
          <InternalNoteForm ticketId={ticket.id} />
        </div>
      )}
      {access === "manage" && ticket.status === "closed" && (
        <div className="mt-6">
          <InternalNoteForm ticketId={ticket.id} />
        </div>
      )}
    </div>
  )
}

function ReadOnlyCategory({ category }: { category: SupportCategory }) {
  return (
    <>
      <p className="text-xs font-medium tracking-[0.04em] text-ink/40 uppercase">Category</p>
      <p className="mt-1.5 text-sm text-ink">{SUPPORT_CATEGORY_LABELS[category]}</p>
    </>
  )
}
