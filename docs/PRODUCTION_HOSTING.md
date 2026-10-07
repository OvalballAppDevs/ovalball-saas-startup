# Production Hosting — Ovalball

**Status:** **LIVE.** Hosting is configured and the application is deployed at
`https://ovalball.co.uk`.

No secrets appear in this document — variable **names** only.

---

## 1. Architecture

| | |
|---|---|
| Hosting platform | Vercel (Next.js App Router) |
| Production branch | `main` |
| Vercel team / project | `overball-app` / `ovalball-saas-startup` |
| Production origin | **`https://ovalball.co.uk`** (custom domain, pre-existing) |
| Database | Supabase project ref **`ywwdizmaanbujcfitpcj`** (already migrated, 198/198) |
| Custom domain | **`ovalball.co.uk` already configured** and serving production. DNS untouched. |

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
| `GOCARDLESS_*` (6 names) | **DO NOT SET** for this deployment | — |
| `GOCARDLESS_REPLAY_SECRET` | REQUIRED FOR FEATURE once member payments are live — set at GoCardless go-live, before the first live mandate (section 10) | a random value you generate (**secret**) |

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

---

## 8. Deployment history note — Git integration was already active

A GitHub↔Vercel integration was already connected to this project before this task.
Pushes to `main` therefore auto-deploy to production. This was **not** visible from the
repository (no `.vercel/`, no CI workflow, no deploy script), which is why an earlier
audit incorrectly concluded there was no deployment target. Treat every push to `main` as
a production deployment.

## 9. Incident 2026-09-05 — production 500, resolved

**Symptom:** `https://ovalball.co.uk` returned HTTP 500 on all routes.

**Cause:** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` were
stored as Vercel **Secret/Sensitive** type. Sensitive variables are not exposed at
**build** time, and Next.js inlines `NEXT_PUBLIC_*` during the build — so both were baked
in as `undefined`, and `lib/supabase/env.ts` threw at runtime on every request.

**Fix:** re-created both as plain **Config** variables (they are public by design — they
ship in the client bundle, so marking them sensitive was both broken and pointless), added
the missing `NEXT_PUBLIC_SITE_URL=https://ovalball.co.uk`, restored Preview scope parity,
and redeployed. Production returned to HTTP 200.

**Guard for the future:** never store a `NEXT_PUBLIC_*` variable as Sensitive/Secret on
Vercel. It will silently become `undefined` at build time.

---

## 10. GoCardless webhook replay — production runbook

Migration `20270749000000_gocardless_events_never_strand.sql`. Names only in this section — never a
value. **Do this before the first live mandate**, and in any case before any club can disconnect
GoCardless from the phone: a phone disconnect is only revoked at GoCardless by this replay.

### What is scheduled

| pg_cron job | Schedule | Runs | Does |
|---|---|---|---|
| `gocardless-webhook-replay` | `*/10 * * * *` (every 10 minutes) | `internal.request_gocardless_replay()` | Reads the replay route's address and bearer secret from Supabase Vault and POSTs the route through pg_net (5-minute timeout). **Does nothing at all when either Vault entry is missing**, which is why local, CI and clean-boot stacks never call anything. Refuses (and records) an address that is not `https://`. |
| `collect-gocardless-replay-responses` | `5-59/10 * * * *` (5 minutes after each request) | `internal.collect_gocardless_replay_responses()` | Copies each answer pg_net received into `internal.gocardless_replay_runs` (outcome, status code and counts only — never a body or header), marks a request with no answer after 6 hours as `no_response`, and keeps 30 days. |

What one run of `POST /api/gocardless/webhooks/replay` does (the same processor the webhook uses):

1. Claims inbox events GoCardless has stopped redelivering, five at a time, up to 50 or 100 seconds.
   A failing event waits 5 minutes after its first attempt, doubling with each attempt to a 6-hour
   cap; after 20 attempts it is **dead-lettered** (kept whole, with its first and last error, never
   claimed by the replay again). An event whose club has no live connection to its GoCardless account
   is **deferred**, spends no budget, and is taken again once the club reconnects that account.
2. Drains the token revocation queue (`internal.gocardless_token_revocations`): every token a
   disconnect or reconnect let go of is revoked at GoCardless.
3. Re-checks up to 5 live connections whose verification status is still `unknown`.
4. Answers `200` with exactly
   `{"ok","claimed","replayed","deferred","failed","tokensRevoked","tokensFailed","verificationChecked","verificationFailed"}`
   and logs **one** line: `[gocardless replay] ok=… claimed=… …` (counts only). `ok` is false when an
   event or a revocation failed, or the claim or drain could not run.

### Set it up (once)

1. **Generate the secret** — at least 32 random bytes, no whitespace (for example `openssl rand -hex 32`
   in a terminal you then close). Never paste it into chat, a ticket, a document or git.
2. **Vercel** — add it to the Production environment as `GOCARDLESS_REPLAY_SECRET`, entering the value
   interactively (`npx vercel env add GOCARDLESS_REPLAY_SECRET production`); it is server-only, so
   Sensitive is fine (it is not `NEXT_PUBLIC_*`). **Redeploy** so the function sees it.
3. **Production Supabase Vault** — create two secrets, by these exact names, in the production
   project's Vault (the dashboard's Vault page, or `vault.create_secret(<value>, <name>, <description>)`
   in the SQL editor). Never in a migration and never in git:
   - `gocardless_replay_url` — `https://ovalball.co.uk/api/gocardless/webhooks/replay` (the production
     origin; must be HTTPS);
   - `gocardless_replay_secret` — the **same** value as the Vercel variable.
4. **Before enabling,** check that neither Vercel Deployment Protection nor Attack Challenge Mode
   applies to the production domain: either would challenge pg_net's requests (only Vercel's own cron
   is exempt). This cannot be determined from the repository.

The migration itself creates both jobs; nothing else is needed. They are harmless until step 3.

### Verify it works

- **By hand** (with the secret exported in your shell as `GOCARDLESS_REPLAY_SECRET`, never typed on the
  command line):
  - `curl -sS -o /dev/null -w '%{http_code}' -X POST https://ovalball.co.uk/api/gocardless/webhooks/replay` → `401`;
  - `curl -sS -X POST -H "Authorization: Bearer $GOCARDLESS_REPLAY_SECRET" https://ovalball.co.uk/api/gocardless/webhooks/replay`
    → `200` and `{"ok":true,"claimed":0,"replayed":0,"deferred":0,"failed":0,"tokensRevoked":0,"tokensFailed":0,"verificationChecked":0,"verificationFailed":0}`
    on a quiet inbox;
  - a `GET` → `405`; a `503` means the variable has not reached the deployment (redeploy).
- **The schedule** (production SQL editor):
  - `select jobname, schedule, active from cron.job where jobname in ('gocardless-webhook-replay', 'collect-gocardless-replay-responses');`
  - `select status, start_time from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'gocardless-webhook-replay') order by start_time desc limit 5;`
    — `succeeded` proves only that the request was queued;
  - the collected answer: `select requested_at, outcome, status_code, ok, claimed, replayed, deferred, failed, tokens_revoked, tokens_failed from internal.gocardless_replay_runs order by requested_at desc limit 5;`
    — expect `outcome = 'ok'` and `status_code = 200` every ten minutes.
- **Site Admin → System Health → GoCardless Webhooks** (Full Site Admin) shows the same: the last
  scheduled replay and its outcome, and whether the schedule is configured.
- **Vercel runtime logs** for `requestPath:/api/gocardless/webhooks/replay`: one `[gocardless replay]` line
  per run.
- A pg_net timeout is not a failed run (the route does not stop when pg_net gives up): judge the inbox
  itself on the health card too.

### How failure is monitored

The **System Health → GoCardless Webhooks** card (`public.gocardless_inbox_health()`, counts only,
Full Site Admin only). Act on any of:

| Sign | Means |
|---|---|
| **Given up after every retry** > 0 | Dead-lettered events: something fails deterministically. Read `first_error`, `processing_error` and `dead_letter_reason` (below), fix the cause, then retry. |
| **Unprocessed for over 30 minutes** > 0 for more than an hour | Failing events still in back-off, or the replay is not running. |
| **Waiting for a club to reconnect** > 0 | A club disconnected (or connected a different GoCardless account) while GoCardless still had news for it. Processed automatically within about ten minutes of it reconnecting the same account. |
| **Access tokens waiting to be revoked** older than 1 hour, or tried more than 3 times (shown amber) | Revocation is failing; the token is still usable at GoCardless. |
| **Last scheduled replay** not `Completed`, or older than 30 minutes | `Refused by the website` with 401 (secrets differ), 503 (variable missing), 404 (an application rollback past this route); `Could not reach the website`; `Timed out`; `No answer recorded`; `Not sent: the replay address is not HTTPS`. |
| "The scheduled replay is not configured in this environment" **in production** | Step 3 has not been done: nothing is being recovered. |

Also: webhook log lines `[gocardless webhook] Answered 498` mean GoCardless's signature does not verify
(the `GOCARDLESS_WEBHOOK_SECRET` is wrong) — GoCardless does **not** retry a 498, so every such event is
lost until it is fixed and re-sent from GoCardless's dashboard (Developers → Webhooks, which keeps three
months and allows a manual retry). No alert is pushed anywhere yet; the card and the logs are the
monitor.

Inspecting a dead-lettered event (never select `payload` unless you need it):

```sql
select id, gc_event_id, resource_type, action, club_id, attempts, failure_count,
       first_failed_at, first_error, last_failed_at, processing_error, dead_lettered_at, dead_letter_reason
  from public.gocardless_events
 where dead_lettered_at is not null and not processed
 order by created_at;
```

To retry one after fixing its cause: re-send it from GoCardless's dashboard (a delivery is processed even
when dead-lettered), or give it a fresh budget —
`update public.gocardless_events set dead_lettered_at = null, dead_letter_reason = null, attempts = 0 where id = '<id>';`
— and the next run takes it.

### Disable or roll back

- **Pause immediately:** `select cron.alter_job((select jobid from cron.job where jobname = 'gocardless-webhook-replay'), active := false);`
  (the card then says the schedule is switched off). Or `select cron.unschedule('gocardless-webhook-replay');`.
- **Make it inert without touching the schedule:** delete either Vault entry (the job does nothing), or
  remove `GOCARDLESS_REPLAY_SECRET` from Vercel and redeploy (the route answers 503, failing closed, and
  the collector records `Refused by the website`).
- **Remove for good:** a follow-up migration that unschedules both jobs, so the repository and
  production stay in step.
- **Application rollback:** `npx vercel rollback` does not touch pg_cron. A rollback to a build without
  this route makes every run a 404 (seen on the card); the database objects of `20270749000000` stay —
  forward-only, like every migration here.

What never leaves the database: the secret is read from Vault at run time and appears in no cron
command, log line or replay-log row. It transits pg_net's own request queue for the moment before each
request is sent, as every pg_net call does; pg_net's schema is not exposed through the API.
