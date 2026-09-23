import type { SupabaseClient } from "@supabase/supabase-js"
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_STATUS_LABEL,
  getMySupportConversations,
  type Database,
  type SupportCategory,
  type SupportConversationSummary,
} from "@ovalball/contracts"

import { friendly, logDetail } from "../errors/translate"

/**
 * SUPPORT — THE SAME PRODUCT, ON A PHONE.
 *
 * Ovalball has one support system: `support_tickets` with a
 * `support_ticket_events` thread, raised by `create_support_ticket`, continued
 * by `add_support_followup`, and read by `getMySupportConversations` -- which is
 * already in the shared package and already scoped the way the product intends:
 * "a support request is between one person and Ovalball. A Club Admin colleague
 * must not see it merely because it was raised from their club's context."
 *
 * So nothing here is a second support backend. This module is the app's reader
 * and writer over the canonical one, and the category list and every label come
 * from the shared vocabulary rather than being retyped.
 *
 * AVAILABLE TO EVERY AUTHENTICATED PERSON, by design. Support is the one
 * destination that is not capability-gated -- the website's own control says so:
 * "every authenticated user can reach Support regardless of role."
 */

type Client = SupabaseClient<Database>

export type { SupportConversationSummary, SupportCategory }
export { SUPPORT_CATEGORIES, SUPPORT_CATEGORY_LABELS, SUPPORT_STATUS_LABEL }

export async function loadMySupportTickets(supabase: Client, userId: string): Promise<SupportConversationSummary[]> {
  return getMySupportConversations(supabase, userId)
}

export type SupportResult = { ok: true; ticketId: string | null } | { ok: false; message: string }

/**
 * Raise a request.
 *
 * `p_source_route` is carried so support staff can see WHERE somebody was when
 * they asked -- which is most of the diagnosis on a phone, where a person cannot
 * paste a URL. It is a fact about the app, never an authority input.
 */
export async function raiseSupportTicket(
  supabase: Client,
  input: { category: SupportCategory; subject: string; description: string; sourceRoute?: string | null }
): Promise<SupportResult> {
  const subject = input.subject.trim()
  const description = input.description.trim()
  if (subject.length === 0) return { ok: false, message: "Give your request a subject." }
  if (description.length === 0) return { ok: false, message: "Tell us what is happening." }

  const { data, error } = await supabase.rpc("create_support_ticket", {
    p_category: input.category,
    p_subject: subject,
    p_description: description,
    p_source_route: input.sourceRoute ?? "mobile",
  })
  if (error) {
    const problem = friendly(error, "your support request")
    logDetail("support ticket", problem)
    return {
      ok: false,
      message: problem.message.startsWith("Couldn't load") ? "That request couldn't be sent. Try again." : problem.message,
    }
  }
  return { ok: true, ticketId: typeof data === "string" ? data : null }
}

export async function addSupportFollowUp(supabase: Client, ticketId: string, body: string): Promise<SupportResult> {
  const trimmed = body.trim()
  if (trimmed.length === 0) return { ok: false, message: "Write a reply before sending it." }
  const { error } = await supabase.rpc("add_support_followup", { p_ticket_id: ticketId, p_body: trimmed })
  if (error) {
    const problem = friendly(error, "your reply")
    logDetail("support follow-up", problem)
    return {
      ok: false,
      message: problem.message.startsWith("Couldn't load") ? "That reply couldn't be sent. Try again." : problem.message,
    }
  }
  return { ok: true, ticketId }
}
