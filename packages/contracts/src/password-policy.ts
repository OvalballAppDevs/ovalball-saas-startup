/**
 * THE COMPOSITION RULES, WHERE BOTH CLIENTS CAN READ THEM.
 *
 * Phase 2 E's password rules were written once, correctly, in `lib/auth/password-policy.ts` -- and
 * that file is `server-only`, because it also holds the Have I Been Pwned check. The rules themselves
 * are not secret: they have to be SHOWN to somebody before they type, or the first they learn of the
 * capital letter is a rejection. So the composition half lives here, and the web's validator imports
 * it rather than keeping a second copy.
 *
 * THE MESSAGES MOVED WITH THE RULES, deliberately. A person who resets their password on the phone
 * and then on the website should be told the same thing in the same words; two wordings for one rule
 * is how a product starts sounding like two products.
 *
 * WHAT IS NOT HERE: the breach check. It needs a network call and a secret-free but server-shaped
 * boundary, and duplicating it into a React Native bundle is explicitly not wanted. `checkPassword`
 * in `lib/auth/password-policy.ts` remains the whole rule; this is its first half.
 *
 * BYTE LENGTH USES TextEncoder, not Buffer. bcrypt's limit is in bytes and an emoji costs four of
 * them, so measuring characters would let a password through that the credential store then quietly
 * truncates. `Buffer` does not exist in React Native; `TextEncoder` exists in both, and gives the
 * same answer.
 */

export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_BYTES = 72

export type PasswordCheck = { ok: true } | { ok: false; message: string }

/** The rules, in the order a person would hit them, so the first message is the most useful one. */
export function checkPasswordComposition(password: string): PasswordCheck {
  if (typeof password !== "string" || password.length === 0) {
    return { ok: false, message: "Enter a password." }
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: `Use at least ${PASSWORD_MIN_LENGTH} characters.` }
  }
  if (utf8Bytes(password) > PASSWORD_MAX_BYTES) {
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
 * The same rules, as a checklist a screen can show while somebody types.
 *
 * Derived from the same predicates rather than described alongside them: a list that says "one
 * capital letter" beside a validator that stopped requiring one is worse than no list.
 */
export interface PasswordRequirement {
  key: string
  label: string
  met: (password: string) => boolean
}

export const PASSWORD_REQUIREMENTS: PasswordRequirement[] = [
  {
    key: "length",
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    met: (p) => p.length >= PASSWORD_MIN_LENGTH && utf8Bytes(p) <= PASSWORD_MAX_BYTES,
  },
  { key: "capital", label: "One capital letter", met: (p) => /\p{Lu}/u.test(p) },
  { key: "special", label: "One special character, such as ! ? # or -", met: (p) => /[^\p{L}\p{N}\s]/u.test(p) },
]

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length
}
