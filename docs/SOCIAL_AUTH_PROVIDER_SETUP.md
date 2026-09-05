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
