# Checkpoint — Passwordless Auth, paused at Facebook (6 September 2026)

Resume point for the social-authentication work. Written to be read cold.

**Where we stopped:** Google is live in production. Facebook was mid-setup in
the Meta console — the OAuth redirect URI had not yet saved. Apple not
started. Paused pending Ltd company registration.

---

## 1. BLOCKER — apply before anyone new signs up

`supabase/migrations/20260930000000_policy_acknowledgements.sql` is applied
**locally only**. Production does not have the table, and the deployed
signup code writes to it.

Effect: a brand-new user of any provider gets a profile and a Terms row,
then the acknowledgements insert fails, the club claim is never created, and
they see "We couldn't finish setting up your account."

Existing accounts are unaffected — sign-in touches none of this — and
production currently has exactly one user, so real-world exposure is nil
until someone new registers.

Fix:

```bash
npx supabase db push
```

Purely additive: one table, RLS mirroring `terms_acceptances`, one index,
one audit trigger. Nothing existing is altered. Verify afterwards:

```sql
select count(*) from public.policy_acknowledgements;
```

---

## 2. Also outstanding

**Rotate the Turnstile secret.** The value currently in Vercel production
was pasted into a chat session and is therefore in a transcript on disk.
Cloudflare → Turnstile → the site → Rotate secret, then update
`TURNSTILE_SECRET_KEY` in Vercel. The site key is unaffected. Low severity —
a leaked Turnstile secret does not grant access to anything — but there is
no reason to run on a known-exposed credential.

Two older credentials from 30 August are in the same position and worth
revoking: a Supabase access token and a GitHub PAT, both in the
30 August transcript. SSH replaced the PAT the same day, so it is almost
certainly unused.

**Supabase Site URL is `https://www.ovalball.co.uk`.** The application always
requests the apex, `https://ovalball.co.uk/auth/callback`. That is fine *if*
the redirect allow-list contains `https://ovalball.co.uk/**` — the apex then
wins and Site URL never applies. If it does not, GoTrue falls back to Site
URL and drops the user on the www homepage with the code in the URL, where
nothing exchanges it and sign-in silently fails. Recommended: set Site URL to
the apex and allow-list both hosts.

Note both hostnames serve the app independently (`www` returns 200 rather
than redirecting). A permanent www → apex redirect in Vercel would remove a
whole class of this confusion.

---

## 3. Company registration — what it unblocks

`docs/LEGAL_REVIEW_REQUIRED.md` lists identifiers deliberately left out of
the public legal pages because none was verified. Once Pipaxon Technologies
Ltd is registered, these can be filled in:

- Companies House registration number
- Registered office address
- VAT number, if registered
- ICO registration number
- Whether a DPO is appointed

The pages already name Pipaxon Technologies Ltd as operator and carry the
copyright line; only the statutory identifiers are missing. Nothing was
invented, and nothing should be until the certificate exists.

---

## 4. State as of this checkpoint

### Live in production

| Thing | Status |
|---|---|
| Passwordless magic link | working, unchanged |
| Google sign-in | **live**, identity linking verified |
| Cloudflare Turnstile | **live**, enforcing |
| Facebook | not enabled |
| Apple | not enabled |
| GoCardless | not enabled |

Production environment variables (Vercel, Production scope):
`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`,
`TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED`.

### Google UAT results

| Test | Result |
|---|---|
| Button, real Google, correct client, `scope=email profile` only | PASS |
| Existing magic-link user + same verified Google email | **PASS** — one auth user, two identities (`email` 30 Aug, `google` 6 Sep), one profile, one Site Admin row |
| Identity stability across sign-ins | PASS |
| Cancelled login | PASS — no session, only PKCE verifier cookies |
| Callback open-redirect rejection | PASS |
| Turnstile server verification, forged token rejected | PASS |
| Brand-new Google user reaching onboarding | **NOT TESTED** — blocked by section 1 |

### Consent model

Three ticks at signup, recorded as two different legal events:

- **Terms of Service** — an agreement. `terms_acceptances`, version `1.0`.
- **Privacy Notice** and **Safeguarding Policy** — acknowledgements that a
  document was read, explicitly not consent to processing.
  `policy_acknowledgements` (pending in production).

An earlier pass wrote all three into `terms_acceptances` as
`privacy@1.0` / `safeguarding@1.0`. That recorded acknowledgements as
contractual agreements and was corrected before commit.

### Guardrails that must survive future work

- Ovalball is passwordless. `scripts/verify-auth-security.mjs` fails the
  build on `signInWithPassword`, password-based `signUp`,
  `resetPasswordForEmail`, a password input, or a forgot-password route.
- The rejected slider must not return. Turnstile is the anti-bot boundary;
  the checkpoint is one status line.
- Provider buttons are hidden when their flag is off — never shown broken.

---

## 5. Resuming Facebook

Where it stopped: Meta's Redirect URI Validator reported the URI invalid
because it had not been saved into **Valid OAuth Redirect URIs** on the
Facebook Login → Settings page. The validator only checks saved values.

```
https://ywwdizmaanbujcfitpcj.supabase.co/auth/v1/callback
```

Paste into that field, press Enter so it becomes a chip, then **Save
changes** at the bottom right.

Remaining Meta setup:

| Field | Value |
|---|---|
| App domains | `ovalball.co.uk` (bare domain, no scheme) |
| Privacy Policy URL | `https://ovalball.co.uk/legal/privacy` |
| Terms of Service URL | `https://ovalball.co.uk/legal/terms` |
| User data deletion | `https://ovalball.co.uk/legal/data-rights` (instructions URL, not callback) |
| Permissions | `public_profile` and `email` only |

All four URLs verified live and public on 6 September.

Expect `email` to start at Standard Access, meaning only people with a role
on the app can sign in — fine for testing, but Advanced Access via App
Review is needed before public use.

Then: App ID and App Secret into Supabase → Authentication → Providers →
Facebook. Secret never goes in this repository or into a chat.

Then Ovalball's side: set `NEXT_PUBLIC_AUTH_FACEBOOK_ENABLED=true` in Vercel
production as a **Config** value (never Sensitive — Sensitive is unavailable
at build time and a `NEXT_PUBLIC_` flag would silently become `undefined`),
redeploy, run UAT, and move Meta to "Currently active" on
`/legal/subprocessors`.

## 6. Apple, when its turn comes

Services ID, domain verification, `.p8` private key, Key ID, Team ID. The
private key is a secret and belongs only in Supabase's provider config.
Apple's Hide My Email relay means the address returned may not match any
existing account — nothing in this codebase matches identities on email, so
that is handled, but it is the reason Apple is last.

Full provider detail: `docs/SOCIAL_AUTH_PROVIDER_SETUP.md`.
