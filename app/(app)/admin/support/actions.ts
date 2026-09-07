"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { sendEmailEvent } from "@/lib/email/send"
import { supportAccessLevel } from "@/lib/support/access"
import { SUPPORT_CATEGORY_LABELS, SUPPORT_STATUS_LABELS, type SupportCategory, type SupportStatus } from "@/lib/support/types"
import { getSessionContext } from "@/lib/app-context/session-context"

import type { AdminSupportQuery } from "./query"

export type SimpleActionResult = { ok: true } | { ok: false; error: string }

/**
 * A public-origin ticket has no account, so there is no in-app
 * notification path for it -- update_support_ticket_status/send_support_reply
 * both correctly skip the notifications insert for one (see
 * 20260901140000). The only channel the public form actually promised
 * ("we'll reply to your email") is email, so this app-layer step is the
 * other half of that promise: real for an authenticated ticket (handled by
 * the in-app notification already), and this dev-no-op-logged dispatch for
 * a public one, sent through lib/email/send.ts. Whether a provider is
 * configured decides whether it leaves the machine; the attempt is recorded
 * either way in email_deliveries.
 */
async function notifyPublicRequesterIfApplicable(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ticketId: string,
  body: string
) {
  const { data: ticket } = await supabase
    .from("support_tickets")
    .select("reference, subject")
    .eq("id", ticketId)
    .maybeSingle()
  if (!ticket) return

  // The occurrence is the REPLY, not the ticket. Keying on the ticket would
  // deliver the first reply and then silently swallow every later one --
  // idempotency suppressing legitimate follow-ups instead of retries.
  const { data: latestEvent } = await supabase
    .from("support_ticket_events")
    .select("id")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!latestEvent) return

  // Whether this ticket's requester may be emailed at all is decided by the
  // resolver, which refuses a club-raised ticket. That check lives in one
  // place rather than at every call site that might one day send a reply.
  await sendEmailEvent({
    supabase,
    eventKey: "support_ticket_reply",
    idempotencyKey: `support_ticket_reply:${latestEvent.id}`,
    recipient: { kind: "support_ticket", ticketId },
    data: { reference: ticket.reference, subject: ticket.subject, body },
  })
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * Safe fields only, matching the brief exactly: reference/status/category/
 * subject/club/raised-by/origin/created/updated/closed. Deliberately never
 * includes description, internal notes, attachments, or contact_email --
 * this is an operational export for triage and reporting, not a data dump
 * of the underlying request bodies. Respects whatever filters the caller
 * currently has applied (same query shape the grid itself uses), not
 * always "export everything".
 */
export async function exportSupportTicketsCsv(query: AdminSupportQuery): Promise<{ ok: true; csv: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not authorized." }
  const ctx = await getSessionContext(supabase, user)
  if (supportAccessLevel(ctx) === "none") return { ok: false, error: "Not authorized." }

  let q = supabase
    .from("support_tickets")
    .select("reference, status, category, subject, origin, created_by_user_id, contact_name, created_at, updated_at, closed_at, clubs(club_directory(name))")

  if (query.status !== "all") q = q.eq("status", query.status)
  if (query.category) q = q.eq("category", query.category)
  if (query.origin !== "all") q = q.eq("origin", query.origin)
  if (query.q.length >= 2) {
    const escaped = query.q.replace(/[%_]/g, (c) => `\\${c}`)
    q = q.or(`reference.ilike.%${escaped}%,subject.ilike.%${escaped}%`)
  }

  const { data } = await q.order("updated_at", { ascending: false })
  const rows = data ?? []

  const raisedByIds = Array.from(new Set(rows.map((r) => r.created_by_user_id).filter((id): id is string => id !== null)))
  const { data: profiles } =
    raisedByIds.length > 0 ? await supabase.from("profiles").select("id, first_name, surname").in("id", raisedByIds) : { data: [] }
  const nameById = new Map((profiles ?? []).map((p) => [p.id, [p.first_name, p.surname].filter(Boolean).join(" ") || "Ovalball user"]))

  const header = ["Reference", "Status", "Category", "Subject", "Club", "Raised By", "Origin", "Created", "Updated", "Closed"]
  const lines = [header.map(csvCell).join(",")]

  for (const r of rows) {
    const raisedBy = r.created_by_user_id ? (nameById.get(r.created_by_user_id) ?? "Ovalball user") : (r.contact_name ?? "—")
    lines.push(
      [
        r.reference,
        SUPPORT_STATUS_LABELS[r.status as SupportStatus] ?? r.status,
        SUPPORT_CATEGORY_LABELS[r.category as SupportCategory] ?? r.category,
        r.subject,
        r.clubs?.club_directory?.name ?? "",
        raisedBy,
        r.origin === "public" ? "Public / anonymous" : "Authenticated",
        r.created_at,
        r.updated_at,
        r.closed_at ?? "",
      ]
        .map(csvCell)
        .join(",")
    )
  }

  return { ok: true, csv: lines.join("\n") }
}

export async function sendSupportReply(ticketId: string, body: string): Promise<SimpleActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("send_support_reply", { p_ticket_id: ticketId, p_body: body })
  if (error) return { ok: false, error: error.message }
  await notifyPublicRequesterIfApplicable(supabase, ticketId, body)
  revalidatePath(`/admin/support/${ticketId}`)
  return { ok: true }
}

export async function addInternalNote(ticketId: string, body: string): Promise<SimpleActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("add_support_internal_note", { p_ticket_id: ticketId, p_body: body })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/admin/support/${ticketId}`)
  return { ok: true }
}

export async function updateSupportTicketCategory(ticketId: string, newCategory: string): Promise<SimpleActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("update_support_ticket_category", { p_ticket_id: ticketId, p_new_category: newCategory })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/admin/support/${ticketId}`)
  revalidatePath("/admin/support")
  return { ok: true }
}

export async function updateSupportTicketStatus(
  ticketId: string,
  newStatus: "new" | "in_progress" | "closed",
  userMessage?: string,
  internalNote?: string
): Promise<SimpleActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("update_support_ticket_status", {
    p_ticket_id: ticketId,
    p_new_status: newStatus,
    p_user_message: userMessage || undefined,
    p_internal_note: internalNote || undefined,
  })
  if (error) return { ok: false, error: error.message }
  if (userMessage && userMessage.trim().length > 0) {
    await notifyPublicRequesterIfApplicable(supabase, ticketId, userMessage)
  }
  revalidatePath(`/admin/support/${ticketId}`)
  revalidatePath("/admin/support")
  return { ok: true }
}
