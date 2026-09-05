# Production Hosting — Ovalball

**Status:** hosting **not yet configured**. This document is the prepared plan and
reference; it is written so the deployment is a single short sequence once a Vercel
session exists on the deploying machine.

No secrets appear in this document — variable **names** only.

---

## 1. Architecture

| | |
|---|---|
| Hosting platform | Vercel (Next.js App Router) |
| Production branch | `main` |
| Vercel project name | `ovalball` (or nearest available canonical equivalent) |
| Production origin | **not yet assigned** — becomes `https://<project>.vercel.app` |
| Database | Supabase project ref **`ywwdizmaanbujcfitpcj`** (already migrated, 198/198) |
| Custom domain | **none configured**; none found in repo or account config. Do not change DNS without explicit authorization. |

One Vercel project serves the whole application. Do **not** create separate projects for
Parent, Finance, GoCardless, Training or Side Project 1 — they are one Next.js app.

## 2. Required production environment variables (names only)

| Variable | Class | Source |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **REQUIRED FOR STARTUP** — `lib/supabase/env.ts` throws when unset | Supabase project `ywwdizmaanbujcfitpcj` (public) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **REQUIRED FOR STARTUP** | Supabase (public-by-design key) |
| `SUPABASE_SERVICE_ROLE_KEY` | **REQUIRED FOR FEATURE** — server-only; used solely by `lib/supabase/service-role.ts` | Supabase dashboard (**secret**) |
| `NEXT_PUBLIC_SITE_URL` | **REQUIRED AT DEPLOY** — used by 10 files for absolute links and the GoCardless OAuth `redirect_uri` | the assigned Vercel production origin |
| `SITE_ADMIN_NOTIFICATION_EMAIL` | REQUIRED FOR FEATURE (admin notifications) | project decision |
| `GETADDRESS_API_KEY` | REQUIRED FOR FEATURE (address lookup) | provider |
| `GOCARDLESS_*` (5 names) | **DO NOT SET** for this deployment | — |

**Local `.env.local` cannot supply the production Supabase values** — it points at
`127.0.0.1:54321`. `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` must be taken from the Supabase dashboard for
`ywwdizmaanbujcfitpcj`.

### `NEXT_PUBLIC_SITE_URL` rules

Must be the real production **HTTPS** origin — not `localhost`, not `127.0.0.1`, not a
preview deployment URL, no trailing path. It falls back to `http://localhost:3000` when
unset, which is correct locally and **must never** reach production.

## 3. GoCardless — disabled, and safe by construction

Production provider access requires **both**:

```
GOCARDLESS_ENV=production
GOCARDLESS_PRODUCTION_GO_LIVE_CONFIRMED=true
```

Neither is set. `NODE_ENV=production` alone cannot enable it — there is no `NODE_ENV`
reference anywhere in the provider code. Additionally
`assertGoCardlessRedirectOriginSafe()` refuses to build a production OAuth `redirect_uri`
from a localhost or non-HTTPS origin.

**Proven for this deployment:** the production build succeeds with **zero** `GOCARDLESS_*`
variables present, and none of the credential getters run at module load — they are only
called inside GoCardless code paths. So omitting all provider variables in production is
safe and does not affect application startup.

## 4. Deployment procedure

Prerequisite (one-off, human): a Vercel session on the deploying machine —
`vercel login`, or a `VERCEL_TOKEN` in the environment for non-interactive use.

```bash
# 1. link (creates .vercel/, which is gitignored)
npx vercel link

# 2. set production env vars (values entered interactively; never committed)
npx vercel env add NEXT_PUBLIC_SUPABASE_URL production
npx vercel env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY production
npx vercel env add SUPABASE_SERVICE_ROLE_KEY production
npx vercel env add NEXT_PUBLIC_SITE_URL production   # after step 3 assigns the origin

# 3. preview first, to prove Vercel build/runtime compatibility
npx vercel

# 4. promote to production
npx vercel --prod
```

`NEXT_PUBLIC_SITE_URL` is chicken-and-egg: deploy once to learn the assigned origin, set
the variable to it, then redeploy so the value is baked into the client bundle.

## 5. Preview vs production

Preview deployments are created per push/manual invocation and get their own URLs. A
preview URL must **never** be used as `NEXT_PUBLIC_SITE_URL`. If preview is pointed at the
production Supabase project, restrict preview testing to **read-only** paths — the
production database holds the canonical 1,389-row club directory.

## 6. Rollback

Application rollback is independent of the database:

```bash
npx vercel rollback            # revert to the previous production deployment
npx vercel ls                  # list deployments
npx vercel promote <url>       # promote a specific earlier deployment
```

**Constraint:** the database is already forward-migrated to 198/198. Any application
rolled back must remain compatible with that schema. All Side Project 1 migrations are
additive (no `DROP TABLE`/`DROP COLUMN`/`TRUNCATE`), so an older application build
continues to function against the newer schema — it simply does not use the new objects.

Never roll back by deleting provider or financial records.

## 7. Repository hygiene

`.vercel/` is account/machine-specific and is **gitignored** — do not commit it. Never
commit environment values; `.env.local` is gitignored and has never been committed.
