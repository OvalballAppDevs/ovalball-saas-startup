import "server-only"

import { createHash } from "node:crypto"

/**
 * THE PASSWORD RULE, IN ONE PLACE, ON THE SERVER.
 *
 * Phase 2 L1 and E: at least 12 characters, at least one uppercase letter, at least one special
 * character, not a known-breached password. GoTrue enforces the LENGTH natively, and nothing else --
 * its nearest composition option (`lower_upper_letters_digits_symbols`) is a superset that also demands
 * a lowercase letter and a digit, which is a different rule.
 *
 * The composition half now lives in `packages/contracts` so the mobile app applies the same rules with
 * the same wording; this module is still THE WHOLE RULE, because it adds the breach check that the
 * shared package deliberately does not carry.
 *
 * THE BROWSER IS NOT THE AUTHORITY. This module is `server-only` on purpose: a validator that can be
 * imported into a client bundle is a validator somebody will eventually rely on there, and a rule that
 * runs only in the browser is advice. Every Ovalball surface that sets a password calls this first.
 *
 * WHAT IS NEVER DONE HERE: the password is never logged, never stored, never sent anywhere, and never
 * hashed for storage. The only hash taken is a SHA-1 prefix for the breach check below, which is how
 * that protocol works and is discarded immediately.
 */

/** Phase 2 E. 72 bytes is bcrypt's limit; a longer password is REFUSED, never silently truncated. */
export { PASSWORD_MIN_LENGTH, PASSWORD_MAX_BYTES } from "./password-policy-shared"

import { checkPasswordComposition, type PasswordCheck } from "@ovalball/contracts/password-policy"

export { checkPasswordComposition }
export type { PasswordCheck }

/**
 * Have I Been Pwned, by k-anonymity: only the first five characters of the SHA-1 are ever sent, and the
 * response is a list of suffixes to match locally. The password itself never leaves this process.
 *
 * FAILS CLOSED IN PRODUCTION. If the range API cannot be reached, a development machine carries on --
 * an offline laptop should not block work -- but production refuses, because "we could not check"
 * silently becoming "it is fine" is how a breached password gets accepted.
 */
export async function isBreachedPassword(password: string): Promise<{ breached: boolean; checked: boolean }> {
  const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase()
  const prefix = sha1.slice(0, 5)
  const suffix = sha1.slice(5)

  try {
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(4000),
    })
    if (!response.ok) return { breached: false, checked: false }
    const body = await response.text()
    for (const line of body.split("\n")) {
      const [candidate, count] = line.trim().split(":")
      if (candidate === suffix && Number(count) > 0) return { breached: true, checked: true }
    }
    return { breached: false, checked: true }
  } catch {
    return { breached: false, checked: false }
  }
}

/** The whole rule. Everything that sets a password on Ovalball goes through this. */
export async function checkPassword(password: string): Promise<PasswordCheck> {
  const composition = checkPasswordComposition(password)
  if (!composition.ok) return composition

  const { breached, checked } = await isBreachedPassword(password)
  if (breached) {
    return {
      ok: false,
      message: "That password has appeared in a known data breach. Choose a different one.",
    }
  }
  if (!checked && process.env.NODE_ENV === "production") {
    return { ok: false, message: "We couldn't check that password right now. Please try again." }
  }
  return { ok: true }
}
