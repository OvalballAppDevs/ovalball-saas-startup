import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

/**
 * Server-authoritative recipient resolution.
 *
 * THE BUG THIS EXISTS TO MAKE IMPOSSIBLE
 *
 * The safeguarding "message the officer" action once accepted an officer id,
 * swallowed the database's refusal, and then emailed the caller's own text to
 * an address the caller supplied -- reporting success. That is an
 * authenticated open mail relay. It was fixed in that one action, but the
 * shape that allowed it survived everywhere else: a dispatcher whose
 * signature includes `to`.
 *
 * So there is no `to`. A caller names an ENTITY it is already authorized to
 * act on, and the resolver reads that entity's canonical contact from the
 * database THROUGH THE CALLER'S OWN SESSION -- so RLS applies, and a caller
 * who cannot see the record cannot mail it either. The address is never an
 * input.
 *
 * Two consequences worth stating plainly:
 *
 *   * An invitation address IS legitimately chosen by the inviter -- that is
 *     what inviting means. But it is chosen when the invitation ROW is
 *     created, under that RPC's own authorization, and read back from the row
 *     here. The email cannot be aimed somewhere the invitation is not.
 *   * A resolver returning nothing is a refusal, never a fallback. Nothing in
 *     this file "tries the next best address".
 *
 * Resolution returns a LIST because some canonical audiences are genuinely
 * plural -- Ovalball billing mail goes to a club's active Club Admins, which
 * is the same audience the in-app billing notification already targets.
 * Returning one address there would have meant inventing a "primary" admin
 * the product does not define.
 */

export type RecipientRef =
  | { kind: "club_invitation"; invitationId: string }
  | { kind: "guardian_invitation"; invitationId: string }
  | { kind: "player_account_invitation"; invitationId: string }
  | { kind: "safeguarding_officer"; officerId: string }
  | { kind: "site_admin_invitation"; invitationId: string }
  | { kind: "site_admin_inbox" }
  | { kind: "support_ticket"; ticketId: string }
  | { kind: "partner_invitation"; invitationId: string }
  | { kind: "club_billing_contact"; clubId: string }

export interface ResolvedRecipient {
  email: string
  /** The canonical row the address came from, recorded in the delivery ledger. */
  ref: string | null
  clubId: string | null
  /** Set when the recipient is a known Ovalball user, so a topic preference can be consulted. */
  userId: string | null
}

export type RecipientResolution =
  | { ok: true; recipients: ResolvedRecipient[] }
  | { ok: false; reason: string }

/**
 * Where due-diligence mail goes. A single named config value, deliberately
 * not a literal anywhere in application logic.
 */
export function getSiteAdminNotificationEmail(): string | null {
  const value = process.env.SITE_ADMIN_NOTIFICATION_EMAIL?.trim()
  return value ? value : null
}

function one(
  email: string | null | undefined,
  ref: string | null,
  clubId: string | null,
  userId: string | null = null
): RecipientResolution {
  const trimmed = email?.trim()
  if (!trimmed) return { ok: false, reason: "No contact address is recorded for this recipient." }
  return { ok: true, recipients: [{ email: trimmed, ref, clubId, userId }] }
}

export async function resolveRecipients(
  supabase: SupabaseClient<Database>,
  ref: RecipientRef
): Promise<RecipientResolution> {
  switch (ref.kind) {
    case "club_invitation": {
      const { data, error } = await supabase
        .from("invitations")
        .select("id, invited_email, club_id")
        .eq("id", ref.invitationId)
        .maybeSingle()
      if (error) return { ok: false, reason: `Invitation could not be read: ${error.message}` }
      if (!data) return { ok: false, reason: "That invitation could not be found." }
      return one(data.invited_email, data.id, data.club_id)
    }

    case "guardian_invitation": {
      const { data, error } = await supabase
        .from("guardian_invitations")
        .select("id, invited_email, club_id")
        .eq("id", ref.invitationId)
        .maybeSingle()
      if (error) return { ok: false, reason: `Invitation could not be read: ${error.message}` }
      if (!data) return { ok: false, reason: "That invitation could not be found." }
      return one(data.invited_email, data.id, data.club_id)
    }

    case "player_account_invitation": {
      const { data, error } = await supabase
        .from("player_account_invitations")
        .select("id, invited_email")
        .eq("id", ref.invitationId)
        .maybeSingle()
      if (error) return { ok: false, reason: `Invitation could not be read: ${error.message}` }
      if (!data) return { ok: false, reason: "That invitation could not be found." }
      return one(data.invited_email, data.id, null)
    }

    case "safeguarding_officer": {
      // The assignment's OWN recorded contact -- the club wrote it when it
      // named its officer, under that action's authorization. Read under the
      // caller's session, so someone who cannot see the officer record
      // cannot cause mail to it.
      const { data, error } = await supabase
        .from("club_safeguarding_officers")
        .select("id, contact_email, club_id")
        .eq("id", ref.officerId)
        .maybeSingle()
      if (error) return { ok: false, reason: `Safeguarding Officer could not be read: ${error.message}` }
      if (!data) return { ok: false, reason: "That Safeguarding Officer record could not be found." }
      return one(data.contact_email, data.id, data.club_id)
    }

    case "site_admin_invitation": {
      const { data, error } = await supabase
        .from("site_admin_invitations")
        .select("id, invited_email")
        .eq("id", ref.invitationId)
        .maybeSingle()
      if (error) return { ok: false, reason: `Invitation could not be read: ${error.message}` }
      if (!data) return { ok: false, reason: "That invitation could not be found." }
      return one(data.invited_email, data.id, null)
    }

    case "partner_invitation": {
      const { data, error } = await supabase
        .from("club_ovalball_invitations")
        .select("id, contact_email, inviting_club_id")
        .eq("id", ref.invitationId)
        .maybeSingle()
      if (error) return { ok: false, reason: `Invitation could not be read: ${error.message}` }
      if (!data) return { ok: false, reason: "That invitation could not be found." }
      return one(data.contact_email, data.id, data.inviting_club_id)
    }

    case "support_ticket": {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("id, contact_email, origin, club_id")
        .eq("id", ref.ticketId)
        .maybeSingle()
      if (error) return { ok: false, reason: `Support ticket could not be read: ${error.message}` }
      if (!data) return { ok: false, reason: "That support ticket could not be found." }
      // Only a public requester is emailed. A club-raised ticket is read in
      // the app by someone who has an account, and mailing the reply out
      // would send support correspondence to an address the ticket recorded
      // for a different purpose.
      if (data.origin !== "public") {
        return { ok: false, reason: "This ticket was raised in-app, so the reply is read in Ovalball." }
      }
      return one(data.contact_email, data.id, data.club_id)
    }

    case "club_billing_contact": {
      // The SAME audience internal.notify_club_platform_billing already
      // targets in-app: the club's active, non-suspended Club Admins. There
      // is no billing_email column anywhere in this schema, and inventing a
      // "primary billing contact" would be inventing product.
      // Two plain reads rather than a nested embed: the embed depends on
      // PostgREST relationship detection and on RLS for both tables, and a
      // failure there is indistinguishable from "this club has no admins".
      const { data: members, error } = await supabase
        .from("club_memberships")
        .select("user_id, club_id")
        .eq("club_id", ref.clubId)
        .eq("status", "active")
        .eq("role", "CLUB_ADMIN")
        .eq("authority_suspended", false)
      if (error) return { ok: false, reason: `Club administrators could not be read: ${error.message}` }

      const userIds = (members ?? []).map((m) => m.user_id)
      if (userIds.length === 0) {
        return { ok: false, reason: "This club has no active Club Admin to notify." }
      }

      const { data: profiles, error: profileError } = await supabase
        .from("profiles")
        .select("id, email")
        .in("id", userIds)
      if (profileError) {
        return { ok: false, reason: `Club administrator contacts could not be read: ${profileError.message}` }
      }

      const recipients = (profiles ?? [])
        .map((p) => ({
          email: p.email?.trim() ?? "",
          ref: null,
          clubId: ref.clubId,
          userId: p.id,
        }))
        .filter((r) => r.email.length > 0)

      if (recipients.length === 0) {
        return { ok: false, reason: "This club has no active Club Admin with a contact address." }
      }
      return { ok: true, recipients }
    }

    case "site_admin_inbox": {
      const inbox = getSiteAdminNotificationEmail()
      if (!inbox) {
        return { ok: false, reason: "SITE_ADMIN_NOTIFICATION_EMAIL is not configured." }
      }
      return one(inbox, null, null)
    }
  }
}
