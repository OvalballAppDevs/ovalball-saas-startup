/**
 * SAFE AUTH WORDING (CA-M11): the sentences both clients say for the situations authentication produces.
 *
 * Every sentence is safe to show to anybody: none says whether an email address exists, none repeats a
 * provider's own error, none names a table. A client maps the provider's raw error to one of these keys
 * and shows the sentence; the raw text stays in a development log at most.
 */
export const AUTH_WORDING = {
  invalidCredentials: "Email or password is incorrect.",
  mfaRequired: "Enter the six-digit code from your authenticator app to finish signing in.",
  wrongCode: "That code was not accepted. Codes change every 30 seconds — try the current one.",
  challengeExpired: "That check has expired. Ask for a new code and try again.",
  recoveryExpired: "That reset link is no longer valid. Ask for a new one and use the most recent email.",
  recoveryRequested: "If an Ovalball account exists for that email, we've sent password reset instructions.",
  invitationExpired: "This invitation has expired. Ask the person who sent it for a new one.",
  invitationRevoked: "This invitation has been withdrawn. Ask the person who sent it if you should still have access.",
  invitationUsed: "This invitation has already been used.",
  invitationWrongAccount: "This invitation was sent to a different email address. Sign out and sign in with the account it was sent to.",
  noAccess: "Your account is not connected to a club or team yet.",
  contextRemoved: "You no longer have access to that part of Ovalball. Choose another place to work from.",
  network: "No connection. Check your signal and try again.",
  recentAuthRequired: "This change needs a recent security check.",
  tooManyAttempts: "Too many attempts. Wait a minute and try again.",
  sessionEnded: "Your session has ended. Sign in again.",
} as const

export type AuthWordingKey = keyof typeof AUTH_WORDING

/** Words with a leak in them, pinned absent from every safe sentence. */
export const FORBIDDEN_AUTH_WORDS = [/supabase/i, /gotrue/i, /jwt/i, /postgres/i, /sql/i, /row-level/i, /does not exist/i, /no user found/i, /user not found/i, /already registered/i]
