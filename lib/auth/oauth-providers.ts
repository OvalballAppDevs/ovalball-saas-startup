import type { Provider } from "@supabase/supabase-js"

/**
 * The OAuth providers Ovalball supports, and whether each is switched on.
 *
 * Ovalball remains PASSWORDLESS. These are additional passwordless methods
 * alongside the existing email magic link -- there is no password path
 * anywhere in this file or anything it touches.
 *
 * Each provider is gated by its own flag so activation is genuinely
 * sequential: shipping this code changes nothing visible until the owner
 * configures that provider in its console AND in Supabase, then sets its
 * flag. A button that is visible before its provider is configured would
 * send a real person into a provider error page, so the default is off.
 *
 * These are NEXT_PUBLIC_ because they are UI feature flags, not secrets --
 * the provider client secret lives only in Supabase's own configuration and
 * never in this application. Being build-time inlined is deliberate here:
 * flipping one requires a redeploy, which is the controlled activation the
 * brief asks for.
 */
export interface OAuthProviderConfig {
  /** Supabase's own provider id -- never invented. */
  id: Extract<Provider, "google" | "facebook" | "apple">
  /** Button wording required by each provider's own brand guidance. */
  label: string
  enabled: boolean
  /**
   * Extra OAuth scopes. Deliberately empty for all three: Supabase already
   * requests the minimum identity scopes each provider needs to
   * authenticate, and this product has no reason to ask for Drive,
   * Contacts, Calendar, friends, posts, pages or advertising data.
   */
  scopes?: string
}

export const OAUTH_PROVIDERS: OAuthProviderConfig[] = [
  {
    id: "google",
    label: "Continue with Google",
    enabled: process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED === "true",
  },
  {
    id: "facebook",
    label: "Continue with Facebook",
    enabled: process.env.NEXT_PUBLIC_AUTH_FACEBOOK_ENABLED === "true",
  },
  {
    id: "apple",
    // Apple's guidance requires "Sign in with Apple", not "Continue with".
    label: "Sign in with Apple",
    enabled: process.env.NEXT_PUBLIC_AUTH_APPLE_ENABLED === "true",
  },
]

export function getEnabledOAuthProviders(): OAuthProviderConfig[] {
  return OAUTH_PROVIDERS.filter((p) => p.enabled)
}

export function hasAnyOAuthProvider(): boolean {
  return getEnabledOAuthProviders().length > 0
}
