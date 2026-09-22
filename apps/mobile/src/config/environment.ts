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
  return null
}
