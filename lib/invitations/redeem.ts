import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * THE ONLY PLACE THAT CALLS redeem_invitation.
 *
 * Redemption refuses by RETURNING rather than raising (decision D-S5-AUTO-2). It has to: the
 * function records every attempt into `invitation_redemption_attempts`, and a raised exception rolls
 * that record back, which silently defeated both the rate limits and the two events that exist to
 * show an invitation being probed by the wrong person.
 *
 * The consequence is a caller contract, and it is security-critical. A caller that ignores the
 * returned value, or treats an unrecognised value as success, hands out a membership or a role for an
 * invitation the database refused. Nothing about the call site makes that mistake obvious, because
 * the call itself succeeds.
 *
 * So there is exactly one caller, this module, and `scripts/verify-redemption-callers.mjs` fails the
 * build if any other module names the RPC. Everything else imports `redeemInvitation` and gets a
 * discriminated union it cannot use without looking.
 */

/** The outcomes the database returns for a redemption that actually did something. */
export const SUCCESSFUL_REDEMPTION_OUTCOMES = [
  "MEMBERSHIP_ACTIVE",
  "PENDING_CONFIRMATION",
  "JOIN_REQUEST_PENDING",
  "SITE_ADMIN_ACTIVE",
  "ACCOUNT_SETUP_CONFIRMED",
  "ACCEPTED",
  "ALREADY_REDEEMED",
] as const

export type SuccessfulRedemptionOutcome = (typeof SUCCESSFUL_REDEMPTION_OUTCOMES)[number]

export type RedemptionResult =
  | { ok: true; outcome: SuccessfulRedemptionOutcome; detail: Record<string, unknown> }
  | { ok: false; reason: string | null; message: string }

/**
 * The generic sentence every refusal shows. The database deliberately answers identically whether an
 * invitation was revoked, expired, already used or never existed, so somebody probing codes learns
 * nothing from the difference. We do not undo that in the UI.
 */
export const GENERIC_REFUSAL = "That invitation or code can't be used."

/** Reasons a person can act on. Anything else stays generic, so it cannot become an oracle. */
const ACTIONABLE_REASONS = new Set(["AGE_ELIGIBILITY_REQUIRED", "MEMBERSHIP_REQUIRED"])

export async function redeemInvitation(
  supabase: SupabaseClient,
  input: { token?: string | null; code?: string | null },
): Promise<RedemptionResult> {
  const { data, error } = await supabase.rpc("redeem_invitation", {
    p_token: input.token ?? null,
    p_code: input.code ?? null,
  })

  // A thrown error is still possible for the two conditions that legitimately raise: no session, and
  // nothing supplied. Fail closed.
  if (error) return { ok: false, reason: null, message: GENERIC_REFUSAL }

  const result = (data ?? {}) as Record<string, unknown>
  const outcome = typeof result.outcome === "string" ? result.outcome : null

  if (outcome && (SUCCESSFUL_REDEMPTION_OUTCOMES as readonly string[]).includes(outcome)) {
    return { ok: true, outcome: outcome as SuccessfulRedemptionOutcome, detail: result }
  }

  // Everything else -- REFUSED, an outcome this build does not recognise, or no outcome at all --
  // fails closed. An unrecognised outcome is the dangerous case: it means the database knows
  // something this build does not, and guessing is exactly how a refusal becomes an acceptance.
  const reason = typeof result.reason === "string" && ACTIONABLE_REASONS.has(result.reason) ? result.reason : null
  const message =
    reason && typeof result.message === "string" && result.message.length > 0 ? result.message : GENERIC_REFUSAL
  return { ok: false, reason, message }
}
