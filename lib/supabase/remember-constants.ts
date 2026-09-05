/**
 * The bare cookie name and its parser -- safe to import from a Client
 * Component (the login form sets this cookie directly from the browser
 * before the magic-link redirect away). Everything else that touches
 * Supabase's own auth cookies stays server-only in lib/supabase/remember.ts.
 */
export const REMEMBER_COOKIE_NAME = "ovalball-remember"

/** Default ON -- absent (e.g. a session from before this shipped) means "remembered", matching the brief's own recommended default. */
export function parseRememberCookie(value: string | undefined): boolean {
  return value !== "0"
}
