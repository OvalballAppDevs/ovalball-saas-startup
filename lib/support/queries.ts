import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"
import type { SupportCategory, SupportStatus, SupportTicketEvent, SupportTicketSummary } from "./types"

export async function listMySupportTickets(supabase: SupabaseClient<Database>, userId: string): Promise<SupportTicketSummary[]> {
  const { data } = await supabase
    .from("support_tickets")
    .select("id, reference, category, subject, status, created_at, updated_at")
    .eq("created_by_user_id", userId)
    .order("updated_at", { ascending: false })

  return (data ?? []).map((r) => ({
    id: r.id,
    reference: r.reference,
    category: r.category as SupportCategory,
    subject: r.subject,
    status: r.status as SupportStatus,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
}

export interface SupportTicketDetail {
  id: string
  reference: string
  category: SupportCategory
  subject: string
  description: string
  status: SupportStatus
  origin: "authenticated" | "public"
  /** Null for a public-origin ticket -- there is no account to attribute it to. Use contactName/contactEmail instead. */
  createdByUserId: string | null
  contactName: string | null
  contactEmail: string | null
  createdAt: string
  updatedAt: string
  closedAt: string | null
  clubName: string | null
  relatedFixtureId: string | null
  relatedFixtureRequestId: string | null
  attachments: { id: string; fileName: string; mimeType: string; sizeBytes: number; storagePath: string }[]
}

export async function getSupportTicketDetail(supabase: SupabaseClient<Database>, ticketId: string): Promise<SupportTicketDetail | null> {
  const { data } = await supabase
    .from("support_tickets")
    .select(
      "id, reference, category, subject, description, status, origin, created_by_user_id, contact_name, contact_email, created_at, updated_at, closed_at, related_fixture_id, related_fixture_request_id, clubs(club_directory(name))"
    )
    .eq("id", ticketId)
    .maybeSingle()

  if (!data) return null

  const { data: attachments } = await supabase
    .from("support_ticket_attachments")
    .select("id, file_name, mime_type, size_bytes, storage_path")
    .eq("ticket_id", ticketId)

  return {
    id: data.id,
    reference: data.reference,
    category: data.category as SupportCategory,
    subject: data.subject,
    description: data.description,
    status: data.status as SupportStatus,
    origin: data.origin as "authenticated" | "public",
    createdByUserId: data.created_by_user_id,
    contactName: data.contact_name,
    contactEmail: data.contact_email,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    closedAt: data.closed_at,
    clubName: data.clubs?.club_directory?.name ?? null,
    relatedFixtureId: data.related_fixture_id,
    relatedFixtureRequestId: data.related_fixture_request_id,
    attachments: (attachments ?? []).map((a) => ({
      id: a.id,
      fileName: a.file_name,
      mimeType: a.mime_type,
      sizeBytes: a.size_bytes,
      storagePath: a.storage_path,
    })),
  }
}

/**
 * requesterName is the ONLY real identity this ever surfaces -- any event
 * authored by someone other than the ticket's own creator renders as
 * "Ovalball Support" (never a Site Admin's personal name), matching the
 * brief's identity rule. RLS on support_ticket_events already keeps
 * visibility=internal rows out of a plain requester's result set; this
 * just labels whatever visibility-filtered rows come back.
 *
 * createdByUserId is null for a public-origin ticket -- there is no
 * authenticated requester to match against, so its own 'created' event
 * (which submit_public_support_ticket() inserts with actor_user_id = null)
 * is the only row that can ever equal it, and correctly resolves to
 * requesterName (the contact name typed into the public form) rather than
 * "Ovalball Support".
 */
export async function getSupportTicketEvents(
  supabase: SupabaseClient<Database>,
  ticketId: string,
  createdByUserId: string | null,
  requesterName: string
): Promise<SupportTicketEvent[]> {
  const { data } = await supabase
    .from("support_ticket_events")
    .select("id, event_type, visibility, actor_user_id, body, metadata, created_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true })

  return (data ?? []).map((e) => ({
    id: e.id,
    eventType: e.event_type as SupportTicketEvent["eventType"],
    visibility: e.visibility as SupportTicketEvent["visibility"],
    actorUserId: e.actor_user_id,
    actorName: e.actor_user_id === createdByUserId ? requesterName : "Ovalball Support",
    body: e.body,
    metadata: (e.metadata as Record<string, unknown>) ?? {},
    createdAt: e.created_at,
  }))
}
