import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * CA-M11.3 -- SOCIAL AUTHENTICATION (Google/Apple/Facebook) CROSS-CLIENT PINS.
 *
 * No real provider credentials exist for this session, so these are structural/source pins over the
 * shared registry shape, the native flow's own security properties (PKCE via the existing Supabase
 * client, cancellation vs error, no logged secrets, one-attempt-at-a-time), and the convergence claims
 * this slice makes: social sign-in reaches the SAME session/MFA/context machinery password sign-in
 * already does, never a parallel path. A live provider round trip is out of reach here by design (see
 * docs/mobile/CA_M11_3_SOCIAL_AUTH_MAP.md) and is reported as such, never claimed.
 */
const MOBILE = "apps/mobile"
const read = (p: string) => readFileSync(p, "utf8")
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

// ------------------------------------------------------------------ the shared registry

test("the mobile provider registry is the same three Supabase provider ids, the same wording, the same off-by-default rule as the website", () => {
  const web = code("lib/auth/oauth-providers.ts")
  const mobile = code(join(MOBILE, "src/auth/oauth.ts"))
  for (const label of ['"Continue with Google"', '"Sign in with Apple"', '"Continue with Facebook"']) {
    assert.ok(web.includes(label), `web missing ${label}`)
    assert.ok(mobile.includes(label), `mobile missing ${label}`)
  }
  // Apple's own guidance wording, not "Continue with" -- pinned on both.
  assert.match(web, /apple[\s\S]{0,120}Sign in with Apple/i)
  assert.match(mobile, /apple[\s\S]{0,120}Sign in with Apple/i)
  assert.match(mobile, /export type SocialProvider = "google" \| "apple" \| "facebook"/)
  // No scope expansion on either client -- identity only, ever.
  assert.doesNotMatch(web, /scopes:\s*"[^"]*(drive|calendar|contacts|gmail|friends|pages|ads)/i)
  assert.doesNotMatch(mobile, /(drive|calendar|contacts|gmail_scope|friends_scope|advertising)/i)
})

test("a provider button never renders unless its own flag is on, on either client", () => {
  const web = code("components/auth/social-auth-buttons.tsx")
  assert.match(web, /if \(providers\.length === 0\) return null/)
  const mobile = code(join(MOBILE, "src/components/social-auth-buttons.tsx"))
  assert.match(mobile, /if \(providers\.length === 0\) return null/)
  const registry = code(join(MOBILE, "src/auth/oauth.ts"))
  assert.match(registry, /enabled: authGoogleEnabled/)
  assert.match(registry, /enabled: authAppleEnabled/)
  assert.match(registry, /enabled: authFacebookEnabled/)
  const env = code(join(MOBILE, "src/config/environment.ts"))
  assert.match(env, /authGoogleEnabled = extra\.authGoogleEnabled === "true"/)
})

// ------------------------------------------------------------------ the native flow's security properties

test("the native flow is a real system browser session, PKCE end to end, never a WebView, never skips skipBrowserRedirect", () => {
  const oauth = code(join(MOBILE, "src/auth/oauth.ts"))
  assert.match(oauth, /import \* as WebBrowser from "expo-web-browser"/)
  assert.match(oauth, /WebBrowser\.openAuthSessionAsync\(/, "opens a real ASWebAuthenticationSession, not an embedded WebView")
  assert.doesNotMatch(oauth, /react-native-webview|<WebView/i)
  assert.match(oauth, /skipBrowserRedirect: true/, "native must not let the client try to navigate window, which does not exist")
  assert.match(oauth, /supabase\.auth\.exchangeCodeForSession\(code\)/)
  const supabaseClient = code(join(MOBILE, "src/auth/supabase.ts"))
  assert.match(supabaseClient, /flowType: "pkce"/, "the one client-wide PKCE setting every passwordless flow inherits")
})

test("cancellation is distinguished from a genuine provider error, and neither ever establishes a session by itself", () => {
  const oauth = code(join(MOBILE, "src/auth/oauth.ts"))
  assert.match(oauth, /errorCode === "access_denied"\) return \{ kind: "cancelled" \}/, "a clean decline is cancelled, not an error")
  assert.match(oauth, /result\.type === "cancel" \|\| result\.type === "dismiss"/)
  // The success path is reached ONLY after a code is present and exchanged -- never on cancel/dismiss/error.
  const successIndex = oauth.indexOf('return { kind: "success" }')
  const exchangeIndex = oauth.indexOf("exchangeCodeForSession(code)")
  assert.ok(exchangeIndex > 0 && successIndex > exchangeIndex, "success is only returned after the exchange call, never before it")
})

test("provider secrets and tokens are never logged, and no client secret pattern exists in mobile source", () => {
  const oauth = code(join(MOBILE, "src/auth/oauth.ts"))
  assert.doesNotMatch(oauth, /console\.(log|warn|info)\(/, "provider tokens must go through logDetail, which is dev-only and never prints a raw token")
  for (const f of ["src/auth/oauth.ts", "src/components/social-auth-buttons.tsx", "app.config.ts", ".env.example"]) {
    const src = read(join(MOBILE, f).replace(`${MOBILE}/.env.example`, join(MOBILE, ".env.example")))
    assert.doesNotMatch(src, /client_secret|CLIENT_SECRET|app_secret|APP_SECRET|private_key|PRIVATE_KEY/i, `${f} must never carry a provider secret name`)
  }
  const nonceLine = oauth.match(/const rawNonce[\s\S]*?const hashedNonce[^\n]*\n/)?.[0] ?? ""
  assert.ok(nonceLine.length > 0, "the Apple nonce generation exists")
  assert.doesNotMatch(code(join(MOBILE, "src/auth/oauth.ts")), /console\.\w+\([^)]*nonce/i)
})

test("one attempt at a time: the button component disables every other provider while one is pending", () => {
  const buttons = code(join(MOBILE, "src/components/social-auth-buttons.tsx"))
  assert.match(buttons, /if \(pending\) return/)
  assert.match(buttons, /disabled=\{pending !== null\}/)
})

// ------------------------------------------------------------------ the cold-start callback and intent parsing

test("AUTH_OAUTH is parsed the same way AUTH_RECOVERY is, at its own sibling path, and never conflated with recovery", () => {
  const intents = code(join(MOBILE, "src/links/intents.ts"))
  assert.match(intents, /path === "\/auth\/callback"/)
  assert.match(intents, /kind: "AUTH_OAUTH", code, error/)
  assert.doesNotMatch(intents, /AUTH_OAUTH[\s\S]{0,40}\/auth\/recovery/)
  const destinations = code(join(MOBILE, "src/links/destinations.ts"))
  assert.match(destinations, /case "AUTH_OAUTH":/, "the route table must acknowledge the new kind explicitly, not fall through")
})

test("a cold-start callback exchanges the code and reclassifies through the SAME session machinery password login uses -- never a shortcut into a context", () => {
  const layout = code(join(MOBILE, "app/_layout.tsx"))
  assert.match(layout, /intent\.kind === "AUTH_OAUTH"/)
  assert.match(layout, /supabase\.auth\.exchangeCodeForSession\(intent\.code\)/)
  assert.match(layout, /await refreshAssurance\(\)/)
  // No new navigation destination is invented for this branch -- classification alone decides where
  // the Gate sends the session next, exactly like every other status transition already does.
  assert.doesNotMatch(layout, /AUTH_OAUTH[\s\S]{0,400}router\.(push|replace)\("\/\(tabs\)"/)
})

// ------------------------------------------------------------------ MFA, invitation and context continuation are inherited, not reimplemented

test("social sign-in never bypasses MFA: the SAME classify()/getAuthenticatorAssuranceLevel path runs regardless of how the session was created", () => {
  const session = code(join(MOBILE, "src/auth/session.tsx"))
  assert.match(session, /getAuthenticatorAssuranceLevel/)
  assert.match(session, /return "needs-mfa"/, "fails closed on any assurance-check error")
  // classify() is called from the ONE auth-state subscription, which fires identically for a
  // password sign-in, a recovery exchange, an OAuth code exchange or a native id-token exchange --
  // there is no second, provider-specific status path.
  assert.match(session, /supabase\.auth\.onAuthStateChange\(\(_event, next\) => \{\s*void apply\(next\)/)
})

test("a held invitation and a held team code resolve for social sign-in exactly as for password sign-in -- keyed off session status and module-level held state, never off the auth mechanism", () => {
  const layout = code(join(MOBILE, "app/_layout.tsx"))
  assert.match(layout, /status === "signed-in" && hasJoinSecret\(\) && !onJoin && !onStepUp/, "the ONE gate effect that redirects to /join, unconditional on how signed-in was reached")
  const oauth = code(join(MOBILE, "src/auth/oauth.ts"))
  assert.doesNotMatch(oauth, /holdJoinSecret|discardJoinSecret|router\.(push|replace)/, "the oauth module itself never touches navigation or the held secret -- that is the Gate's job alone")
})

test("context resolution after social sign-in is the same shared resolver, never a provider-specific shortcut to Home", () => {
  const contexts = code(join(MOBILE, "src/context/contexts.tsx"))
  assert.match(contexts, /@ovalball\/contracts/, "imports the shared session-context/active-context-rules package, not a mobile reimplementation")
  const oauth = code(join(MOBILE, "src/auth/oauth.ts"))
  assert.doesNotMatch(oauth, /listSwitchableContexts|resolveActiveContext|selected-context/, "the oauth module never decides a context; it only establishes a session")
})

// ------------------------------------------------------------------ config validation

test("an enabled provider with no web URL configured is a named development diagnostic, not a silent dead end", () => {
  const env = code(join(MOBILE, "src/config/environment.ts"))
  assert.match(env, /authGoogleEnabled \|\| authAppleEnabled \|\| authFacebookEnabled\) && !webUrl/)
})

test("Apple's native path is feature-detected, not assumed, and falls through to the shared browser flow", () => {
  const oauth = code(join(MOBILE, "src/auth/oauth.ts"))
  assert.match(oauth, /export async function nativeAppleAuthAvailable/)
  assert.match(oauth, /AppleAuthentication\.isAvailableAsync\(\)/)
  const buttons = code(join(MOBILE, "src/components/social-auth-buttons.tsx"))
  assert.match(buttons, /nativeAppleAuthAvailable\(\)\)\s*\n\s*\? await signInWithAppleNative\(\)\s*\n\s*: await signInWithProvider\(provider\)/)
})

// ------------------------------------------------------------------ web regression: unchanged behind the corrected comment

test("the website's own OAuth action still validates the provider is enabled and routes next through the shared open-redirect guard (unchanged by this slice)", () => {
  const actions = code("app/auth/oauth-actions.ts")
  assert.match(actions, /if \(!provider \|\| !provider\.enabled\)/)
  assert.match(actions, /safeNextPath\(next\)/)
  assert.match(actions, /skipBrowserRedirect: true/)
})

test("the new Expo Go OAuth hop page is not an open redirect: only an env-configured destination, and only the code/error it was given", () => {
  const page = code("app/auth/mobile-oauth-callback/page.tsx")
  assert.match(page, /process\.env\.MOBILE_OAUTH_APP_URL/)
  assert.doesNotMatch(page, /searchParams\.\w+\s*as\s*string\s*\)\s*\n[\s\S]{0,60}assign|window\.location/, "never redirects based on a caller-supplied destination")
})
