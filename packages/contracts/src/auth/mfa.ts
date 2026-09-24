/**
 * MFA FACTOR RULES -- the same on both clients.
 *
 * The auth server holds the factors; these are the rules for reading them. They exist so the phone's
 * sign-in challenge and its step-up challenge choose the SAME factor by the SAME rule as the website,
 * and so "how many authenticators may a person hold" is one number rather than two.
 */

/** Mirrors `app/(app)/account/security/constants.ts` on the website, which now re-exports this. */
export const MAX_TOTP_FACTORS = 3

export type FactorLike = { id: string; status?: string | null; factor_type?: string | null; friendly_name?: string | null; created_at?: string | null }

/** A challenge is only ever issued against a VERIFIED TOTP factor. An unverified one is a half-finished enrolment. */
export function pickChallengeFactor<F extends FactorLike>(factors: readonly F[] | null | undefined): F | null {
  if (!factors) return null
  return factors.find((f) => (f.factor_type ?? "totp") === "totp" && f.status === "verified") ?? null
}

export function verifiedTotpFactors<F extends FactorLike>(factors: readonly F[] | null | undefined): F[] {
  return (factors ?? []).filter((f) => (f.factor_type ?? "totp") === "totp" && f.status === "verified")
}

export function staleTotpFactors<F extends FactorLike>(factors: readonly F[] | null | undefined): F[] {
  return (factors ?? []).filter((f) => (f.factor_type ?? "totp") === "totp" && f.status !== "verified")
}

/** Six digits, nothing else -- what a person types, not what the server accepts. */
export function normaliseTotpCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6)
}

export function isCompleteTotpCode(code: string): boolean {
  return /^\d{6}$/.test(code)
}

/** The website refuses removing the LAST verified factor: replace, don't remove. The phone agrees. */
export function canRemoveFactor(verifiedCount: number): boolean {
  return verifiedCount > 1
}

export function canAddFactor(verifiedCount: number): boolean {
  return verifiedCount < MAX_TOTP_FACTORS
}

/** A factor's display name, never its id and never anything the server did not say. */
export function factorLabel(factor: FactorLike, index: number): string {
  const name = factor.friendly_name?.trim()
  if (name) return name.replace(/\s*\([0-9a-z]{6,}\)$/i, "")
  return index === 0 ? "Authenticator" : `Authenticator ${index + 1}`
}
