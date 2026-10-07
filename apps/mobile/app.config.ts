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
  /**
   * THE OVALBALL MARK -- the oval, with the movement behind it.
   *
   * Full bleed, square, and with NO rounded-corner mask baked in: iOS applies its own, and an icon
   * that carries its own corners ends up with two of them.
   *
   * THE DEV BUILD KEEPS A DISTINCT ICON (owner request, physical review) so it is unmistakable from
   * the real app when both sit on one home screen. It is now the SAME mark inverted onto chalk rather
   * than an unrelated image -- still obviously not the real app at a glance, but no longer pretending
   * to be a different product.
   */
  icon: "./assets/icons/ovalball-icon.png",
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
      // IOS 26 TRAPS AN APP THAT HAS NOT ADOPTED SCENE LIFECYCLE. Rebuilding the native project after
      // adding expo-video produced an Info.plist with no scene manifest, and the app died on launch in
      // `__UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` before a single frame. It is
      // declared HERE rather than patched into `ios/`, because that directory is generated and
      // gitignored -- a hand edit there is lost by the next prebuild, which is exactly how this
      // surfaced. One scene, the app delegate's own window: Expo's AppDelegate already drives it.
      /**
       * IOS 26 TRAPS AN APP THAT HAS NOT ADOPTED SCENE LIFECYCLE.
       *
       * Rebuilding the native project against the current Xcode killed the app on launch in
       * `__UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`, before a single frame --
       * and no Info.plist tinkering fixed it, because the check wants a real scene DELEGATE, not a
       * declaration. Expo 57.0.26 ships one (`ExpoAppSceneDelegate`, exported to Objective-C as
       * `EXExpoAppSceneDelegate`) but its prebuild template does not wire it up, so the app has to
       * name it here.
       *
       * Declared in the config rather than patched into `ios/`, which is generated and gitignored:
       * a hand edit there is erased by the next prebuild, which is how this surfaced in the first
       * place.
       */
      UIApplicationSceneManifest: {
        UIApplicationSupportsMultipleScenes: false,
        UISceneConfigurations: {
          UIWindowSceneSessionRoleApplication: [
            {
              UISceneConfigurationName: "Default Configuration",
              UISceneDelegateClassName: "EXExpoAppSceneDelegate",
            },
          ],
        },
      },
    },
  },
  android: {
    package: identity.bundle,
    adaptiveIcon: { foregroundImage: "./assets/icons/ovalball-icon.png", backgroundColor: "#123D2C" },
  },
  web: {
    bundler: "metro",
    output: "single",
  },
  plugins: [
    // iOS 26 scene lifecycle: the manifest above names Expo's scene delegate, and this makes the
    // generated AppDelegate the provider that delegate requires. It lives as a plugin because `ios/`
    // is generated -- a hand edit there is erased by the next prebuild, and was.
    "./plugins/with-scene-lifecycle-app-delegate",
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
    // The Tournament Created conversion plays as a short silent clip; expo-video is the SDK 57
    // player, and the plugin is what makes the native view available to a build.
    "expo-video",
    // Voice notes in Messages. Recording starts only when somebody taps the microphone, and the sentence is
    // the one iOS shows the first time they do.
    ["expo-audio", { microphonePermission: "Ovalball uses the microphone to record voice notes you choose to send in Messages." }],
    // M7 -- native push delivery. No custom permission string here: unlike camera, iOS's own
    // notification prompt text is not configurable, which is exactly why the Ovalball-styled
    // pre-prompt in the permission screen has to do that persuading itself, before this one ever
    // fires. No icon/color override yet -- there is no android/ project to prebuild against this
    // session, and a proper monochrome tray icon is a follow-up rather than a placeholder asset.
    "expo-notifications",
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
    /**
     * The Clubhouse research PREVIEW overlay, a local review aid that is off in every shipped build.
     * It arrives through `extra` like everything else rather than being read from `process.env` inside
     * the app: a direct read there is a second, unreviewed channel into the bundle, which is the thing
     * `mobile_foundation`'s configuration rule exists to prevent. Nothing about the flag being a
     * development convenience makes it an exception -- that is exactly when a second channel gets
     * opened and left open.
     */
    clubhouseResearchPreview: process.env.EXPO_PUBLIC_CLUBHOUSE_RESEARCH_PREVIEW ?? "",
  },
}

export default config
