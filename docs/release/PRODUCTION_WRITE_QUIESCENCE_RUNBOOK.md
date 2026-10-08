# Production Write Quiescence Runbook

Project `ywwdizmaanbujcfitpcj`. Written 8 October 2026 at checkpoint `a1eab03`; row 8 (platform-billing webhook)
and 4.1 step 5 updated the same day after the webhook fix (migration `20270765000000`, rehearsed under this gate).

**Gate 2 status: DESIGN PROVEN ON DISPOSABLE STACKS; NOT VERIFIED IN PRODUCTION.** The procedure below blocked every
write path that can be reproduced locally while the migration operator kept writing, and reopening restored every
path (53 of 53 checks, every "blocked" result backed by a read-only refusal in the response or the database log;
full 228-migration push inside the window). Production-only components that could not be reproduced — PostgREST
14.5 (the rehearsal ran 16.4), the production pooler, Realtime, the deployed Edge Function — are marked NOT VERIFIED;
section 4 says, for each, whether an in-window check stops the release or the owner must accept it.

**One boundary is credentials, not configuration.** Any client holding the `postgres` credentials can open a
read-write session exactly as the operator does (the setting is per session and cannot be forbidden). The design
blocks every automatic and application path; it cannot stop a person or program that holds the database password,
or a Dashboard user (the Dashboard SQL editor runs as `postgres`). Section 4.1 makes the custody of those
credentials a precondition. This is stated as a limit, not hidden.

Nothing here has been run against production. The SQL is written out for a human operator; the only executable copy
is `scripts/ops/rehearse-write-quiescence.py`, which refuses anything but a disposable local stack.

## 1. Why a maintenance page is not enough

The rehearsal proved, on a disposable stack, the three traps the task warned about:

- **The database default alone does not stop PostgREST.** With `default_transaction_read_only = on` set on the
  database and every PostgREST session terminated, member, club admin, service-role and webhook writes through the
  REST API still succeeded. PostgREST opens its write transactions explicitly read-write, which overrides any
  default. (Auth, Storage, pg_cron, pg_net and plain SQL sessions were blocked.)
- **Pooled sessions keep the old setting.** A database default applies only to new sessions; without terminating
  the pools, writes continue (proved: "NO-TERM" check).
- **RLS does not stop SECURITY DEFINER functions or the service role** — a read-only transaction does: every definer
  RPC and the service role were refused once the transaction itself was read-only, and a deliberately hostile
  definer function that tries `set_config('transaction_read_only', 'off')` was refused by PostgreSQL
  (`25001 transaction read-write mode must be set before any query`).

## 2. The design

Three independent layers, each proven necessary:

| Layer | What it stops | How it is undone |
|---|---|---|
| **A. Pause pg_cron jobs** (record which were active) | Scheduled jobs (7 today; 12 after the upgrade). Defence in depth: a job left active is blocked by layer B (proved). | Re-activate exactly the recorded jobs. |
| **B. Database default read-only** — `alter database postgres set default_transaction_read_only = on` — then terminate every non-superuser session | Every NEW session: Auth (GoTrue), Storage, pg_cron job runs, the pg_net worker, the management API / Dashboard SQL editor, stray scripts using the `postgres` password, PostgREST's own connections | `alter database postgres reset default_transaction_read_only`, then terminate sessions again so pools reconnect writable. |
| **C. PostgREST per-request gate** — a pre-request function that switches each request's transaction to read-only | Every REST/RPC write by anon, members, club admins, the mobile app, the web server's service-role client, webhooks, and SECURITY DEFINER RPCs | `alter role authenticator reset pgrst.db_pre_request` + `notify pgrst, 'reload config'`. |

**The operator is exempt per SESSION, never per role.** The migration operator's own connection carries
`default_transaction_read_only=off` as a startup option (`PGOPTIONS` for psql; `?options=-c%20default_transaction_read_only%3Doff`
on the `--db-url` for `supabase db push`). Session settings outrank database defaults, so only sessions that ask
can write; every session that does not — cron, pg_net, the Dashboard, a forgotten script — stays read-only (proved).
That is a boundary against accident and automation, not against a holder of the `postgres` credentials (above).
The operator connects DIRECTLY to the database (`db.<ref>.supabase.co:5432`), never through a pooler: a pooler may
reuse the operator's server connection, with its writable setting, for another client (not rehearsed; avoided). A
role-level exemption (`alter role postgres set …`) is rejected outright: cron, pg_net and the management API all run
as `postgres` and would be exempt too.

**Reads keep working** throughout (anon and signed-in reads with an existing access token were served in the window).

**Nothing is dropped or revoked.** No grants change, no keys rotate, Auth configuration is untouched; every change is
a setting with an exact reset, proven by reopening.

### Alternatives considered

| Alternative | Verdict |
|---|---|
| Website maintenance page only | Rejected: direct API calls with existing tokens, the mobile app, webhooks, cron and the service role all bypass it. Useful only as user messaging, on top of the design. |
| Revoke table/function grants from anon/authenticated | Rejected: 555 definer functions and 39 table grants to restore exactly; does not stop the service role or definer paths; a partial restore is a security incident. |
| Pause the Supabase project | Rejected: stops the migration operator too. |
| Rotate API keys / JWT secret | Rejected: not allowed; signs everyone out; mobile builds carry the anon key. |
| Network restrictions | Rejected: blocks the database connection, not the API gateway (Auth, REST, Storage). |
| `alter role postgres set default_transaction_read_only = off` as the operator exemption | Rejected: exempts cron, pg_net and the management API as well (privileged bypass). Not a fallback. |
| Database default only (no gate) | Rejected: PostgREST writes still succeed (proved). |
| Gate only (no database default) | Rejected: Auth, Storage, cron, pg_net and direct sessions are not PostgREST. |

## 3. Write-path inventory

Columns: entry point · database role · what it writes · how it is blocked · how it is verified · how it is restored ·
in-flight handling. "Rehearsed" means proved on the disposable stack.

| # | Entry point | Role | Writes | Blocked by | Verified | Restored by | In flight |
|---|---|---|---|---|---|---|---|
| 1 | Web: 132 server-action files, page loads (Next.js on Vercel) | `authenticated` via PostgREST | public tables via RLS and definer RPCs | C | Rehearsed (member, club admin) | C reset | Request fails 405 / error; user retries after |
| 2 | Web server: service-role client (`lib/supabase/service-role.ts`, `lib/admin/create-identity.ts`), incl. the subscription page that reconciles on render | `service_role` via PostgREST; Auth admin API | any public table; auth users | C (REST); B (Auth admin) | Rehearsed (service-role update, zero-row canary, Auth admin create) | C/B reset | Fails; page shows its error state |
| 3 | Web middleware (`lib/supabase/middleware.ts`): `record_session_version` on first request; `signOut()` on suspension/version | `authenticated` via PostgREST; Auth | `user_session_versions`; Auth sessions | C; B | Rehearsed (the same RPC) | reset | The RPC's error is not checked by the middleware: the page still loads. A sign-out cannot complete; the redirect still happens. |
| 4 | Sign-in, sign-up, password reset, token refresh, OAuth callback | `supabase_auth_admin` (GoTrue) | `auth.*` | B (new sessions after termination) | Rehearsed: sign-in and refresh fail with 500 | B reset | **Users whose access token expires in the window (1 h tokens) cannot refresh and are sent to sign in, which also fails until reopening.** Keep the window short. |
| 5 | Mobile app (anon key + user JWT; ~165 direct write sites, push-token registration) | `anon`/`authenticated` via PostgREST | as row 1 | C | Rehearsed ("mobile-equivalent": same API path and key type) | C reset | Fails; no maintenance UX in the app today |
| 6 | Storage uploads (avatars, crests, club documents, message attachments) | `supabase_storage_admin` + user JWT | `storage.objects` (+ file) | B | Rehearsed: `DatabaseReadOnly` 400 | B reset | Upload fails; user retries |
| 7 | GoCardless member webhook `app/api/gocardless/webhooks` | `service_role` → `record_gocardless_event` | `gocardless_events` + payment state | C | Rehearsed: refused in window; after reopening the same event is claimed once and skipped on redelivery | C reset | Route answers 500, so GoCardless retries (provider retry schedule NOT VERIFIED). 0 events in production to date. |
| 8 | **Platform-billing webhook** `app/api/platform-billing/webhooks` | `service_role` → `record_platform_provider_event` | `platform_provider_events` + platform payment/subscription state | C | **Fixed in code (not deployed):** rehearsed with the real route under this gate (runbook 4.2/4.5 SQL verbatim): open → 200; in the window → **500**, nothing recorded, payment untouched, three further redeliveries 500 each; a redelivery of an event already processed → also 500 (its claim is a write) — safe, it is acknowledged after reopening; after 4.5 → 200, processed once; a second redelivery → 200 duplicate; GoCardless reached only by GET (stubbed) | C reset | **The DEPLOYED route (6d32f5b) still answers 200 to a refused write — the event is lost.** It is only exposed if `GOCARDLESS_PLATFORM_WEBHOOK_SECRET` is set in production; unset, it answers 503 and records nothing, so GoCardless keeps the event and retries. GoCardless documents 9 delivery attempts at increasing intervals and no retry after 498 (simulated redelivery here; the schedule itself is the provider's). 0 events in production to date. Precondition P4 (4.1 step 5). |
| 9 | GoCardless OAuth/app/connection routes | `service_role` | connection records | C | As row 2 | C reset | **Calls the provider BEFORE the database:** `app/api/gocardless/oauth/callback/route.ts` exchanges the code (≈ line 84) before saving the token, so in the window the exchange succeeds and the save is refused. |
| 9a | GoCardless member actions that change the provider first — cancel membership (`lib/payments/gocardless/cancel-membership.ts`: provider cancel ≈ line 47, local write ≈ line 82), mandate/subscription creation through `lib/payments/gocardless/client.ts` | `service_role` + GoCardless API | provider state, then local rows | C stops only the LOCAL write | Code read | — | **Not blocked at the provider.** Production does not configure GoCardless today (`docs/PRODUCTION_HOSTING.md`: `GOCARDLESS_*` "DO NOT SET"), so these refuse before calling it. Precondition P9: the owner confirms that is still so; if GoCardless is configured, these actions must be switched off for the window and anything in flight reconciled after it. |
| 10 | GoCardless replay route, called by pg_cron through pg_net | `postgres` (cron) → HTTP → `service_role` | `gocardless_events` | A, B, C | Rehearsed (cron, pg_net) | A/B/C reset | Paused job; nothing queued |
| 11 | pg_cron jobs (7 today; 5 more created active by migrations 544, 727, 729 and 749 (two) during the push) | `postgres` | many | A + B | Rehearsed: a job left active in the window wrote nothing | Resume recorded jobs | New jobs created during the push run in the window and fail harmlessly under B; check `cron.job_run_details` after |
| 12 | pg_net worker (push notifications to exp.host, geocoding, GoCardless replay) | `postgres` (background worker) | `net.*` queue/responses; outbound HTTP | B (queueing is a write); worker terminated so it restarts read-only | Rehearsed: queueing refused; the restarted worker's own writes (dequeue, response cleanup) refused as read-only and it keeps restarting (database log) | B reset | Requests queued before the window wait and are sent after reopening (the worker cannot dequeue under read-only) |
| 13 | Database triggers that send push (`internal.deliver_push_notification`) or email claims | the writer's own transaction | outbound side effects | Never fire: their triggering write is refused | Follows from rows 1–7 | — | — |
| 14 | Email (`lib/email/send.ts`, ZeptoMail delivery-claim RPCs) | `service_role` | delivery claims | C | Code read: the claim (`claim_email_delivery`) precedes `provider.send` | C reset | Claim refused → no send; retried by its caller |
| 15 | Edge Function `address-lookup` | none in the repository's source | — | B/C would apply to any database call it made | **NOT VERIFIED** for the deployed v3. Owner gate (4.1 step 7): download the deployed source (`supabase functions download address-lookup`, read-only) and confirm it writes nothing, or accept explicitly. | — | — |
| 16 | Realtime (`supabase_realtime_admin`; Supabase runs it as a platform service), incl. private-channel authorisation through the 2 `realtime.messages` policies | platform | `realtime.*` | B for new non-superuser sessions | **NOT VERIFIED** (local Realtime connects as a superuser; production topology unknown). No application data is written through it; broadcasts carry no content. Owner accepts or a disposable test with production's Realtime version is added. | — | Live updates may pause |
| 17 | Supabase Dashboard SQL editor / management API (`mgmt-api`, runs as `postgres`) | `postgres` | anything | B (session terminated; new ones read-only) — **but a Dashboard user can opt out like the operator** | Rehearsed for plain `postgres` sessions ("stray session") | B reset | Terminated. Custody: only the operator uses the Dashboard during the window (4.1 step 6). |
| 18 | Scripts that can reach production: `scripts/ingestion/run_remote_import.py` (`OVALBALL_REMOTE_DB_URL`) and service-key scripts without a localhost guard | `postgres` or `service_role` | anything | B (postgres sessions) / C (service role) | Rehearsed (stray session; service role) | reset | Do not run any during the window |
| 19 | The migration operator (`supabase db push`, psql) | `postgres` with the session opt-out | schema + data | **Exempt by design** | Rehearsed: psql and `supabase db push` (228 migrations) | — | — |
| 20 | Platform superuser sessions (`supabase_admin`: exporter, pg_cron scheduler, replication) | superuser | platform state | Cannot be terminated by `postgres`; not an application write path | Observed read-only | — | — |

## 4. Procedure

Assumes: approvals in hand (section 8); the release backup taken (backup runbook); a low-traffic hour; users told in
advance. `$OPERATOR_DB_URL` is the operator's DIRECT database connection, typed at the terminal, never saved.

### 4.1 Pre-maintenance checks (read-only; no production change)

1. **The operator's connection is DIRECT and honours session options.** `$OPERATOR_DB_URL` is the direct connection
   (`db.<ref>.supabase.co:5432`, user `postgres`), not a pooler. Check, read-only:

   ```sh
   PGOPTIONS='-c default_transaction_read_only=on' psql "$OPERATOR_DB_URL" -X -tA -c 'show default_transaction_read_only'
   psql "$OPERATOR_DB_URL" -X -tA -c 'select inet_server_port(), current_setting($$application_name$$)'
   ```

   Must print `on`, and port 5432 on the database host. If the direct connection is unavailable (it is IPv6 unless
   the IPv4 add-on is enabled), **stop**: the pooler path is not rehearsed.
2. Nothing is already set: `select setrole::regrole, setconfig from pg_db_role_setting` shows no
   `default_transaction_read_only` (except `supabase_read_only_user`) and no `pgrst.db_pre_request`.
3. Record the cron state: `select jobid, jobname, active from cron.job order by jobname;` — keep it in the release log.
4. Stop anything you control that writes: no imports, no seed or maintenance scripts, no Dashboard edits.
5. Platform-billing webhook (row 8). The fixed route cannot go live before the window (it ships with `main`, which
   needs the new schema), so for the window one of these must hold — otherwise stop:
   (a) the owner confirms `GOCARDLESS_PLATFORM_WEBHOOK_SECRET` is NOT set in the Vercel production environment (the
   deployed route then answers 503 to every delivery and acknowledges nothing; expected: `docs/PRODUCTION_HOSTING.md`
   says `GOCARDLESS_*` "DO NOT SET", and production holds no provider-linked platform subscription), or
   (b) Ovalball's own GoCardless webhook endpoint is disabled in GoCardless for the window and re-enabled after the
   cutover, then failed deliveries are retried from GoCardless (Developers → Webhooks).
   After cutover the fixed route and migration `20270765000000` are both live, and a refused write answers 500.
6. **Credentials custody** for the window: only the operator holds the database password and uses the Dashboard;
   nobody else in the organisation runs SQL, scripts or Dashboard edits. (Rotating the database password before the
   window makes this enforceable; it is a production change and needs its own approval.)
7. Edge Function (row 15) and GoCardless configuration (row 9a): checked, or explicitly accepted by the owner.

### 4.2 Enter maintenance

In ONE operator session opened with the opt-out (`PGOPTIONS='-c default_transaction_read_only=off' psql "$OPERATOR_DB_URL"`):

```sql
-- A. Pause scheduled jobs (the list from 4.1 step 3 is what you will resume).
select cron.alter_job(jobid, active := false) from cron.job where active;

-- B. Every new session in this database starts read-only.
alter database postgres set default_transaction_read_only = on;

-- C. PostgREST: every request's own transaction becomes read-only.
create schema if not exists ops_maintenance;
create or replace function ops_maintenance.read_only_request() returns void language plpgsql as $$
begin
  perform set_config('transaction_read_only', 'on', true);
end $$;
revoke all on function ops_maintenance.read_only_request() from public;
grant usage on schema ops_maintenance to anon, authenticated, service_role;
grant execute on function ops_maintenance.read_only_request() to anon, authenticated, service_role;
alter role authenticator set pgrst.db_pre_request = 'ops_maintenance.read_only_request';
notify pgrst, 'reload config';
```

Wait 30 seconds (in-flight requests finish), then end every other non-superuser session so the pools reconnect under
the new default:

```sql
select pid, usename, application_name, backend_type, pg_terminate_backend(pid)
  from pg_stat_activity
 where datname = 'postgres' and pid <> pg_backend_pid()
   and (backend_type = 'client backend' or backend_type like 'pg_net%')
   and usename is distinct from 'supabase_admin';
```

A transaction still open at this point is rolled back (proved). Its client sees an error and retries after reopening.

### 4.3 Verify the window BEFORE any migration (stop if any check fails)

1. **PostgREST gate — the zero-row canary.** With the service-role key, update a row that cannot exist:

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' -X PATCH \
     "$SUPABASE_URL/rest/v1/clubs?id=eq.00000000-0000-0000-0000-000000000000" \
     -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
     -H 'Content-Type: application/json' -d '{"bio":"canary"}'
   ```

   Must be `405` (body code `25006`). `204` means the gate is NOT in force (PostgREST 14.5 did not take the in-database
   configuration) — nothing was changed by the canary, but **stop: exit maintenance (4.5) and do not migrate.** This
   is the in-window check for the NOT VERIFIED PostgREST version.
2. **Database default:** a NEW plain session (no opt-out) refuses a write:
   `psql "$OPERATOR_DB_URL" -X -c 'create temp table q(x int)'` → `cannot execute CREATE TABLE in a read-only transaction`.
3. **Reads work:** the public site and a signed-in page render.
4. **Auth is read-only** (expected): the Auth health endpoint answers; sign-in would fail — do not test it with a
   real account.

### 4.4 Migrate (the operator path)

```sh
supabase migration list --db-url "$OPERATOR_DB_URL"        # direct connection; 523 applied, 229 pending, nothing remote-only
supabase db push --db-url "$OPERATOR_DB_URL?options=-c%20default_transaction_read_only%3Doff"
```

Rehearsal: 228 migrations in 7.8 s on production-shaped synthetic data, with 15 service-role writes attempted
during the push all refused and 0 rows written. Then the post-migration checks in the release plan.

### 4.5 Exit maintenance (reopen)

In an opt-out operator session:

```sql
alter role authenticator reset pgrst.db_pre_request;
notify pgrst, 'reload config';
alter database postgres reset default_transaction_read_only;
select pg_terminate_backend(pid) from pg_stat_activity
 where datname = 'postgres' and pid <> pg_backend_pid()
   and (backend_type = 'client backend' or backend_type like 'pg_net%')
   and usename is distinct from 'supabase_admin';
-- Resume EXACTLY the jobs recorded in 4.1 step 3 (jobs added by migrations are already active):
select cron.alter_job(jobid, active := true) from cron.job where jobname in ( /* the recorded list */ );
drop schema ops_maintenance cascade;
```

Then: the zero-row canary must answer `204`; a fresh plain session must be writable
(`show default_transaction_read_only` → `off`); `select count(*) filter (where active), count(*) from cron.job` → 12/12.
Rehearsal: PostgREST answered again 0.5 s after reopening.

## 5. Timings (rehearsal, disposable stack)

Enter maintenance 5.3 s (including a 3 s drain; production uses 30 s) · 228-migration push 7.8 s · reopen 0.7 s.
Production adds the operator's verification time; plan a 30-minute window.

## 6. Fallbacks and failure handling

- **No direct connection, or it does not honour session options (4.1 step 1):** stop before entering maintenance.
  There is no role-level fallback: exempting the `postgres` role would exempt cron, pg_net and the Dashboard too.
- **Canary returns 204 (gate not in force):** exit maintenance; do not migrate; investigate PostgREST configuration
  on a disposable stack running 14.5.
- **Operator session lost mid-window:** the database stays read-only (settings persist); reconnect with the opt-out
  and continue or exit.
- **Exit fails part-way:** each statement in 4.5 is independent and idempotent; rerun the block.

## 7. Not verified

| Item | How it is handled |
|---|---|
| PostgREST 14.5 honouring `pgrst.db_pre_request` from in-database configuration (rehearsal ran 16.4) | In-window zero-row canary (4.3 step 1) stops the release if not |
| Direct connection honouring session options | Read-only check, 4.1 step 1; stop if not |
| Pooler behaviour with session options (reuse of a writable server connection) | Avoided: the operator never uses a pooler |
| Holders of the `postgres` credentials / Dashboard users opting out | Not technically preventable; custody precondition 4.1 step 6 |
| Realtime (private channels; `supabase_realtime_admin` sessions) | Owner acceptance (row 16) |
| Deployed `address-lookup` v3 | Owner gate, 4.1 step 7 |
| Provider-first GoCardless actions | Precondition P9: GoCardless unconfigured in production, or the actions switched off |
| GoCardless webhook retry schedule | Provider documentation: 9 attempts at increasing intervals, none after 498, 10 s timeout, manual retry in its Dashboard; intervals not published. Redelivery was simulated, not received from GoCardless. 0 events to date |
| Web and mobile behaviour facing 405/500 (no maintenance UX in either) | Users told in advance; short window |

## 8. Approvals

Separately from backup and migration approval: the owner approves the maintenance configuration (layers A–C and
their reset) and the window time. Before it, preconditions 4.1 steps 5–7 (platform-billing fix or paused delivery,
credentials custody, Edge Function and GoCardless configuration) must be met.
