# Social Sign-In — Provider Setup Guide

Owner-ready instructions for enabling Google, Facebook and Apple sign-in.

**None of these providers is enabled.** This document prepares the setup; it does not
perform it. Every step marked **OWNER MANUAL ACTION** requires a human in a provider
dashboard. No secrets appear in this file, and none should be pasted into it.

## Shared values

| Field | Value |
|---|---|
| Application name | `Ovalball` |
| Homepage | `https://ovalball.co.uk` |
| App domain / authorized domain | `ovalball.co.uk` |
| Privacy Notice | `https://ovalball.co.uk/legal/privacy` |
| Terms of Service | `https://ovalball.co.uk/legal/terms` |
| Data deletion instructions | `https://ovalball.co.uk/legal/data-rights` |
| Cookie Policy | `https://ovalball.co.uk/legal/cookies` |
| **Provider callback URL** | `https://ywwdizmaanbujcfitpcj.supabase.co/auth/v1/callback` |

The callback is Supabase's own OAuth callback for project `ywwdizmaanbujcfitpcj`, taken
from the project's real URL (`https://ywwdizmaanbujcfitpcj.supabase.co`) — providers must
redirect to Supabase, which then returns the user to Ovalball's `/auth/callback` route.

### Prerequisite — Supabase URL configuration

**OWNER MANUAL ACTION.** Supabase dashboard → Authentication → URL Configuration:

- **Site URL**: `https://ovalball.co.uk`
- **Redirect URLs**: include `https://ovalball.co.uk/**`

This is required for *all* sign-in, not just social. Until it is set, Supabase falls back
to its own Site URL when generating links. See `docs/PRODUCTION_AUTH.md`.

---

## Google

**OWNER MANUAL ACTION** — Google Cloud Console → APIs & Services.

1. OAuth consent screen: External. App name `Ovalball`, support email, developer contact.
2. App domain `ovalball.co.uk`; authorized domain `ovalball.co.uk`.
3. Privacy policy link and Terms of service link as in the shared table.
4. Credentials → Create OAuth client ID → Web application.
   - Authorized JavaScript origin: `https://ovalball.co.uk`
   - Authorized redirect URI: `https://ywwdizmaanbujcfitpcj.supabase.co/auth/v1/callback`
5. **Scopes: identity only** — `openid`, `email`, `profile`. Request nothing else. No
   Drive, Calendar, Contacts or Gmail scope; adding one triggers a verification burden
   and is not needed to sign a user in.
6. Copy the client ID and secret into Supabase → Authentication → Providers → Google, and
   enable it there.

## Facebook

**OWNER MANUAL ACTION** — Meta for Developers → Apps.

1. Create app, type **Consumer**. Display name `Ovalball`.
2. Settings → Basic: App domain `ovalball.co.uk`, Privacy Policy URL, Terms of Service URL.
3. **Data Deletion Instructions URL**: `https://ovalball.co.uk/legal/data-rights`
   — that page has a dedicated "Facebook Login — data deletion" section with concrete
   steps, which is what Meta looks for. Ovalball does not run an automated deletion
   callback, so use the instructions URL, not the callback field.
4. Add product **Facebook Login** → Settings → Valid OAuth Redirect URI:
   `https://ywwdizmaanbujcfitpcj.supabase.co/auth/v1/callback`
5. **Permissions: `email` and `public_profile` only.** Do not request friends, posts,
   pages or advertising permissions — they require App Review and Ovalball has no use for
   them.
6. Copy the App ID and App Secret into Supabase → Authentication → Providers → Facebook.
7. Switch the app Live when ready.

## Apple

**OWNER MANUAL ACTION** — Apple Developer portal. Requires a paid Apple Developer account.

1. Identifiers → App ID, with **Sign in with Apple** enabled.
2. Identifiers → **Services ID** (this is the OAuth client ID for the web).
   - Domain: `ovalball.co.uk`
   - Return URL: `https://ywwdizmaanbujcfitpcj.supabase.co/auth/v1/callback`
3. Keys → create a **Sign in with Apple** key. The `.p8` file downloads **once** —
   store it in a password manager, never in this repository.
4. In Supabase → Authentication → Providers → Apple, supply the Services ID, Team ID,
   Key ID and the key contents.
5. **Scopes: name and email only.**

### Two Apple behaviours to expect

- **Name is provided only on first authorisation.** If it is not captured then, Apple will
  not send it again. Later sign-ins return the identifier only.
- **Hide My Email.** Users may share a private relay address
  (`…@privaterelay.appleid.com`) instead of their real one. Treat it as a valid identity —
  do not block or strip it. This is already stated in Privacy §17.

---

## Mobile app — additional owner steps (CA-M11.3)

The native app uses the SAME provider console setup above (same OAuth client, same Supabase provider
row) — no separate mobile registration exists for Google or Facebook. Two things are mobile-specific:

- **Google and Facebook on the native app need no extra console step beyond the above** — they sign in
  through a real system browser session (`ASWebAuthenticationSession` on iOS), which uses the identical
  web OAuth client already configured for the website. Do not create a second, "iOS", OAuth client for
  either provider; there is nothing in this app that reads one.
- **Apple's native button needs one more thing beyond the web setup**: the app's own bundle identifier
  registered against the Apple Developer App ID with **Sign in with Apple** enabled, for **each**
  environment Ovalball ships separately —
  `uk.co.ovalball.app` (production), `uk.co.ovalball.app.staging`, `uk.co.ovalball.app.dev`
  (`apps/mobile/app.config.ts`'s own `IDENTITY` map). Until this is done, the app still offers Apple
  sign-in through the same browser-session path Google and Facebook use — nothing is broken, the native
  Apple button simply is not reachable yet.
- **Exercising the native Apple button on a device (not the browser fallback) requires a development
  build**, not Expo Go — `expo-apple-authentication`'s entitlement is not present in Expo Go's own
  binary. This did not exist as a requirement before CA-M11.3; see
  `docs/mobile/CA_M11_3_SOCIAL_AUTH_MAP.md` for exactly what that changes and what it does not.

## After enabling any provider

Update these in the same change, or the published notices become inaccurate:

- `app/legal/privacy/page.tsx` §17 — remove the "not yet enabled" line for that provider.
- `app/legal/subprocessors/page.tsx` — move the provider from "Supported, not yet enabled"
  to "Currently active".

Then verify: sign in with the provider on production, confirm the account resolves to a
single Ovalball account, and confirm that signing in grants **no** club, team, guardian or
administrative authority by itself.

---

# Implementation status (updated CA-M11.3)

The application code for social sign-in is **complete on both the website and
the native app**, converging on the same canonical Supabase/Ovalball session
either way. No provider is switched on yet. (An earlier version of this
section said Ovalball was "passwordless" with no `signInWithPassword`
anywhere — that was true when written and is not true today: Slice 6 made
password sign-in the primary web entrance, and the mobile app has only ever
had passwords. `scripts/verify-auth-security.mjs` still asserts the older
claim and was not touched by CA-M11.3 — reconciling it is a separate decision
for whoever owns that guard, not a social-auth task.)

## What ships in code

| Piece | Where |
|---|---|
| Provider registry + per-provider flags (web) | `lib/auth/oauth-providers.ts` |
| Provider registry + per-provider flags (native app) | `apps/mobile/src/auth/oauth.ts` |
| Server-side OAuth initiation (web) | `app/auth/oauth-actions.ts` |
| Native OAuth flow — real system browser session, PKCE | `apps/mobile/src/auth/oauth.ts` (`signInWithProvider`) |
| Native Sign in with Apple (preferred path, feature-detected) | `apps/mobile/src/auth/oauth.ts` (`signInWithAppleNative`) |
| Shared open-redirect guard (web) | `lib/auth/safe-next.ts` |
| Canonical callback (web, unchanged, already OAuth-capable) | `app/auth/callback/route.ts` |
| Cold-start callback / intent parsing (native app) | `apps/mobile/src/links/intents.ts` (`AUTH_OAUTH`), `apps/mobile/app/_layout.tsx` |
| Expo-Go-only redirect hop (native app development only) | `app/auth/mobile-oauth-callback/page.tsx` |
| Onboarding for a first-time OAuth user (web) | `lib/signup/complete-signup.ts` (`completeSignupIfNeeded`) |
| Provider buttons (web) | `components/auth/social-auth-buttons.tsx` |
| Provider buttons (native app) | `apps/mobile/src/components/social-auth-buttons.tsx` |
| Provider marks (web) | `components/auth/provider-marks.tsx` |
| Provider marks (native app) | `apps/mobile/src/components/provider-marks.tsx` |

Full audit and per-provider convergence detail:
`docs/mobile/CA_M11_3_SOCIAL_AUTH_MAP.md`.

## Activation order — one provider at a time

Do **not** enable all three at once. For each provider, in this order:

1. Configure the provider console (sections above).
2. Enter the client ID and secret in **Supabase Dashboard → Authentication →
   Providers**. The secret goes there, never into this repository.
3. Set that provider's flag in Vercel (`NEXT_PUBLIC_AUTH_<PROVIDER>_ENABLED=true`)
   and redeploy. These are `NEXT_PUBLIC_` because they are UI flags, and must
   be **Config**, not Sensitive — a Sensitive variable is not available at
   build time and would silently evaluate to `undefined`.
4. Verify in production: logged-out sign-in, a brand-new user, an existing
   magic-link user with the same verified email, sign out, sign in again, and
   a cancelled provider login.
5. Only then update `/legal/subprocessors` to move that provider from
   "Supported, not yet enabled" to "Currently active".
6. Only then start the next provider.

## OWNER MANUAL STEPS still outstanding

- **Supabase hosted Auth URL configuration** — Site URL `https://ovalball.co.uk`,
  redirect allow-list `https://ovalball.co.uk/**`. Still not verified; this
  cannot be inspected without the Management API token, which lives in the
  macOS keychain and was deliberately not extracted.
- **Google Cloud Console** — OAuth consent screen and credentials.
- **Meta for Developers** — Facebook Login app, with the data-deletion URL
  pointed at `https://ovalball.co.uk/legal/data-rights`.
- **Apple Developer** — Services ID, domain verification, private key (`.p8`),
  Key ID and Team ID. The private key is a secret: it belongs in Supabase's
  provider configuration only, never in this repository.
- ~~Official provider brand assets~~ — **done.** Each provider's own mark is drawn as inline SVG,
  correctly worded and never recoloured or combined with Ovalball's own mark: web in
  `components/auth/provider-marks.tsx`, the native app in
  `apps/mobile/src/components/provider-marks.tsx`.

---

# Cloudflare Turnstile — human verification

## What it protects

Unauthenticated auth *initiation* only:

- requesting an email magic link (`/login`)
- submitting the signup wizard (`/signup`)
- starting a provider sign-in

It is deliberately **not** in front of authenticated application use. An
existing session is never re-challenged.

## The security boundary

The rugby slider is UX. Pointer, touch and keyboard events are all
automatable, so completing it proves nothing and is never treated as
permission. The boundary is `lib/auth/turnstile.ts`, which exchanges the
widget's token with Cloudflare server-side and checks `success`, plus the
hostname the token was issued for (production only — Cloudflare's own test
keys report `example.com`).

Failure modes all fail **closed**: missing token, malformed token, rejected
token, Cloudflare unreachable, and hostname mismatch are all refused, and the
visitor sees one generic message that names no internal signal.

## Configuration

```
NEXT_PUBLIC_TURNSTILE_SITE_KEY   Cloudflare Dashboard > Turnstile > Add site
TURNSTILE_SECRET_KEY             same page; server-only, never NEXT_PUBLIC_
```

With **neither** set, the checkpoint does not render and sign-in behaves
exactly as it does today. That is deliberate: a deploy that started rejecting
every sign-in because a key was missing would lock real users out of a
working service. Enforcement begins the moment both keys exist.

Rate limiting is unchanged and still applies underneath: Supabase's own
per-email and per-IP limits (`[auth.rate_limit]`) are the throughput control;
Turnstile is the automation control. They solve different problems and both
remain in force.

## Before enabling in production

Turnstile loads a script from `challenges.cloudflare.com` and can set its own
cookie. That is a genuine change to what the public site does, so
`/legal/subprocessors` and `/legal/cookies` must be updated to match **at the
same time as** the keys are added — Cloudflare is already listed there as
"Supported, not yet enabled" in readiness for exactly this.


---

# Callback URLs — THE TWO ARE DIFFERENT

An earlier draft of this document listed only the application route as "the
provider callback URL". That was wrong, and pasting it into a provider
console would make every sign-in fail. There are two URLs and they serve
different hops.

## A. Provider-facing callback — paste THIS into Google / Meta / Apple

```
https://ywwdizmaanbujcfitpcj.supabase.co/auth/v1/callback
```

This is Supabase Auth's own endpoint. It is what Google, Meta and Apple
redirect back to after the person authenticates, and it is the value that
belongs in each provider console's "Authorised redirect URI" /
"Valid OAuth Redirect URI" / "Return URL" field.

Verified live: responds `303` (GoTrue redirecting), so the path is real.
Derived from the hosted project ref `ywwdizmaanbujcfitpcj`, not guessed.

## B. Application callback — Supabase back into Ovalball

```
https://ovalball.co.uk/auth/callback
```

This is `app/auth/callback/route.ts`. Supabase redirects here after it has
exchanged the provider's response for a session. It never appears in a
provider console.

It DOES need to be allowed in **Supabase Dashboard → Authentication → URL
Configuration → Redirect URLs**, which is covered by the wildcard
`https://ovalball.co.uk/**`.

Verified live: responds `307` (redirects to `/login?error=link` when called
with no code, which is the correct failure behaviour).

| Hop | URL | Configured where |
|---|---|---|
| Provider → Supabase | `https://ywwdizmaanbujcfitpcj.supabase.co/auth/v1/callback` | Google / Meta / Apple consoles |
| Supabase → Ovalball | `https://ovalball.co.uk/auth/callback` | Supabase redirect allow-list |
