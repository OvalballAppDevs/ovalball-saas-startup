import type { ExpoConfig } from "expo/config"

/**
 * OVALBALL — APP IDENTITY AND ENVIRONMENT.
 *
 * ONE BINARY IDENTITY PER ENVIRONMENT. Development, staging and production are three installable apps
 * with three bundle identifiers and three schemes, so a developer can hold all three on one device and
 * never has to wonder which backend the icon on their home screen is pointing at. The alternative --
 * one identifier whose backend is decided at runtime -- is how somebody ends up demonstrating a
 * feature against production data by accident.
 *
 * NOTHING SECRET IS CONFIGURED HERE. `extra` is compiled into the bundle and the bundle is a file on a
 * device an attacker owns; treat every value in it as published. The Supabase URL and the PUBLISHABLE
 * key are both safe by design -- the publishable key is the anon key, it identifies the project rather
 * than authorising anything, and every row it can reach is decided by RLS and by the capability engine
 * on the server. A service-role key, a provider secret or an invitation pepper would be catastrophic
 * here, and `src/config/environment.test.mts` fails the build if one appears.
 *
 * WHY THE DEFAULT IS A LAN ADDRESS, NOT localhost. A phone on the same Wi-Fi cannot resolve the
 * developer's `localhost`; the simulator can, which is exactly why this is a defect people discover
 * late and on the wrong device. `EXPO_PUBLIC_SUPABASE_URL` is read from the environment, and
 * `docs/mobile/DEVELOPMENT.md` shows how to point it at the Mac's LAN address for a physical phone.
 */

type Environment = "development" | "staging" | "production"

const ENVIRONMENT = (process.env.EXPO_PUBLIC_OVALBALL_ENV ?? "development") as Environment

const IDENTITY: Record<Environment, { name: string; bundle: string; scheme: string }> = {
  development: { name: "Ovalball Dev", bundle: "uk.co.ovalball.app.dev", scheme: "ovalball-dev" },
  staging: { name: "Ovalball Staging", bundle: "uk.co.ovalball.app.staging", scheme: "ovalball-staging" },
  production: { name: "Ovalball", bundle: "uk.co.ovalball.app", scheme: "ovalball" },
}

const identity = IDENTITY[ENVIRONMENT] ?? IDENTITY.development

const config: ExpoConfig = {
  name: identity.name,
  slug: "ovalball",
  version: "0.1.0",
  orientation: "portrait",
  scheme: identity.scheme,
  userInterfaceStyle: "light",
  ios: {
    bundleIdentifier: identity.bundle,
    supportsTablet: true,
  },
  android: {
    package: identity.bundle,
    adaptiveIcon: { backgroundColor: "#123D2C" },
  },
  web: {
    bundler: "metro",
    output: "single",
  },
  plugins: [
    ["expo-router", {}],
    ["expo-secure-store", {}],
    // The launch screen is the brand ground, so the first rendered frame is the same colour and
    // the app never flashes white on the way in.
    ["expo-splash-screen", { backgroundColor: "#071C14", resizeMode: "contain" }],
  ],
  experiments: { typedRoutes: true },
  extra: {
    ovalballEnvironment: ENVIRONMENT,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
    supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    /** The website, for the handful of jobs that are deliberately web-only (Site Admin, the Planner). */
    webUrl: process.env.EXPO_PUBLIC_OVALBALL_WEB_URL ?? "http://localhost:3000",
  },
}

export default config
