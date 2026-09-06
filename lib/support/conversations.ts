import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import type { SupportStatus } from "./types"

/**
 * Support threads, shaped for the Messages surfaces.
 *
 * This exists because of a real, reported gap: a support request never
 * appeared in Messages, for either party. The cause was not a missing
 * conversation -- support has always had one -- but that Messages read only
 * fixture and club conversations, so the canonical support thread lived
 * exclusively behind the Support surfaces.
 *
 * The fix is deliberately a READ MODEL, not a migration. `support_tickets`
 * (the case) plus `support_ticket_events` (the thread) already are the
 * canonical support conversation, with `visibility` enforced in RLS so an
 * internal note can never reach a requester. Re-homing support onto
 * `fixture_messages` would have created exactly the second, disconnected
 * message store the brief forbids, thrown away the internal/requester
 * visibility guarantee, and forced "Ovalball Support" into club-to-club
 * conversation architecture that has no party for it -- which is precisely
 * why 20260901120000_support_tickets.sql modelled it separately in the
 * first place.
 *
 * So: nothing is duplicated. Messages gains a view of the same rows the
 * Support pages read, and every reply continues to go through the same two
 * RPCs (`add_support_followup`, `send_support_reply`) into the same
 * `support_ticket_events` thread.
 */
export interface SupportConversationSummary {
  ticketId: string
  reference: string
  subject: string
  status: SupportStatus
  /** Null for a public-origin ticket, which has no account behind it. */
  requesterUserId: string | null
  clubName: string | null
  latestPreview: string | null
  latestAt: string | null
  /** Who spoke last, already resolved to the presentation identity. */
  latestFrom: "requester" | "support" | null
}

const REQUESTER_VISIBLE_EVENTS = ["created", "requester_message", "support_reply"]

/**
 * Every support thread the signed-in person legitimately participates in.
 *
 * Scoped by `created_by_user_id`, not by club: a support request is between
 * one person and Ovalball. A Club Admin colleague must not see it merely
 * because it was raised from their club's context -- participation is the
 * requester's, deliberately, and RLS enforces the same thing underneath.
 */
export async function getMySupportConversations(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<SupportConversationSummary[]> {
  const { data: tickets, error } = await supabase
    .from("support_tickets")
    .select("id, reference, subject, description, status, created_by_user_id, updated_at, clubs(club_directory(name))")
    .eq("created_by_user_id", userId)
    .order("updated_at", { ascending: false })

  if (error || !tickets || tickets.length === 0) return []

  return attachLatest(supabase, tickets)
}

/**
 * Every support thread, for Site Admin support staff.
 *
 * Authorization is NOT assumed from context: the caller checks
 * `can_manage_support` first, and RLS refuses regardless. Internal notes are
 * excluded from the preview even for admins, so the Messages list shows the
 * conversation both parties can see rather than leaking an internal note
 * into a list view.
 */
export async function getSupportConversationsForAdmin(
  supabase: SupabaseClient<Database>,
  limit = 25
): Promise<SupportConversationSummary[]> {
  const { data: tickets, error } = await supabase
    .from("support_tickets")
    .select("id, reference, subject, description, status, created_by_user_id, updated_at, clubs(club_directory(name))")
    .order("updated_at", { ascending: false })
    .limit(limit)

  if (error || !tickets || tickets.length === 0) return []

  return attachLatest(supabase, tickets)
}

type TicketRow = {
  id: string
  reference: string
  subject: string
  description: string
  status: string
  created_by_user_id: string | null
  updated_at: string
  clubs: { club_directory: { name: string } | null } | null
}

async function attachLatest(
  supabase: SupabaseClient<Database>,
  tickets: TicketRow[]
): Promise<SupportConversationSummary[]> {
  const ids = tickets.map((t) => t.id)

  // One batched read for every thread's visible events, then reduced in
  // memory -- never a query per ticket.
  const { data: events } = await supabase
    .from("support_ticket_events")
    .select("ticket_id, event_type, actor_user_id, body, created_at")
    .in("ticket_id", ids)
    .eq("visibility", "requester")
    .in("event_type", REQUESTER_VISIBLE_EVENTS)
    .order("created_at", { ascending: false })

  const latest = new Map<string, { body: string | null; at: string; actor: string | null; type: string }>()
  for (const e of events ?? []) {
    if (!latest.has(e.ticket_id)) {
      latest.set(e.ticket_id, { body: e.body, at: e.created_at, actor: e.actor_user_id, type: e.event_type })
    }
  }

  return tickets.map((t) => {
    const l = latest.get(t.id)
    return {
      ticketId: t.id,
      reference: t.reference,
      subject: t.subject,
      status: t.status as SupportStatus,
      requesterUserId: t.created_by_user_id,
      clubName: t.clubs?.club_directory?.name ?? null,
      // The `created` event is a marker with a null body: the request text
      // itself is support_tickets.description, which is immutable case
      // history. Falling back to it shows the opening message rather than
      // "no messages yet" on a thread that plainly has one -- reading the
      // same canonical row, never copying it anywhere.
      latestPreview: l?.body ?? (l?.type === "created" ? t.description : null) ?? t.description,
      latestAt: l?.at ?? t.updated_at,
      latestFrom: l ? (l.type === "support_reply" ? "support" : "requester") : null,
    }
  })
}

/** The label a support thread carries in Messages. Never a bare status code. */
export const SUPPORT_STATUS_LABEL: Record<SupportStatus, string> = {
  new: "Open",
  in_progress: "With Ovalball",
  closed: "Resolved",
}
