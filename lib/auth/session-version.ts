/**
 * The current auth-session compatibility requirement. A plain server-side
 * constant, deliberately NOT an env var or a database row a Site Admin UI
 * could edit -- bumping it is a code change (its own PR), matching the
 * brief's "this is application/security configuration, not a user-editable
 * preference" requirement.
 *
 * Bump this ONLY for a deliberate security- or session-format-breaking
 * release (e.g. the cookie/session structure itself changes, or a known
 * compromise requires invalidating every existing session). An ordinary
 * feature release must NEVER touch this -- see lib/version.ts for the
 * separate, frequently-changing application release version, which never
 * affects whether an existing session stays valid.
 *
 * proxy.ts compares this against each user's public.user_session_versions
 * row (set by record_session_version(), called right after sign-in) on
 * every request; a lower stored version forces a fresh sign-in with
 * ?reason=updated. A user with no stored row yet (existing sessions from
 * before this mechanism shipped) is treated as compatible and silently
 * backfilled, not force-logged-out.
 */
export const AUTH_SESSION_VERSION = 1
