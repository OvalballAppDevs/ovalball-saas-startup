# CA-M11.3 — Google + Apple + Facebook auth convergence: the map

Status line for this slice:

**CA-M11.3 SOCIAL AUTHENTICATION — GOOGLE / APPLE / FACEBOOK CROSS-CLIENT
IMPLEMENTATION COMPLETE TO EXTERNAL-PROVIDER CREDENTIAL BOUNDARY — LIVE
PROVIDER / PHYSICAL DEVICE CERTIFICATION PENDING.**

This is not a from-scratch build. The forensic audit (below) found the
website's OAuth architecture already substantially built and provider-generic
— `lib/auth/oauth-providers.ts`, `app/auth/oauth-actions.ts`,
`components/auth/social-auth-buttons.tsx`, `components/auth/provider-marks.tsx`
and `app/auth/callback/route.ts` already treat Google, Apple and Facebook
identically, and `docs/SOCIAL_AUTH_PROVIDER_SETUP.md` is already a real,
detailed owner checklist from an earlier pass. The mobile app had none of it.
This slice's actual work was: verify and correct the website's stale
"passwordless" self-description, confirm the website's real behaviour against
every requirement in the brief, and build the entire native-app side from
nothing to the same convergence point.

## One Ovalball identity, confirmed, not assumed

Every provider authenticates into the *same* Supabase Auth user the website's
password/magic-link path already produces. Neither client has, or needed, a
separate provider-account table. Confirmed by reading the code, not inferred:

- **Session establishment** is provider-agnostic on both clients:
  `supabase.auth.exchangeCodeForSession(code)` (web callback route;
  mobile's `oauth.ts` and `_layout.tsx`'s cold-start path) or
  `signInWithIdToken` (mobile's native Apple path) — the same call every
  passwordless method already used.
- **MFA** is asked of the auth server directly, never inferred from the
  provider: web's `(app)/layout.tsx` calls `requireSession`, which reads
  `my_session_assurance()`; mobile's `SessionProvider.classify()` calls
  `supabase.auth.mfa.getAuthenticatorAssuranceLevel()`. Both run for *every*
  session regardless of how it was created — no code change was needed to
  preserve this, only confirmation that it already applies.
- **Context resolution** is the same `getSessionContext`/
  `listSwitchableContexts` (`packages/contracts`) both clients already share
  for password sign-in; social sign-in reaches it through the identical path,
  not a shortcut.
- **Zero-context onboarding**: an OAuth user with no `profiles` row is sent to
  `/signup` (web callback route) or lands in the existing `NoContextOnboarding`
  screen (mobile, via the same `resolveOnboardingState`) — never a fabricated
  role.

## Per-provider table

| | **Google** | **Apple** | **Facebook** |
|---|---|---|---|
| **WEB CURRENT** | Registry entry exists, generic OAuth action/callback already built. Production is reported by the owner as already configured and live; **local `.env.local` and `supabase/config.toml` have it off**, and no `[auth.external.google]` block existed locally before this slice (see below). | Registry entry exists (label "Sign in with Apple" — correct wording already in place); `[auth.external.apple]` block exists in local `config.toml`, `enabled = false`. | Registry entry exists; **no `[auth.external.facebook]` block existed locally before this slice.** |
| **APP CURRENT (before this slice)** | Nothing. `sign-in.tsx`'s own comment: "all three are switched OFF." | Nothing. | Nothing. |
| **APP CURRENT (after this slice)** | `src/auth/oauth.ts`'s `signInWithProvider("google")` — Supabase `signInWithOAuth` + `expo-web-browser`'s `openAuthSessionAsync` (a real system browser session, never a WebView) + `exchangeCodeForSession`. | Two paths, feature-detected: native `expo-apple-authentication` (`signInWithAppleNative`, preferred, Apple's own SDK) when available, else the same browser-OAuth path as Google/Facebook. | Same browser-OAuth path as Google (no native Facebook SDK added — see §Facebook native below). |
| **SUPABASE REQUIREMENTS** | Client ID + secret in Supabase Dashboard → Auth → Providers → Google (production: owner's own words, already done; local: not done). | Services ID (web OAuth client), Team ID, Key ID, `.p8` key contents, in Supabase → Providers → Apple. | App ID + App Secret in Supabase → Providers → Facebook. |
| **PROVIDER REQUIREMENTS** | Google Cloud Console: OAuth consent screen (External), authorized domain, redirect URI = Supabase's own callback. Scopes: `openid email profile` only. | Apple Developer (paid account): App ID with Sign in with Apple capability, Services ID, Sign in with Apple key. Scopes: name + email only. | Meta for Developers: Consumer app, Facebook Login product, Valid OAuth Redirect URI = Supabase's callback, Data Deletion Instructions URL. Permissions: `email` + `public_profile` only. |
| **REDIRECT REQUIREMENTS** | Provider → `https://<project>.supabase.co/auth/v1/callback` (fixed, already documented). Supabase → `https://ovalball.co.uk/auth/callback` (web) or the app's own scheme / Expo-Go hop (mobile, this slice). | Same two hops. | Same two hops. |
| **SECRET REQUIREMENTS** | Client secret: Supabase only, never this repo. | `.p8` private key: Supabase only, never this repo, never committed (owner's own password manager in the interim). | App Secret: Supabase only, never this repo. |
| **IMPLEMENTABLE NOW (this slice)** | Everything except the actual provider console + Supabase provider row. Local `config.toml` scaffolding added (see below). | Everything except the actual Apple Developer artefacts + Supabase provider row. Native SDK path implemented and feature-detected. | Everything except the actual Meta app + Supabase provider row. |
| **EXTERNAL CONFIG REQUIRED** | Google Cloud Console credentials; local Supabase provider enablement for local testing (production reportedly already done). | Apple Developer account + artefacts (paid account required). | Meta for Developers app + App Review implications (see below). |
| **FINAL TEST POSSIBLE NOW** | Structural/domain tests (registry, redirect construction, intent parsing, cold-start callback, cancellation, error mapping) — all built and passing this session. | Same, plus `nativeAppleAuthAvailable()` feature-detection tested against the current (Expo Go) environment: correctly reports unavailable. | Same. |
| **FINAL TEST BLOCKED BY CREDENTIALS** | A real Google consent screen round trip, on device, against a live provider. | A real Apple consent round trip; a real `expo-apple-authentication` native prompt (also blocked by needing a development build — see below). | A real Facebook consent round trip. |

## Local `config.toml`: what this slice added, and what it deliberately left off

Before this slice, only `[auth.external.apple]` existed locally (`enabled =
false`, matching the audit). `[auth.external.google]` and
`[auth.external.facebook]` blocks did not exist at all. This slice added both,
structurally identical to Apple's own block, **still `enabled = false`** —
this changes nothing observable until the owner supplies real values and
flips the flag, exactly like Apple's block already did. `additional_redirect_urls`
gained `env(EXPO_OAUTH_REDIRECT)` / `env(EXPO_OAUTH_WEB_REDIRECT)`, the OAuth
counterpart of the existing `EXPO_RECOVERY_*` pair, for the identical
Expo-Go-cannot-receive-a-LAN-custom-scheme reason already measured and
documented for password recovery.

**Google's production provider is not mirrored into this file at all**,
because it is configured directly in the hosted Supabase project dashboard —
this is the audit's own finding, not a gap this slice introduced or should
paper over.

## Account collision / linking — STOPPED, per the brief's own instruction

**No account-linking or email-collision code exists anywhere in the
codebase, and none was written this slice.** The audit confirmed:

- `auth_flow_states.kind` already reserves a `LINK_IDENTITY` value in its
  CHECK constraint, and a 2026 migration comment lists it among "purposes
  the design enumerates" — but `internal.auth_flow_kind_is_active()` refuses
  every kind except `SIGNUP`. **This is scaffolding for a future,
  not-yet-designed slice, not something this pass may switch on.**
- What happens today if `person@example.com` has a password account and then
  taps "Continue with Google" using the same address is entirely Supabase
  Auth's own default `enable_manual_linking = false` behaviour — unreviewed
  and untested at the application layer, on either client.
- `docs/SOCIAL_AUTH_PROVIDER_SETUP.md` already names this as a manual
  verification step for the owner ("confirm the account resolves to a single
  Ovalball account") rather than something the code enforces.

Per the brief's own §21 instruction ("If provider linking requires
owner/product decision: STOP that subsection, document exact behaviour/risk,
continue the rest") — **this is stopped here.** No custom identity-merging
code was written. The risk is real and is exactly as described above; closing
it is a product decision the owner has not yet made, not an implementation
gap this slice invented.

## Facebook native: the platform decision, stated plainly

No native Facebook SDK (`react-native-fbsdk-next` or similar) was added.
Facebook on the native app uses the same `expo-web-browser` +
`signInWithOAuth` browser-session path as Google, for two independent
reasons:

1. **It requires no development-client rebuild.** The app runs on Expo Go
   today (confirmed: no `expo-dev-client` dependency, no `eas.json`); a
   third-party native SDK would force a rebuild the project is not otherwise
   ready for tonight, and the brief itself says not to force every provider
   through the same mechanism if a provider-appropriate native path is worse
   — here, the browser-session path is *not* worse: it is the same
   Apple/Google-endorsed `ASWebAuthenticationSession` mechanism, a real
   system browser session (never an embedded WebView), sharing cookies with
   Safari the same way Facebook's own native SDK would.
2. **Apple's native SDK gets special treatment because it doesn't have this
   cost.** `expo-apple-authentication` is a first-party Expo SDK module and
   (per Expo's own SDK 57 module support) is available in Expo Go, so
   preferring it costs nothing; there is no equivalent low-cost native path
   for Facebook.

## Apple native and the development-build question

`expo-apple-authentication`'s native button is the *preferred* path
(`nativeAppleAuthAvailable()` feature-detects it) and falls through
automatically to the same browser-OAuth path everyone else uses when
unavailable. Whether it is actually available on THIS Expo Go build is
untested this session (no physical device / simulator run was performed) —
the feature-detection call itself is what's implemented and its fallback path
is what actually carries Apple today. `docs/mobile/DEVELOPMENT.md`'s own
existing statement that push notifications (M7) would be "the first thing
that genuinely requires a development build" is now **out of date**: Apple's
native SDK requiring the `com.apple.developer.applesignin` entitlement
(configured via the `expo-apple-authentication` plugin this slice added to
`app.config.ts`) means a development build is required the moment the native
path is actually exercised on a device that isn't Expo Go, *before* M7. This
is stated here as a fact this slice discovered, not fixed — building a
development client is out of scope for an overnight pass with no owner
credentials to sign it, and the fallback path means nothing is broken by
leaving it as Expo Go for now.

## What each client's cross-client convergence looks like, concretely

A person who signs in with Google on the website and later opens the phone
sees the identical memberships, capabilities and pending items — because both
clients ask the identical `getSessionContext` for the identical
`auth.users.id`. Nothing about *how* they most recently authenticated is
carried into that read. This was verified by reading the code path on both
sides (not by a live cross-provider test, which needs real credentials); the
domain test suite added this session pins the mobile side of that contract
structurally (same session methods, same status machine, same context
resolver import).

## Corrections made to stale documentation, in passing

Two files (`lib/auth/oauth-providers.ts`, `.env.example`) carried a header
comment asserting "Ovalball remains PASSWORDLESS... no password path
anywhere" — true when written, false today (Slice 6 reintroduced password
sign-in as the primary web entrance; the mobile app has only ever had
passwords). Corrected in passing in both files since this slice was already
editing them; `scripts/verify-auth-security.mjs` also still asserts this
(5 pre-existing failures — see the ledger entry) and was **not** touched,
since reconciling that guard with the real, deliberate Slice 6 architecture
is a separate decision for whoever owns that drift, not this slice's job.
