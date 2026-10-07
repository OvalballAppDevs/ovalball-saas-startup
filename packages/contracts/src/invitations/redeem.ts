import type { SupabaseClient } from "@supabase/supabase-js"

import { teamCodeSubjectPayload, type TeamCodeSubject } from "../team/team-code"

/**
 * INVITATION REDEMPTION -- ONE INTERPRETATION FOR BOTH CLIENTS (CA-M11).
 *
 * `redeem_invitation` refuses BY RETURNING, not by raising. A caller that ignores the outcome, or
 * that guesses at one it does not recognise, turns a refusal into an acceptance. The website carried
 * this interpretation in `lib/invitations/redeem.ts` and a build-time guard made it the single caller
 * of the RPC. The phone needs the identical interpretation, so it moved here unchanged and the website
 * re-exports it: one success list, one generic refusal, one set of actionable reasons.
 *
 * WHAT THIS DOES NOT DO. It grants nothing. The database decides whether the invitation is live, whether
 * the signed-in address is the invited one, whether the issuer still holds their authority and what the
 * outcome is. This module only reads that answer without inventing a kinder one.
 */

export const SUCCESSFUL_REDEMPTION_OUTCOMES = [
  "MEMBERSHIP_ACTIVE",
  "PENDING_CONFIRMATION",
  "JOIN_REQUEST_PENDING",
  "BODY_ROLE_ACTIVE",
  "SITE_ADMIN_ACTIVE",
  "ACCOUNT_SETUP_CONFIRMED",
  "ACCEPTED",
  "ALREADY_REDEEMED",
  // Team codes place players (20270741000000): a request for a place on THAT team, still to be decided.
  "TEAM_PLACE_PENDING",
] as const

export type SuccessfulRedemptionOutcome = (typeof SUCCESSFUL_REDEMPTION_OUTCOMES)[number]

export type RedemptionResult =
  | { ok: true; outcome: SuccessfulRedemptionOutcome; detail: Record<string, unknown> }
  | { ok: false; reason: string | null; message: string; verdict: string | null }

/** One sentence for every refusal the person cannot act on, so a refusal is never an oracle. */
export const GENERIC_REFUSAL = "That invitation or code can't be used."

/**
 * Reasons a person can act on. Each tells the person something about THEMSELVES: the first three are
 * only reachable after their confirmed session email has been matched to the invited address; a team
 * code's (20270741000000) are about the person using it, a child they are the guardian of, or details
 * they have just typed -- never whether somebody else exists. Anything else is the generic refusal.
 */
export const ACTIONABLE_REASONS = [
  "AGE_ELIGIBILITY_REQUIRED",
  "MEMBERSHIP_REQUIRED",
  "ORGANISATION_ACCESS_SUSPENDED",
  "NOT_ELIGIBLE",
  "GUARDIAN_REQUIRED",
  "DETAILS_REQUIRED",
  "ALREADY_ON_TEAM",
  "ALREADY_USED",
] as const

const ACTIONABLE = new Set<string>(ACTIONABLE_REASONS)

/**
 * The pure half: what the database answered, read without guessing. Exported on its own so a test can
 * prove the fail-closed shape without a client.
 */
export function interpretRedemption(data: unknown, error: { message?: string } | null): RedemptionResult {
  if (error) return { ok: false, reason: null, message: GENERIC_REFUSAL, verdict: null }
  const result = (data && typeof data === "object" ? data : {}) as Record<string, unknown>
  const outcome = typeof result.outcome === "string" ? result.outcome : null
  if (outcome && (SUCCESSFUL_REDEMPTION_OUTCOMES as readonly string[]).includes(outcome)) {
    return { ok: true, outcome: outcome as SuccessfulRedemptionOutcome, detail: result }
  }
  // Everything else -- REFUSED, an outcome this build does not recognise, or no outcome at all --
  // fails closed. An unrecognised outcome is the dangerous case: the database knows something this
  // build does not, and guessing is exactly how a refusal becomes an acceptance.
  const reason = typeof result.reason === "string" && ACTIONABLE.has(result.reason) ? result.reason : null
  const message = reason && typeof result.message === "string" && result.message.length > 0 ? result.message : GENERIC_REFUSAL
  // The canonical fit verdict travels with NOT_ELIGIBLE, so a client says why in its own one set of words.
  const verdict = reason === "NOT_ELIGIBLE" && typeof result.verdict === "string" ? result.verdict : null
  return { ok: false, reason, message, verdict }
}

export async function redeemInvitation(
  supabase: SupabaseClient,
  input: { token?: string | null; code?: string | null; subject?: TeamCodeSubject | null }
): Promise<RedemptionResult> {
  const { data, error } = await supabase.rpc("redeem_invitation", {
    p_token: input.token ?? null,
    p_code: input.code ?? null,
    // Read by a team code alone: who it is being used for. Every other kind ignores it.
    p_subject: input.subject ? teamCodeSubjectPayload(input.subject) : null,
  })
  return interpretRedemption(data, error)
}

/**
 * WHERE AN ACCEPTED INVITATION LEADS, named without a URL so each client maps it to its own address.
 * Keyed by the success union: a new outcome cannot compile without a landing, and a landing cannot be
 * added without appearing in the success list.
 */
export type EntranceLandingKind = "HOME" | "PENDING" | "GOVERNING" | "SITE_ADMIN" | "ACCOUNT"

export type EntranceOutcome = {
  landing: EntranceLandingKind
  /** A context the client may adopt once the session context has been re-read -- never a grant. */
  contextKey: string | null
  /** The one sentence worth saying about what happens next, or nothing. */
  note: string | null
  /** The governing body, when the landing is GOVERNING. */
  bodyId: string | null
}

export function entranceOutcome(outcome: SuccessfulRedemptionOutcome, detail: Record<string, unknown>): EntranceOutcome {
  switch (outcome) {
    case "MEMBERSHIP_ACTIVE":
    case "ACCEPTED":
      return { landing: "HOME", contextKey: null, note: null, bodyId: null }
    case "PENDING_CONFIRMATION":
      return { landing: "PENDING", contextKey: null, note: "Accepted. Your club still has to confirm your role before it starts.", bodyId: null }
    case "JOIN_REQUEST_PENDING":
      return { landing: "PENDING", contextKey: null, note: "Request sent. You will get in once somebody at the club approves it.", bodyId: null }
    case "BODY_ROLE_ACTIVE": {
      const bodyId = typeof detail.constituent_body_id === "string" ? detail.constituent_body_id : null
      if (!bodyId) return { landing: "HOME", contextKey: null, note: null, bodyId: null }
      return { landing: "GOVERNING", contextKey: `governing:${bodyId}`, note: null, bodyId }
    }
    case "SITE_ADMIN_ACTIVE":
      return { landing: "SITE_ADMIN", contextKey: "site_admin", note: null, bodyId: null }
    case "ACCOUNT_SETUP_CONFIRMED":
      return { landing: "ACCOUNT", contextKey: null, note: null, bodyId: null }
    case "ALREADY_REDEEMED":
      return { landing: "HOME", contextKey: null, note: "You had already accepted that invitation, so there was nothing left to do.", bodyId: null }
    case "TEAM_PLACE_PENDING":
      return { landing: "PENDING", contextKey: null, note: teamPlacePendingNote(detail), bodyId: null }
  }
}

/** The one sentence after asking for a team place: who decides next, and nothing a probe could use. */
export function teamPlacePendingNote(detail: Record<string, unknown>): string {
  if (detail.awaiting_guardian === true && detail.awaiting_dispensation === true)
    return "Request sent. Your parent or guardian confirms it, the club decides the dispensation, then the team decides."
  if (detail.awaiting_guardian === true) return "Request sent. Your parent or guardian needs to confirm it, then the team decides."
  if (detail.awaiting_dispensation === true)
    return "Request sent. Asking is not approval: the club's Safeguarding Officer or a Club Admin decides the dispensation first, then the team decides."
  if (detail.under_review === true) return "Request sent. The club will check the details and let you know."
  if (detail.already === true) return "You've already asked. The team will let you know when it has decided."
  return "Request sent. The team will let you know when it has decided."
}
