import { Platform } from "react-native"
import * as WebBrowser from "expo-web-browser"
import * as AppleAuthentication from "expo-apple-authentication"
import * as Crypto from "expo-crypto"
import * as Linking from "expo-linking"

import { supabase } from "./supabase"
import { authAppleEnabled, authFacebookEnabled, authGoogleEnabled, oauthRedirectFor } from "../config/environment"
import { friendly, logDetail, type FriendlyError } from "../errors/translate"

/**
 * ONE PROVIDER REGISTRY, SHARED WITH THE WEBSITE'S OWN.
 *
 * `lib/auth/oauth-providers.ts` is the website's registry (provider id, label, its own
 * `NEXT_PUBLIC_AUTH_*_ENABLED` flag). This is that SAME shape and the SAME three Supabase provider ids
 * (`google`, `apple`, `facebook`) -- Supabase's own provider identity, never invented -- reproduced here
 * because a React Native bundle cannot import a Next.js `lib/` module across the workspace boundary the
 * way `packages/contracts` is shared. Nothing about WHICH providers exist or what they are called
 * diverges from the website; only the enablement source differs (see `PROVIDER_ENABLED` below), because
 * a native bundle has no build-time env substitution the way Next.js does -- `app.config.ts`'s `extra`
 * is this app's equivalent of a `NEXT_PUBLIC_*` flag, and is read the same way at runtime.
 *
 * A provider is enabled here ONLY when its own flag says so; a button never renders for a provider that
 * is not configured, which is what stops a real person walking into a provider console error page.
 */
export type SocialProvider = "google" | "apple" | "facebook"

export interface SocialProviderConfig {
  id: SocialProvider
  /** Wording each provider's own brand guidance requires -- identical to the website's. */
  label: string
  enabled: boolean
}

export const SOCIAL_PROVIDERS: SocialProviderConfig[] = [
  { id: "google", label: "Continue with Google", enabled: authGoogleEnabled },
  // Apple's own guidance requires "Sign in with Apple", not "Continue with" -- identical rule to web.
  { id: "apple", label: "Sign in with Apple", enabled: authAppleEnabled },
  { id: "facebook", label: "Continue with Facebook", enabled: authFacebookEnabled },
]

export function enabledSocialProviders(): SocialProviderConfig[] {
  return SOCIAL_PROVIDERS.filter((p) => p.enabled)
}

/** Whether iOS's own native Sign in with Apple button is available on this exact runtime. Expo Go does
 * not ship the native module `expo-apple-authentication` depends on; a development or production build
 * does. Feature-detected rather than assumed, so the app degrades to the same browser-OAuth path every
 * other provider uses instead of throwing. */
export async function nativeAppleAuthAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return false
  try {
    return await AppleAuthentication.isAvailableAsync()
  } catch {
    return false
  }
}

export type OAuthOutcome =
  | { kind: "success" }
  | { kind: "cancelled" }
  | { kind: "error"; problem: FriendlyError }

/**
 * THE ONE NATIVE FLOW EVERY BROWSER-OAUTH PROVIDER SHARES (Google and Facebook; Apple falls back to
 * this too whenever its own native button is unavailable).
 *
 * WHY A REAL SYSTEM BROWSER SESSION, NOT A WEBVIEW. `expo-web-browser`'s `openAuthSessionAsync` opens
 * `ASWebAuthenticationSession` on iOS (Chrome Custom Tabs on Android) -- the same mechanism Apple and
 * Google's own guidance requires for third-party OAuth on a native app, sharing cookies with the
 * system browser (so a person already signed in to Google in Safari is not asked to sign in twice) and
 * never exposing the provider's password field to this app's own code the way an embedded WebView would.
 *
 * WHY THE SAME SUPABASE CALL AS WEB. `signInWithOAuth` is Supabase's own PKCE-flow initiation --
 * `apps/mobile/src/auth/supabase.ts` already sets `flowType: "pkce"` client-wide -- so the code verifier
 * this generates is stored by the SAME `sessionStore` (SecureStore-backed) the session itself lives in,
 * and `exchangeCodeForSession` on return is the identical call `beginRecovery` already makes for a
 * password-recovery link. One PKCE mechanism, three entrances (recovery, OAuth, and eventually any
 * other passwordless method), never three home-grown ones.
 *
 * `skipBrowserRedirect: true` is REQUIRED on native: without it the client tries to navigate `window`,
 * which does not exist here.
 */
export async function signInWithProvider(provider: SocialProvider): Promise<OAuthOutcome> {
  const redirectTo = oauthRedirectFor(Linking.createURL("/auth/callback"))

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  })
  if (error || !data?.url) {
    const problem = friendly(error ?? new Error("could not start sign-in"), `${provider} sign-in`)
    logDetail(`${provider} oauth start`, problem)
    return { kind: "error", problem }
  }

  // The redirect the auth session watches for is the APP's own eventual destination
  // (`ovalball-dev://auth/callback`), never the Expo-Go web hop in between: the hop page's only job is
  // to hand the flow off to that scheme, which is what `ASWebAuthenticationSession` actually intercepts.
  const watchFor = Linking.createURL("/auth/callback")
  const result = await WebBrowser.openAuthSessionAsync(data.url, watchFor)

  if (result.type === "cancel" || result.type === "dismiss") {
    return { kind: "cancelled" }
  }
  if (result.type !== "success") {
    return { kind: "error", problem: { message: `Couldn't continue with ${providerLabel(provider)}. Try again or use email and password.`, detail: null, retryable: true } }
  }

  const parsed = new URL(result.url)
  const errorCode = parsed.searchParams.get("error")
  if (errorCode) {
    // `access_denied` is the standard OAuth code for "the person declined or closed the consent
    // screen" -- a clean cancellation, not a failure, and shown as one (directive: no frightening
    // error for a cancel). Anything else is a genuine provider/network problem.
    if (errorCode === "access_denied") return { kind: "cancelled" }
    return { kind: "error", problem: { message: `Couldn't continue with ${providerLabel(provider)}. Try again or use email and password.`, detail: errorCode, retryable: true } }
  }
  const code = parsed.searchParams.get("code")
  if (!code) {
    return { kind: "cancelled" }
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
  if (exchangeError) {
    const problem = friendly(exchangeError, `${provider} sign-in`)
    logDetail(`${provider} oauth exchange`, problem)
    return { kind: "error", problem }
  }
  return { kind: "success" }
}

function providerLabel(provider: SocialProvider): string {
  return provider === "google" ? "Google" : provider === "apple" ? "Apple" : "Facebook"
}

/**
 * SIGN IN WITH APPLE, NATIVELY -- Apple's own SDK, for the premium on-device experience Apple's own
 * guidance prefers over a browser round-trip on iOS. Falls through to `signInWithProvider("apple")`
 * automatically wherever the native module is unavailable (Expo Go today; a development build removes
 * that limitation without any code here changing -- see `nativeAppleAuthAvailable`).
 *
 * THE NONCE. Apple's identity token is a signed JWT asserting "this person authorised THIS nonce"; the
 * RAW nonce is sent to Apple (hashed, per Apple's own requirement) and the SAME raw value is handed to
 * Supabase's `signInWithIdToken`, which verifies the token's hash matches -- proving the token was
 * issued for THIS request and cannot be replayed from a different one. Generated fresh per attempt,
 * cryptographically random (`expo-crypto`), and never logged.
 *
 * APPLE'S NAME/EMAIL ARE GIVEN ONCE. `fullName` arrives only on the account's first-ever authorisation
 * for this app; nothing here persists it beyond handing it to the Supabase call for that one exchange,
 * and nothing in this app's own identity semantics depends on receiving it again.
 */
export async function signInWithAppleNative(): Promise<OAuthOutcome> {
  const rawNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${Math.random()}${Date.now()}`, { encoding: Crypto.CryptoEncoding.HEX })
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce, { encoding: Crypto.CryptoEncoding.HEX })

  let credential: AppleAuthentication.AppleAuthenticationCredential
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashedNonce,
    })
  } catch (cause) {
    const code = (cause as { code?: string } | null)?.code
    if (code === "ERR_REQUEST_CANCELED") return { kind: "cancelled" }
    const problem = friendly(cause, "Apple sign-in")
    logDetail("apple native auth", problem)
    return { kind: "error", problem }
  }

  if (!credential.identityToken) {
    return { kind: "error", problem: { message: "Couldn't continue with Apple. Try again or use email and password.", detail: null, retryable: true } }
  }

  const { error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: credential.identityToken,
    nonce: rawNonce,
  })
  if (error) {
    const problem = friendly(error, "Apple sign-in")
    logDetail("apple native id token exchange", problem)
    return { kind: "error", problem }
  }
  return { kind: "success" }
}

/** Close any auth session left open by an interrupted attempt (app backgrounded mid-flow, then
 * resumed) -- iOS otherwise leaves the browser sheet in a stuck state on some OS versions. Safe to call
 * unconditionally; a no-op when nothing is open. */
export function dismissAnyOpenAuthSession(): void {
  try {
    WebBrowser.dismissAuthSession()
  } catch {
    // No open session, or the platform does not support dismissal (Android has no equivalent) --
    // either way there is nothing to clean up.
  }
}
