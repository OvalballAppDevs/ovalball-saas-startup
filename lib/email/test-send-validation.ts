import "server-only"

/**
 * Validates a "Send Test Email" destination -- exactly one explicit address,
 * nothing that could smuggle a second recipient or an injected header past a
 * provider that trusts this string.
 *
 * WHY THIS IS STRICTER THAN A NORMAL EMAIL FIELD
 *
 * This value reaches an HTTP request to a mail provider more or less
 * directly (see lib/email/send.ts#sendTestEmail). A newline is how a header
 * gets injected into a request that was not expecting one; a comma or a
 * second `@` is how "one test address" becomes "the operator just BCC'd
 * themselves into sending real people a test email". Rejecting the shape
 * outright is simpler and safer than trying to sanitise it.
 */
export type TestEmailValidation = { ok: true; email: string } | { ok: false; error: string }

const SIMPLE_EMAIL_PATTERN = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/

export function validateTestEmailDestination(raw: string): TestEmailValidation {
  if (typeof raw !== "string") return { ok: false, error: "Enter a test email address." }

  // Reject control characters (including \r\n, the header-injection vector)
  // before even trimming -- trimming would hide a newline sitting at either
  // end without removing one in the middle.
  if (/[\r\n\t\x00-\x1f]/.test(raw)) {
    return { ok: false, error: "That doesn't look like a single email address." }
  }

  const value = raw.trim()
  if (!value) return { ok: false, error: "Enter a test email address." }

  // Any of these means "more than one address, or a list" -- a test send is
  // exactly one destination, never a distribution list.
  if (/[,;]/.test(value) || /\s/.test(value)) {
    return { ok: false, error: "Enter exactly one email address -- not a list." }
  }

  if ((value.match(/@/g) ?? []).length !== 1) {
    return { ok: false, error: "That doesn't look like a single email address." }
  }

  if (!SIMPLE_EMAIL_PATTERN.test(value)) {
    return { ok: false, error: "Enter a valid email address." }
  }

  if (value.length > 254) {
    return { ok: false, error: "That address is too long." }
  }

  return { ok: true, email: value }
}
