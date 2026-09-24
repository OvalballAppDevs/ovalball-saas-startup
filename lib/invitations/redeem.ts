/**
 * THE ONLY PLACE THAT CALLS redeem_invitation -- now shared with the phone.
 *
 * `redeem_invitation` refuses BY RETURNING, not by raising, so a caller that ignores the outcome or
 * guesses at one it does not recognise turns a refusal into an acceptance. This module used to hold
 * the interpretation; CA-M11 moved it, unchanged, to `packages/contracts/src/invitations/redeem.ts`
 * so the phone reads the same answer the same way. The website keeps this path as its import, and the
 * build-time guard (`scripts/verify-redemption-callers.mjs`) still allows exactly one chokepoint --
 * the shared one -- plus this re-export.
 *
 * The contract keeps: SUCCESSFUL_REDEMPTION_OUTCOMES (explicit), GENERIC_REFUSAL (one sentence for
 * every refusal a person cannot act on) and a fail-closed `ok: false` for an unrecognised outcome.
 */
export {
  ACTIONABLE_REASONS,
  GENERIC_REFUSAL,
  SUCCESSFUL_REDEMPTION_OUTCOMES,
  interpretRedemption,
  redeemInvitation,
  type RedemptionResult,
  type SuccessfulRedemptionOutcome,
} from "@ovalball/contracts/invitations"
