/**
 * Central place that turns a raw Supabase Auth/PostgREST/RPC error into
 * text safe to show a user. Nothing outside this file should put
 * `error.message` (or any Postgres/GoTrue error field) directly into UI --
 * that's how a user ends up seeing a SQLSTATE, a constraint name, a raw
 * "new row violates row-level security policy for table \"club_claims\""
 * string, or an RLS/RPC implementation detail useful for probing the
 * schema. Every call site in the unauthenticated/authentication surface
 * (signup, login/resend, invitation acceptance) routes its error through
 * one of the functions below instead of improvising its own fallback
 * string, so the actual set of things a user can ever see stays a small,
 * reviewed list -- not whatever Postgres happened to say this time.
 *
 * The raw error is still there for the caller to log server-side
 * (`console.error`, safe -- server logs aren't user-facing) before calling
 * these; nothing here silently swallows information that's useful for
 * debugging, it only stops that information from reaching the browser.
 */

interface RawErrorLike {
  message?: string
  code?: string | number | null
  status?: number | null
}

const RATE_LIMIT_CODES = new Set(["over_email_send_rate_limit", "over_request_rate_limit"])
const VALIDATION_CODES = new Set(["validation_failed", "email_address_invalid", "bad_json", "email_provider_disabled"])

function isRateLimited(error: RawErrorLike): boolean {
  const code = error.code == null ? "" : String(error.code)
  return RATE_LIMIT_CODES.has(code) || error.status === 429
}

function isBadInput(error: RawErrorLike): boolean {
  const code = error.code == null ? "" : String(error.code)
  return VALIDATION_CODES.has(code) || error.status === 422
}

/**
 * signInWithOtp failures -- both the login form's "send me a sign-in link"
 * and the signup wizard's final "send the confirmation email" call end up
 * here. `context` only changes the generic fallback's wording; rate-limit
 * and validation messages read the same regardless of which flow hit them.
 */
export function toPublicAuthError(error: RawErrorLike, context: "sign_in" | "signup"): string {
  if (isRateLimited(error)) {
    return "Too many attempts. Please wait a moment and try again."
  }
  if (isBadInput(error)) {
    return "That email address doesn't look right. Please check it and try again."
  }
  return context === "sign_in"
    ? "We couldn't send the sign-in email right now. Please try again."
    : "We couldn't send your confirmation email right now. Please try again."
}

/**
 * accept_invitation (20260831091000_invitations.sql) is a SECURITY DEFINER
 * function that already raises deliberately human-readable, non-sensitive
 * exception text for every failure mode it anticipates -- "Invitation has
 * expired.", "This invitation was sent to a different email address...",
 * etc. Those are safe (and better UX) to show verbatim, so this allowlists
 * them by prefix (their text can interpolate a value, e.g. "...current
 * status: %.", so exact-match isn't possible). Anything NOT on this list --
 * a raw driver error, an RLS rejection that reached the client without a
 * deliberate raise exception, a constraint violation -- was never written
 * to be user-facing and falls back to the generic message instead of
 * being shown.
 */
const SAFE_INVITATION_ERROR_PREFIXES = [
  "Invitation not found.",
  "Invitation is not pending",
  "Invitation has expired.",
  "This invitation was sent to a different email address",
  "You must be signed in to accept an invitation.",
]

export function toPublicInvitationError(error: RawErrorLike): string {
  const message = error.message ?? ""
  if (SAFE_INVITATION_ERROR_PREFIXES.some((prefix) => message.startsWith(prefix))) {
    return message
  }
  return "We couldn't accept this invitation right now. Please try again, or ask for a new invite link."
}

/** Same allowlist reasoning as toPublicInvitationError, for accept_site_admin_invitation()'s own deliberately human-readable exception text (20260831260000_site_admin_management.sql). */
const SAFE_SITE_ADMIN_INVITATION_ERROR_PREFIXES = [
  "You must be signed in to accept this invitation.",
  "Invitation not found.",
  "Invitation is not pending",
  "Invitation has expired.",
  "This invitation was sent to a different email address",
]

export function toPublicSiteAdminInvitationError(error: RawErrorLike): string {
  const message = error.message ?? ""
  if (SAFE_SITE_ADMIN_INVITATION_ERROR_PREFIXES.some((prefix) => message.startsWith(prefix))) {
    return message
  }
  return "We couldn't accept this invitation right now. Please try again, or ask for a new invite link."
}

/** Same allowlist reasoning as toPublicInvitationError, for accept_guardian_invitation()'s own deliberately human-readable exception text (Side Project 1 integration). */
const SAFE_GUARDIAN_INVITATION_ERROR_PREFIXES = ["Invitation not found.", "This invitation is no longer available.", "This invitation has expired.", "This invitation was sent to a different email address"]

export function toPublicGuardianInvitationError(error: RawErrorLike): string {
  const message = error.message ?? ""
  if (SAFE_GUARDIAN_INVITATION_ERROR_PREFIXES.some((prefix) => message.startsWith(prefix))) {
    return message
  }
  return "We couldn't accept this invitation right now. Please try again, or ask for a new invite link."
}

/** Same allowlist reasoning, for create_player_for_guardian()'s own deliberately human-readable exception text. */
const SAFE_PLAYER_CREATION_ERROR_PREFIXES = ["Invitation not found.", "You do not have an accepted invitation for this team.", "First name and surname are required."]

export function toPublicPlayerCreationError(error: RawErrorLike): string {
  const message = error.message ?? ""
  if (SAFE_PLAYER_CREATION_ERROR_PREFIXES.some((prefix) => message.startsWith(prefix))) {
    return message
  }
  return "We couldn't add this player right now. Please try again."
}

/**
 * Same allowlist reasoning, for add_child_for_guardian()'s own
 * deliberately human-readable exception text (self-service Add-a-Child).
 * An unexpected failure (e.g. a stale/invalid session) must never fall
 * through to this RPC's raw Postgres message reaching the browser verbatim.
 */
const SAFE_ADD_CHILD_ERROR_PREFIXES = [
  "You must be signed in.",
  "First name and surname are required.",
  "Date of birth is required.",
  "Club not found.",
  "No active season is currently configured",
  "This date of birth is below the youngest supported youth age grade",
  "This date of birth is outside the supported youth age-grade range",
  "We found more than one possible existing match for this player",
]

export function toPublicAddChildError(error: RawErrorLike): string {
  const message = error.message ?? ""
  if (SAFE_ADD_CHILD_ERROR_PREFIXES.some((prefix) => message.startsWith(prefix))) {
    return message
  }
  return "We couldn't add this child right now. Please sign out and back in, then try again."
}

/** Same allowlist reasoning, for invite_player_account()'s own deliberately human-readable exception text. */
const SAFE_PLAYER_ACCOUNT_INVITE_ERROR_PREFIXES = [
  "You are not authorized to invite a login for this player.",
  "A valid email address is required.",
  "This player already has their own Ovalball login.",
  "A login invitation is already pending for this player.",
]

export function toPublicPlayerAccountInviteError(error: RawErrorLike): string {
  const message = error.message ?? ""
  if (SAFE_PLAYER_ACCOUNT_INVITE_ERROR_PREFIXES.some((prefix) => message.startsWith(prefix))) {
    return message
  }
  return "We couldn't send this invitation right now. Please try again."
}

/** Same allowlist reasoning, for respond_to_attendance()'s own deliberately human-readable exception text -- every message here is safe to show a Parent/Player verbatim, none reveal anything beyond what they already know about their own relationship to the player. */
const SAFE_ATTENDANCE_ERROR_PREFIXES = [
  "Invalid attendance status.",
  "Age could not be verified for self-service attendance.",
  "Guardian consent for self-attendance is not currently granted.",
  "Players under 16 cannot respond to their own attendance.",
  "You are not authorized to respond to attendance for this player.",
  "This player is not associated with a team involved in this fixture.",
]

export function toPublicAttendanceError(error: RawErrorLike): string {
  const message = error.message ?? ""
  if (SAFE_ATTENDANCE_ERROR_PREFIXES.some((prefix) => message.startsWith(prefix))) {
    return message
  }
  return "We couldn't save that response right now. Please try again."
}

/** Generic fallback for any other unauthenticated-surface failure (club claim/join/directory-request submission, etc.) that must never echo the underlying error. */
export function toPublicSubmissionError(): string {
  return "Your request could not be submitted. Please try again."
}
