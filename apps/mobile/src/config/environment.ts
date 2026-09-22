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
