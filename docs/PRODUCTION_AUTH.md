# Production Authentication Configuration

Production origin: **`https://ovalball.co.uk`**
Supabase project ref: **`ywwdizmaanbujcfitpcj`**

No secrets, tokens or keys appear in this document.

---

## 1. The two layers that decide where an auth email points

An auth email link is produced by **both** layers, and both must be correct:

| Layer | Owns | Where configured |
|---|---|---|
| **Application** | the `emailRedirectTo` value it asks Supabase for | `NEXT_PUBLIC_SITE_URL` in Vercel + `lib/site-url.ts` |
| **Supabase Auth** | the **Site URL** and the **Redirect URL allow-list** | Supabase dashboard → Authentication → URL Configuration |

The critical behaviour: **if the `emailRedirectTo` the app sends is not in Supabase's
redirect allow-list, Supabase silently ignores it and falls back to its own Site URL.**
So a correct application can still emit localhost links if the Supabase layer is wrong.

## 2. Application layer — FIXED

### Canonical resolver

`lib/site-url.ts` is now the single origin resolver for the whole product — auth
`emailRedirectTo`, invitation links, and the GoCardless OAuth `redirect_uri`.

It previously existed as **ten independent copies** of
`process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"`. Any one of them would
silently degrade to localhost if the variable were missing.

### Production fails closed

| `NODE_ENV` | `NEXT_PUBLIC_SITE_URL` | Result |
|---|---|---|
| production | unset | **throws** — no silent localhost |
| production | `http://localhost:3000` | **throws** |
| production | `http://…` (non-HTTPS) | **throws** |
| production | `https://ovalball.co.uk` | accepted |
| development | unset | `http://localhost:3000` (unchanged) |

Local development keeps its localhost fallback. Production cannot reach one.

Note `NEXT_PUBLIC_*` is inlined by Next.js at **build** time — a production build made
without the variable bakes the fallback in permanently. The guard makes that loud.

### Auth flows using the canonical resolver

| Flow | Redirect target |
|---|---|
| Signup confirmation | `{origin}/auth/callback?next=/welcome` (`app/signup/submit-signup.ts`) |
| Magic link / sign-in | `{origin}/auth/callback?next=/dashboard` (`lib/auth/check-account.ts`) |
| Guardian / people / partner-club / site-admin invitations | `{origin}/…` via the same resolver |
| GoCardless OAuth | `{origin}/api/gocardless/oauth/callback` |

Canonical callback route: **`/auth/callback`**.

## 3. Supabase layer — REQUIRES A DASHBOARD CHANGE

This layer could not be read or changed from here: the Supabase Management API needs an
access token, and the CLI stores its token in the macOS keychain. Extracting it was out
of scope, so **this remains the outstanding action**.

In the Supabase dashboard for `ywwdizmaanbujcfitpcj` →
**Authentication → URL Configuration**:

**Site URL**
```
https://ovalball.co.uk
```

**Redirect URLs** (allow-list) — must include the production callback, or Supabase
ignores what the app sends and falls back to Site URL:
```
https://ovalball.co.uk/**
http://localhost:3000/**     ← keep ONLY if local development uses this project
```

### Local-development policy

Local development runs against the **local** Supabase stack (`127.0.0.1:54321`), not this
hosted project — so `http://localhost:3000/**` is **not required** in the production
project's allow-list and is safest omitted.

Keeping it is tolerable (an allow-list entry alone does not change which URL production
emails use — that is decided by Site URL plus the app's `emailRedirectTo`), but removing
it eliminates the possibility entirely.

Site URL itself must **never** be localhost.

## 4. Email templates

Prefer Supabase's own `{{ .ConfirmationURL }}`. Do not hand-build token URLs, and do not
hardcode an origin into a template — a hardcoded origin overrides everything above.

## 5. Verification

After the dashboard change, trigger one real confirmation/recovery email to a controlled
address and inspect the link: it must start with the Supabase verification endpoint and
carry a `redirect_to` of `https://ovalball.co.uk/auth/callback…` — never `localhost`,
`127.0.0.1`, or plain `http://`.

Source-code search is not proof on its own; the email is the proof.

## 6. Master Site Admin

The canonical model is `public.site_admins`, with `admin_role` ∈
`full | fixture_ops | club_data | user_access | message_moderator | read_only`.

`internal.has_site_role_capability()` short-circuits on `internal.is_full_site_admin()`,
so **`admin_role = 'full'` confers every site capability** — the seven boolean columns
exist only to scope the narrower roles and are deliberately left at their defaults.

There is no separate "master" role in the schema, so none was invented.

| | |
|---|---|
| Account | `callumkrizz@gmail.com` (pre-existing, email-confirmed) |
| Role granted | `admin_role = 'full'`, `status = 'active'` |
| Granted | 2026-09-05 |
| Mechanism | single idempotent insert into `public.site_admins` (guarded by `where not exists`) |
| Profile | already present, `account_status = 'active'` — nothing created |
| Verified | `is_site_admin`, `is_full_site_admin`, and all site capabilities → `true`; an unrelated user → `false` |

No club membership, team membership, guardian relationship or player record was created.
No email-based permission check exists anywhere in application code.
