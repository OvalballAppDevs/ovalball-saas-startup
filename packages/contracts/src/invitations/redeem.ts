import type { SupabaseClient } from "@supabase/supabase-js"

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
] as const

export type SuccessfulRedemptionOutcome = (typeof SUCCESSFUL_REDEMPTION_OUTCOMES)[number]

export type RedemptionResult =
  | { ok: true; outcome: SuccessfulRedemptionOutcome; detail: Record<string, unknown> }
  | { ok: false; reason: string | null; message: string }

/** One sentence for every refusal the person cannot act on, so a refusal is never an oracle. */
export const GENERIC_REFUSAL = "That invitation or code can't be used."

/**
 * Reasons a person can act on. Each is only reachable AFTER the redeemer's confirmed session email has
 * been matched to the invited address, so each tells the invited person something about themselves.
 */
export const ACTIONABLE_REASONS = ["AGE_ELIGIBILITY_REQUIRED", "MEMBERSHIP_REQUIRED", "ORGANISATION_ACCESS_SUSPENDED"] as const

const ACTIONABLE = new Set<string>(ACTIONABLE_REASONS)

/**
 * The pure half: what the database answered, read without guessing. Exported on its own so a test can
 * prove the fail-closed shape without a client.
 */
export function interpretRedemption(data: unknown, error: { message?: string } | null): RedemptionResult {
  if (error) return { ok: false, reason: null, message: GENERIC_REFUSAL }
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
  return { ok: false, reason, message }
}

export async function redeemInvitation(
  supabase: SupabaseClient,
  input: { token?: string | null; code?: string | null }
): Promise<RedemptionResult> {
  const { data, error } = await supabase.rpc("redeem_invitation", {
    p_token: input.token ?? null,
    p_code: input.code ?? null,
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
  }
}
