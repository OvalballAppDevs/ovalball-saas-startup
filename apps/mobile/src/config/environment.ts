import Constants from "expo-constants"
import { Platform } from "react-native"

/**
 * WHICH OVALBALL THIS BUILD TALKS TO.
 *
 * EVERYTHING HERE IS PUBLIC. `Constants.expoConfig.extra` is compiled into the bundle, and an
 * installed app is a file on a device its owner controls. The Supabase URL identifies a project and
 * the publishable key is the anon key -- it authorises nothing by itself, and every row it reaches is
 * decided by RLS and by the capability engine on the server. Anything that would be damaging to
 * publish must never arrive through this file; `environment.test.mts` fails if a familiar secret name
 * turns up in the configuration.
 */

type Extra = {
  ovalballEnvironment?: string
  supabaseUrl?: string
  supabasePublishableKey?: string
  webUrl?: string
  authGoogleEnabled?: string
  authAppleEnabled?: string
  authFacebookEnabled?: string
}

const extra = (Constants.expoConfig?.extra ?? {}) as Extra

export type OvalballEnvironment = "development" | "staging" | "production"

export const environment: OvalballEnvironment =
  extra.ovalballEnvironment === "production" || extra.ovalballEnvironment === "staging"
    ? extra.ovalballEnvironment
    : "development"

export const supabaseUrl = extra.supabaseUrl ?? ""
export const supabasePublishableKey = extra.supabasePublishableKey ?? ""
export const webUrl = extra.webUrl ?? ""

/**
 * CA-M11.3 -- SOCIAL PROVIDER FEATURE FLAGS, THE SAME SHAPE AS THE WEBSITE'S.
 *
 * The website reads `NEXT_PUBLIC_AUTH_<PROVIDER>_ENABLED` at build time (`lib/auth/oauth-providers.ts`);
 * a native bundle has no equivalent build-time env substitution, so the identical env var is read at
 * `app.config.ts` build time instead and carried through `extra`, exactly like `supabaseUrl` above --
 * still a UI feature flag, never a secret, and still off (`false`) until the owner sets it AND
 * configures the provider in Supabase, matching the website's own activation order exactly.
 */
export const authGoogleEnabled = extra.authGoogleEnabled === "true"
export const authAppleEnabled = extra.authAppleEnabled === "true"
export const authFacebookEnabled = extra.authFacebookEnabled === "true"

/**
 * WHERE AN OAUTH REDIRECT SHOULD ACTUALLY LAND.
 *
 * MEASURED for password recovery (see `recoveryRedirectFor` below) and true for exactly the same reason
 * here: Supabase's own redirect allow-list will not honour `exp://<lan-ip>:8081/...`, only a loopback
 * `exp://127.0.0.1` (which a phone cannot reach) or a custom scheme (`ovalball://`, `ovalball-dev://`).
 * Expo Go has no custom scheme; a development or production build does and needs no hop at all.
 *
 * The Expo-Go-only hop lands on `/auth/mobile-oauth-callback` -- a sibling of the existing
 * `/auth/mobile-recovery` page, forwarding the same way, to the app's `/auth/callback` path rather than
 * `/auth/recovery` (the two are handled by different session methods, never conflated).
 */
export function oauthRedirectFor(appUrl: string): string {
  if (!appUrl.startsWith("exp://")) return appUrl
  return `${webUrl}/auth/mobile-oauth-callback`
}

/**
 * WHERE A RECOVERY EMAIL SHOULD POINT.
 *
 * MEASURED: Supabase honours a custom-scheme redirect (`ovalball://`, `ovalball-dev://`) but refuses
 * an `exp://` one addressed to a LAN host -- tried as four different allow-list patterns including the
 * exact URL, and every one fell back to `site_url`. Only a loopback `exp://127.0.0.1` is accepted, and
 * a phone cannot reach the developer's loopback.
 *
 * So Expo Go, and only Expo Go, goes through the website's `/auth/mobile-recovery` page, which hands
 * the code straight back to the app. A development build and a production build use their own scheme
 * and need no hop at all. The difference is detected rather than configured: `Linking.createURL`
 * returns an `exp://` URL exactly when the app is running inside Expo Go.
 */
export function recoveryRedirectFor(appUrl: string): string {
  if (!appUrl.startsWith("exp://")) return appUrl
  return `${webUrl}/auth/mobile-recovery`
}

/**
 * A PHONE CANNOT RESOLVE THE DEVELOPER'S `localhost`.
 *
 * The simulator can, which is what makes this a late discovery: everything works until the first time
 * somebody scans the QR code with a real handset, and then the app simply cannot sign in with no
 * useful message. Rather than let that be a support question, the condition is detected and named, and
 * `docs/mobile/DEVELOPMENT.md` says exactly what to set. Checked only in development, where it is the
 * only place it can be true.
 */
export function configurationProblem(): string | null {
  if (!supabaseUrl || !supabasePublishableKey) {
    return "This build has no Ovalball server configured. Copy apps/mobile/.env.example to .env.local and fill it in."
  }
  const isLoopback = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(supabaseUrl)
  if (isLoopback && environment === "development" && Platform.OS !== "web") {
    return "This build points at localhost, which a phone cannot reach. Set EXPO_PUBLIC_SUPABASE_URL to your Mac's LAN address (see docs/mobile/DEVELOPMENT.md)."
  }
  // CA-M11.3: a provider flag turned on with no web URL configured means the Expo-Go OAuth hop
  // (`oauthRedirectFor`) has nowhere to send anybody -- a silent, hard-to-diagnose dead end. This
  // build has no provider client ID or secret of its own to validate (Supabase holds those), so this
  // is the one thing left for the app itself to check.
  if ((authGoogleEnabled || authAppleEnabled || authFacebookEnabled) && !webUrl) {
    return "A social sign-in provider is enabled but EXPO_PUBLIC_OVALBALL_WEB_URL is not set, so the Expo Go callback has nowhere to hand the code back to. Set it in .env.local."
  }
  return null
}
