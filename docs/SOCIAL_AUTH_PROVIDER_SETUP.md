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

## After enabling any provider

Update these in the same change, or the published notices become inaccurate:

- `app/legal/privacy/page.tsx` §17 — remove the "not yet enabled" line for that provider.
- `app/legal/subprocessors/page.tsx` — move the provider from "Supported, not yet enabled"
  to "Currently active".

Then verify: sign in with the provider on production, confirm the account resolves to a
single Ovalball account, and confirm that signing in grants **no** club, team, guardian or
administrative authority by itself.

---

# Implementation status (updated 2026-09-06)

The application code for passwordless social sign-in is **complete and
deployed**. No provider is switched on. Ovalball remains passwordless:
there is no password field, no `signInWithPassword`, no `signUp({password})`
and no forgotten-password flow anywhere in the auth surface, and a permanent
test (`scripts/verify-auth-security.mjs`) fails the build if one appears.

## What ships in code

| Piece | Where |
|---|---|
| Provider registry + per-provider flags | `lib/auth/oauth-providers.ts` |
| Server-side OAuth initiation | `app/auth/oauth-actions.ts` |
| Shared open-redirect guard | `lib/auth/safe-next.ts` |
| Canonical callback (unchanged, already OAuth-capable) | `app/auth/callback/route.ts` |
| Onboarding for a first-time OAuth user | `app/signup/complete-authenticated-signup.ts` |
| Provider buttons | `components/auth/social-sign-in.tsx` |

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
- **Official provider brand assets** — the buttons currently render as
  correctly-worded text (`Continue with Google`, `Continue with Facebook`,
  `Sign in with Apple`). Each provider requires its own official mark, and
  approximating one from memory would produce a misleading near-copy, so no
  logo is drawn. Download the official SVGs from each provider's brand
  guidelines into `public/brand/` and reference them from
  `components/auth/social-sign-in.tsx`.

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
