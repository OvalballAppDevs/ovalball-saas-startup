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
  // A DISTINCT HOME-SCREEN ICON FOR THE DEV BUILD ONLY (owner request, physical review). Never the
  // real Ovalball brand mark -- this exists so the development app is visually unmistakable from the
  // real one when both sit on the same device, exactly the reasoning "one binary identity per
  // environment" above already states. staging/production are untouched: no `icon` override here
  // means they keep whatever they already resolve to.
  ...(ENVIRONMENT === "development" ? { icon: "./assets/icons/icon-dev.png" } : {}),
  // PORTRAIT ONLY, on the phone. Ovalball on a touchline is a one-handed, upright product; a landscape
  // layout for it is a design job nobody has done, and rotating into an untested one is worse than not
  // rotating. Tablets are a separate decision and a separate pass.
  orientation: "portrait",
  scheme: identity.scheme,
  userInterfaceStyle: "light",
  // The status bar sits on the forest launch canvas, so its content must be light from the first frame
  // rather than flicking from dark to light once React has an opinion.
  backgroundColor: "#071C14",
  ios: {
    bundleIdentifier: identity.bundle,
    supportsTablet: true,
    infoPlist: {
      // FALSE, NOT TRUE (fixed after a physical-device crash: "RCTStatusBarManager module requires
      // that the UIViewControllerBasedStatusBarAppearance key in the Info.plist is set to NO"). This
      // key controls status-bar-per-VIEW-CONTROLLER appearance, not the launch screen -- that is a
      // separate concern (`backgroundColor` above). `expo-status-bar`'s own `style`/`hidden` props
      // (which the Ovalball mobile chrome rule now uses on every forest screen) require this to be
      // false to work at all; left true, every `<StatusBar style=.../>` throws exactly this error.
      UIViewControllerBasedStatusBarAppearance: false,
    },
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
    // The camera reads an invitation's QR code (CA-M11.1) and nothing else; the sentence is the one iOS shows.
    ["expo-camera", { cameraPermission: "Ovalball uses the camera to read an invitation's QR code." }],
    // CA-M11.3 -- social authentication. `expo-web-browser` opens the SAME Supabase OAuth URL the
    // website redirects to, in a real system browser session (ASWebAuthenticationSession on iOS), never
    // an embedded WebView; `expo-apple-authentication` is the native Sign in with Apple button and sets
    // the `com.apple.developer.applesignin` entitlement this plugin needs to be present at all.
    "expo-web-browser",
    "expo-apple-authentication",
    // The launch screen is the brand ground, so the first rendered frame is the same colour and
    // the app never flashes white on the way in.
    [
      "expo-splash-screen",
      {
        // ONE CANVAS FROM THE FIRST FRAME. The native splash, the React hold and the sign-in screen's
        // own header all sit on #071C14, so the handoff between them is invisible: there is no white
        // frame to flash, because no layer in the stack is ever white.
        image: "./assets/splash-mark.png",
        backgroundColor: "#071C14",
        imageWidth: 180,
        resizeMode: "contain",
        dark: { backgroundColor: "#071C14" },
      },
    ],
    // CLUBHOUSE V1 (owner product decision) -- native map, MapLibre first (open source, no Google
    // Maps dependency for the renderer, vector-tile clustering built in). This is native code: it
    // cannot run in Expo Go and requires a development build (`npx expo prebuild` + `npx expo run:ios`
    // / `npx expo run:android`, or an EAS development-build profile once eas.json exists -- neither
    // has been run as part of this change; see the Clubhouse completion report for exact status).
    "@maplibre/maplibre-react-native",
  ],
  experiments: { typedRoutes: true },
  extra: {
    ovalballEnvironment: ENVIRONMENT,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
    supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    /** The website, for the handful of jobs that are deliberately web-only (Site Admin, the Planner). */
    webUrl: process.env.EXPO_PUBLIC_OVALBALL_WEB_URL ?? "http://localhost:3000",
    // CA-M11.3 -- the SAME three flags the website reads (NEXT_PUBLIC_AUTH_*_ENABLED), carried through
    // build-time `extra` the way a native bundle has to: still a UI flag, never a secret, still "false"
    // until the owner sets it AND configures the provider in Supabase.
    authGoogleEnabled: process.env.EXPO_PUBLIC_AUTH_GOOGLE_ENABLED ?? "",
    authAppleEnabled: process.env.EXPO_PUBLIC_AUTH_APPLE_ENABLED ?? "",
    authFacebookEnabled: process.env.EXPO_PUBLIC_AUTH_FACEBOOK_ENABLED ?? "",
  },
}

export default config
