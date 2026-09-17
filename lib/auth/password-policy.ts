import "server-only"

import { createHash } from "node:crypto"

/**
 * THE PASSWORD RULE, IN ONE PLACE, ON THE SERVER.
 *
 * Phase 2 L1 and E: at least 12 characters, at least one uppercase letter, at least one special
 * character, not a known-breached password. GoTrue enforces the LENGTH natively, and nothing else --
 * its nearest composition option (`lower_upper_letters_digits_symbols`) is a superset that also demands
 * a lowercase letter and a digit, which is a different rule. So the composition rule lives here.
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
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_BYTES } from "./password-policy-shared"

export type PasswordCheck = { ok: true } | { ok: false; message: string }

/** The rules, in the order a person would hit them, so the first message is the most useful one. */
export function checkPasswordComposition(password: string): PasswordCheck {
  if (typeof password !== "string" || password.length === 0) {
    return { ok: false, message: "Enter a password." }
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: `Use at least ${PASSWORD_MIN_LENGTH} characters.` }
  }
  // Byte length, not character length: an emoji or an accented letter costs more than one byte, and
  // bcrypt's limit is in bytes. Measuring characters here would let a password through that the
  // credential store would then quietly cut short.
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) {
    return { ok: false, message: "That password is too long. Use 72 bytes or fewer." }
  }
  if (!/\p{Lu}/u.test(password)) {
    return { ok: false, message: "Include at least one capital letter." }
  }
  // A special character is anything printable that is not a letter and not a digit. Defined by what it
  // is NOT, so that a person using a character Ovalball's authors did not think of is not told it does
  // not count.
  if (!/[^\p{L}\p{N}\s]/u.test(password)) {
    return { ok: false, message: "Include at least one special character, such as ! ? # or -." }
  }
  return { ok: true }
}

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
