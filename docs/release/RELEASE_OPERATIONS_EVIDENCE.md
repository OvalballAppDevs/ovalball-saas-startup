# Release Operations Evidence

What was proved, how, and what was not. 8 October 2026, checkpoint `a1eab03`. Every production statement was a
read-only `SELECT` through the Supabase MCP; nothing in production was created, changed, paused or restored. All
rehearsal data was fictional, on disposable local Supabase stacks that were destroyed afterwards.

## 1. Environments

| Name | Built from | Purpose |
|---|---|---|
| `opsrehearsal` (source) | all 751 migrations + repository seeds (fictional) | backup source; quiescence rehearsal |
| `opsrestore` (target) | empty project, seeds disabled; recreated before each restore | restore target |
| `opsmigrate` | exactly the 523 migrations production has + a fictional, production-shaped data set (17 teams, 278 fixtures, 1 message) | migration window under maintenance |

Persistent local database: fingerprinted before (`20270605000000|37|74|86|1588|<functions md5>`) and after — identical;
never connected to by any rehearsal script (each refuses the persistent project id).

## 2. Production facts (read-only)

PostgreSQL 17.6; database owner `postgres` (non-superuser; member of `pg_signal_backend`); 65 MB; ledger 523 / last
`20270502000000`; 4 Auth users; 8 buckets, 392 objects; Vault names `invitation_code_pepper`, `recovery_code_pepper`;
7 cron jobs as `postgres`; `archive_mode` on, 5,913 WAL segments archived, 0 failed; PostgREST 14.5; sessions seen:
`authenticator` (PostgREST), `postgres` (`mgmt-api`), `supabase_admin` (exporter, pg_cron scheduler), pg_net worker as
`postgres`. Default privileges for `postgres` in `public`: `postgres`, `service_role` only. Project objects in
managed schemas: 3 triggers on `auth.users`, 28 policies on `storage`, 2 policies on `realtime.messages`. 0
publications; 6 event triggers (platform). Role settings: none with `default_transaction_read_only` except
`supabase_read_only_user`; no `pgrst.db_pre_request`. `platform_provider_events` 0 rows; `gocardless_events` 0 rows.
Backup schedule, PITR and retention: not readable (UNKNOWN). `supabase backups list` needs an authenticated CLI; it was
stopped rather than logged in.

## 3. Restore rehearsal (Phase 3)

| Step | Result |
|---|---|
| Source boot (751 migrations + seeds) | 56 s |
| Backup taken INSIDE a maintenance window on the source: dump + supplement | 9.1–9.4 s; the source's fingerprint identical before and after the dump |
| Empty target boot | 38 s |
| Restore, one transaction | 7–9 s; exit 0 |
| Vault (allow-listed), cron, ledger | ≈1 s |
| Storage files (API copy, byte-verified, paginated) | ≈2 s for 1–11 objects |

**Defects found in a plain `supabase db dump` restore, all fixed in the committed tooling:**

1. `GRANT SET ON PARAMETER … TO supabase_realtime_admin` in `roles.sql` aborts the restore (platform-managed) — stripped.
2. Three CHECK constraints call functions that read other tables; the data load violates them and
   `session_replication_role` does not suspend CHECKs — dropped before data, re-added `NOT VALID` + `VALIDATE` after
   (detected automatically through `pg_depend`).
3. Two empty Storage-internal tables are not writable by `postgres` — excluded from the data dump.
4. **Security — privileges widened on restore.** pg_dump writes default privileges at the end and only ever adds
   grants. Without alignment the restored database granted `anon` and `authenticated` ALL on every public table (335
   extra table grants; 850 changed function ACLs). With only those two aligned, `service_role` still gained ALL on
   tables where the source limits it — `public.audit_log` (read-only for `service_role` in the source) and others,
   found by the extended fingerprint after the independent review. Fixed: `align-default-privileges.sql` revokes the
   defaults from all three roles before the schema.
5. **Omitted entirely by the dump:** the 3 `auth.users` triggers (no profile on sign-up); storage policies (57 here,
   28 in production); the 2 `realtime.messages` policies (found by the independent review; production has them too);
   Vault secrets (the peppers — invitation and recovery codes fail closed without them); pg_cron jobs; the migration
   ledger; Storage files. All captured by `capture-supplement.sql` or copied separately.
6. **A backup taken inside the maintenance window restores into it:** the PostgREST gate on `authenticator`, the
   `ops_maintenance` schema and every cron job paused (the database-level read-only default is not dumped). The
   restore script reports it; clearance rehearsed (canary 204, 12/12 jobs, HTTP checks pass).
7. **Outbound side effects from a restored copy** (independent review): restored cron jobs call HTTP endpoints, a
   full Vault copy would include endpoint secrets, and notification writes post to Expo for real device tokens. The
   restore script now disables every cron job inside the restore transaction (proved: a backup with 12 jobs captured
   active restored with 0 active and 0 job runs ever recorded), copies only allow-listed Vault names (default: the
   two peppers) and reports the push-token count; the runbook requires removing tokens in a production copy before
   write tests.

**Final cycle** (source quiesced → backup → empty target → `rehearse-logical-restore.sh` → `fingerprint.sql`), compared
category by category with the source's fingerprint taken in the same window:

| Category | Objects | Result |
|---|---|---|
| fn (definitions) | 1,691 | identical |
| col | 3,846 | identical |
| pol (public, internal, storage, realtime) | 680 | identical |
| rel (kind, owner, RLS enabled/forced, effective ACL) | 317 | identical |
| grant (EXECUTE for anon, authenticated, service_role; public + internal) | — | identical |
| tgrant (anon, authenticated, service_role; public + internal) | — | identical |
| trigger (public, internal, auth, storage) | 690 | identical |
| view, idx, seq (last value) | — | identical |
| rows and data (content hash) for every public table | 276 | identical |
| auth (users, identities counts), storage (object and bucket names), ext, pub, evt | — | identical |
| con | 2,083 | 6 differ only in how PostgreSQL prints nested AND brackets after a reload (same meaning, inspected) |
| vault | names | differs by design: only the two allow-listed peppers were copied |
| roleset | 11 | differs by design: the database-level read-only default of the window is not dumped |
| cron | jobs | identical as captured (paused in the window); the script disables every job inside the restore transaction |

Also: `invitation_code_hash` / `recovery_code_hash` of a test code identical on source and target; 12 SQL suites
produce identical output on source and target (earlier cycle) — `recovery_codes`, `invitation_authority_matrix`,
`invitation_joining_closure`, `partner_club_invitations`, `release_hardening_corrections` (58),
`fixture_conversation_invitation_lifecycle` (43), `club_admin_audit_remediation` (45), `person_name_normalisation`
(25), `rugby_code_isolation` (9), `membership_lifecycle_journeys` (24), `fixture_status_lifecycle`, `team_lifecycle`
(one test hits one of two FK violations first, which varies run to run); HTTP on the restored stack — Auth admin
create, sign-in, profile created by the restored trigger, definer RPC write, anon read, Storage served with the same
bytes after the copy (500 before it); Storage copy paginated (proved with a page size of 2 over 11 objects).

**What this proves:** the procedure reproduces every compared property above, from a backup taken by the supported
tool, into an empty Supabase project of the same image. **Not compared or not proved:** the contents of Auth tables (only user and
identity counts are compared; sessions, factors and identity details are not hashed); storage bucket settings beyond
names; large objects (none used); Realtime channel behaviour; that a PRODUCTION backup restores
(not authorised); the platform's backups/PITR; an in-place restore; Storage at production scale.

## 4. Quiescence rehearsal (Phase 6)

`scripts/ops/rehearse-write-quiescence.py --execute` on `opsrehearsal`. Identities: anonymous; a fictional member;
a fictional club admin (active `CLUB_ADMIN` place in a seeded fictional club); the member's token with a React Native
client header ("mobile-equivalent" — the mobile app uses the same anon key + JWT against the same API); the service
role; a hostile SECURITY DEFINER function granted to `authenticated` that tries to switch its transaction back to
read-write; a pg_cron job ticking every 2 s; pg_net (queueing and the worker itself); the GoCardless inbox RPC as the
webhook; a plain `postgres` session as the "stray script"; an open transaction for in-flight; the operator via psql
and `supabase db push`.

A refusal is counted as BLOCKED only with evidence that read-only enforcement refused it — SQLSTATE `25006`/`25001`
or the read-only message in the response, or Storage's `DatabaseReadOnly`. Where the response does not say why:
pg_cron and the pg_net worker count only if the SAME backend (pid in the database log) both ran the job's or worker's
statement and was refused as read-only; Auth counts only if GoTrue's own log shows THAT request failing (by the
probe user, or the refresh grant — whose line carries SQLSTATE 25006 itself) while the database refused a write by
Auth's role as read-only. Any other failure (401, 503, a refused connection, an unrelated error) is ERROR and fails.

**Run 1 — database default + session termination only: 9 unexpected.** Member, mobile-equivalent, club admin,
service role, hostile definer and webhook writes all SUCCEEDED in the window: PostgREST's write transactions are
explicitly read-write. This is why layer C exists.

**Final run — layers A + B + C, strict evidence: 53 checks, 53 as expected.**

| Phase | Result |
|---|---|
| OPEN (negative controls) | every path writes, incl. the zero-row canary (204) and the pg_net worker |
| NO-TERM | with the database default set but sessions not terminated, a member write still succeeds — termination is required |
| WINDOW | in-flight transaction rolled back (client saw `terminating connection due to administrator command`; 0 rows); anon read 200; signed-in read 200; member / mobile / club admin / service role / webhook / canary: 405 `25006`; hostile definer: 500 `25001`; Auth sign-in and refresh: 500 with `supabase_auth_admin … read-only transaction` in the log; Storage `DatabaseReadOnly`; stray `postgres` insert refused; pg_net queueing refused; the pg_net worker's own writes refused (it restarts repeatedly, so nothing queued is sent until reopening); a cron job deliberately LEFT ACTIVE wrote nothing (its inserts refused in the log); operator psql with `PGOPTIONS` wrote (DDL + DML); the same without the opt-out refused; `supabase db push` with `?options=-c default_transaction_read_only=off` applied a migration |
| REOPEN | every path writes again; the webhook refused in the window is claimed once and skipped on redelivery (1 row); new sessions not read-only; cron 12/12; pg_net worker running without refusals |
| Timings | enter 5.4 s (3 s drain); reopen 0.7 s; PostgREST answering 0.5 s after |

**Migration window** (`opsmigrate`, 523 → 751): enter maintenance (7 jobs paused); canary member and service-role
writes refused; `supabase db push` with the operator opt-out applied all 228 pending migrations in 7.8 s; 15
service-role writes attempted DURING the push were all refused, 0 rows written; ledger 751 / `20270764000000`; 757
merged 278 fixtures into 184 conversations, message kept; reopen 0.8 s; sign-in 200; member write 204; cron 12/12.
The upgraded schema equals a fresh full-chain build in functions, columns, policies, function grants, table grants
and triggers (0 differences).

**Limits, stated:** the operator opt-out is a session setting any holder of the `postgres` credentials (or a
Dashboard user) can also use — the database cannot forbid it, so credential custody is a precondition. The operator
must use the direct connection; pooler behaviour was not rehearsed. **NOT VERIFIED (production-only):** PostgREST 14.5
honouring the in-database pre-request setting (the zero-row canary checks it in the window); Realtime; the deployed
`address-lookup` v3; GoCardless's retry schedule; web and mobile behaviour facing 405/500.

**Defects found outside this task's authority (documented, not fixed):**
- `app/api/platform-billing/webhooks/route.ts` answers 200 when its inbox write fails, so an event during the window
  (or any outage) is acknowledged and lost. 0 events in production to date. Release precondition P4.
- GoCardless provider-first actions (`lib/payments/gocardless/cancel-membership.ts`, the OAuth callback) change the
  provider before the database; the gate stops only the local write. Inert while production leaves GoCardless
  unconfigured (precondition P9).

## 5. Independent review (Codex, read-only) and disposition

| # | Finding | Disposition |
|---|---|---|
| 1 | Any `postgres`-credentialled client can use the operator opt-out; role-level fallback exempts cron/pg_net/Dashboard | Accepted. Fallback removed; the limit is stated; credential custody is precondition P10 / 4.1 step 6. |
| 2 | Plan allowed accepting platform-billing event loss | Accepted. P4 is now a hard precondition (tested fix or verified paused delivery). |
| 3 | Provider mutations happen before the database write | Accepted. Inventory rows 9 and 9a; precondition P9. |
| 4 | Realtime policies not captured or compared | Confirmed (2 policies lost in the earlier restore; production has 2). Fixed in capture and fingerprint; re-proved. |
| 5 | "Blocked" could mean an unrelated failure | Accepted. Strict evidence classification; re-run 53/53. |
| 6 | Missing gates for Realtime / Edge Function; pg_net worker unproven | Gates added (4.1 step 7, row 15/16 owner acceptance); worker enforcement now proved from the log, per backend. |
| 7 | Pooler option forwarding does not prove isolation | Accepted. The operator uses the direct connection only; pooler path not used. |
| 8 | "Exact restore" overclaimed | Accepted. Fingerprint extended (RLS flags, owners, effective ACLs incl. service_role, constraints, views, indexes, sequences, publications, event triggers, role settings); this exposed the `service_role` grant defect, now fixed; claims narrowed to what is compared. |
| 9 | Escaped project_id could pass the persistent-project check | Accepted. All three scripts require exactly one plain `project_id` line of `[a-z0-9-]`. |
| 10 | Storage listing not paginated | Accepted. Paginated; reconciles that every listed object is served after the copy. |
| 11 | Restored copies can reach real endpoints | Accepted. Cron disabled, Vault allow-list, push-token report, runbook isolation step. |

**Second review (Codex, read-only) of the revisions:** no P0. P1 — cron was disabled after the restore committed,
leaving a moment where restored jobs were active: fixed (disabled inside the transaction; re-proved). P1 — Auth,
cron and worker evidence was not tied to the specific request or backend: fixed (per-backend and per-request
correlation; the stricter check then caught a real gap in the pattern — GoTrue's refresh fails on `SELECT FOR
UPDATE`, two words — fixed; re-run 53/53). P2 — "proven exact" and "every category must match" overstated: qualified
with the named exceptions. P2 — the plan presented GoCardless's own retry as proved: separated from the proved inbox
behaviour.

## 5a. Final release preconditions (8 Oct, after `5e38eb8`)

**Platform-billing webhook — the defect, confirmed in the code.** `app/api/platform-billing/webhooks/route.ts`
(as deployed at `6d32f5b` and as committed at `5e38eb8`) caught every per-event error, logged it and answered
`200 {ok:true}`: (1) an inbox write refused by the database — an outage, a lost response, or the maintenance gate
(SQLSTATE 25006) — acknowledged an event that was never recorded; (2) an event recorded and then failed was skipped
by every redelivery, because `record_platform_provider_event` returned null on any conflict; (3) the errors of the
three writes that move billing state (`apply_platform_payment_status`, `attach_platform_subscription_provider`, and
the reads before them) were never read, so a failed write was marked processed; (4) an invalid signature answered
401 where GoCardless documents 498.

**Fix.** Migration `20270765000000_platform_billing_events_never_lost.sql` gives `platform_provider_events` the claim
the member inbox has had since 744 (`attempts`, `claimed_until`, `last_attempt_at`), with an OWNER: `attempts` is the
claim's generation, returned by `claim_platform_provider_event`, and `mark_platform_provider_event_processed` and
`platform_provider_event_claim_held` require it — so a delivery that outlives its two-minute lease can neither
release nor mark its successor's claim, and the route re-checks its claim immediately before every state write.
`record_platform_provider_event` keeps its signature (the deployed route still calls it until the cutover).
`platform_provider_event_processed(text)` answers "done?"; a late failure report cannot un-process an event. The
route answers 2xx only when every event in the delivery is processed or was already processed; 500 when any event
could not be recorded, failed, lost its claim, or is held right now by another delivery; 498 on a bad signature; 400
(nothing recorded) on a malformed delivery, an event without id/type/action, or a payment/billing-request/mandate
event without its string link; 503 when unconfigured. It logs event ids and counts only.

| Proof | Result |
|---|---|
| `supabase/tests/js/platform_billing_webhook.test.mts` — real route, real database, GoCardless stubbed; A–M incl. database unreachable, injected 25006, failing payment write, GoCardless 500, 5 concurrent duplicates, lost answers after commit, mixed batch, a delivery outliving its claim, unlinked supported events, log/answer secrecy. Refuses a non-local API and proves API and SQL container are one database before the route writes (both guards exercised: refused, no residue) | **13/13**, twice |
| The same suite against the OLD route (mutation check) | 12 fail: C, D, E, I, J, K, M on the defect itself (200 where 500 is required); A, B, H on the new answer shape; F because a signed `null` body crashes the old route; G on 401 vs 498 |
| `supabase/tests/platform_gocardless.sql` (canonical gate) with 7 new claim checks (2a–2g) | **25/25** |
| Canonical isolated clean boot, all 752 migrations (run three times, the last on the final migration) | **PASS** (120 suites, 0 failed) |
| Billing/payment/security JS suites (gocardless ×7, service_role_usage, session_boundary_coverage, api_schema_perimeter, the new one) | **90/90** |
| SQL suites matching platform/gocardless/payment/membership/perimeter/finance/referral (45 files) | All canonical-gate suites pass; 4 non-gate suites fail or error identically with no reference to this inbox (`gocardless_membership_operations_regression`, `gocardless_policy_lock_regression`, `gocardless_sibling_discount_regression` — SPECIAL_PURPOSE; `side_project_1_membership_status_pending` — UNVERIFIED): outside this change |
| Web typecheck; eslint on the changed files; SQL suite registry | clean; clean; PASS (398 files) |

**Under the real maintenance gate** (disposable clean-boot stack; runbook 4.2 and 4.5 SQL verbatim; the real route;
GoCardless stubbed): open → 200 processed; canary 405 in the window; a new event → **500**, nothing recorded, payment
untouched; three more redeliveries → 500, still nothing; a redelivery of an already-processed event → 500 (its
claim is an upsert, i.e. a write) — safe, acknowledged after reopening; reopen → canary 204, cron 12/12; redelivery →
200 processed once (attempts 1); again → 200 duplicate; one `payment_confirmed` history row; GoCardless called only
by GET; no other outbound request. **Simulated:** the redelivery. **Provider's guarantee, not proved here:** that
GoCardless redelivers — documented as 9 attempts at increasing intervals (intervals not published), none after 498,
10 s timeout, manual retry from its Dashboard.

**Restore isolation hardening.** `rehearse-logical-restore.sh` now removes push device tokens and empties the
pg_net queue INSIDE the restore transaction (opt-out `--keep-push-tokens`), printing the tokens' count and content
hash first; names those optional tables only in dynamic SQL; checks the restore's own exit status; and refuses any
Vault name but the two peppers. Proved on disposable targets: a fictional token → `1|f172dc0a…` printed, 0 tokens, 0
queued, 0 cron jobs active at commit; on a database without the tables the new queries answer `n/a` while the old
reporting expression errors; a deliberately broken backup → "RESTORE FAILED (psql exit 3)", exit 1, target empty;
`--vault-names …,gocardless_replay_secret` → REFUSED. None of the outbound channels Ovalball uses exists in today's
production (below). **Not solved by the script:** the Supabase CLI publishes the local stack on all interfaces, so a
network-exposure control is a precondition of any production-derived restore (backup runbook).

**Production, read-only (Supabase MCP `SELECT` and Edge Function source read only):** ledger 523 /
`20270502000000`; parked `20270554000000` absent; 229 pending, 0 remote-only; PostgREST 14.5; no gate or read-only
setting beyond `supabase_read_only_user`; 7 cron jobs active; WAL 5,950 archived, 0 failed; extensions without
pg_net; no function calling `net.http_*`; no push-token table; Vault names = the two peppers; 0 GoCardless merchant
connections, 0 member events, 0 platform events, 0 platform payments, 1 platform subscription without provider ids;
4 Auth users; 392 Storage objects; 65 MB; the 7 cron commands are plain `select internal.…()` / `public.…()` calls. Deployed Edge Functions: `address-lookup` only (v3, `verify_jwt` on) — no
database client. Backups, PITR, plan: UNKNOWN (not readable without a login). Vercel environment: UNKNOWN (no
read-only access here). Persistent local database fingerprint unchanged
(`20270605000000|37|74|86|1588|0f013c9b…`); it does not yet have `20270765000000`, so the new JS suite needs that
migration applied locally (by the owner) before it can pass there.

**Third review (Codex, read-only) of this work, and disposition:**

| # | Finding | Disposition |
|---|---|---|
| P0 | The new JS suite writes through the route to whatever API URL is configured; with production credentials it would write test events to production | Accepted. The suite refuses a non-loopback API before any write and proves (by reading its own fixture through the API) that the API and the SQL container are the same database before the route is called; both refusals exercised |
| P1 | An expired claimant could clear or mark its successor's claim; a stalled delivery could apply stale state | Accepted. Claim generation returned and required for mark/release (test M, SQL 2f). The verification pass then found the check and the write were separate transactions: now `apply_platform_payment_status_for_event` / `attach_platform_subscription_provider_for_event` lock the event row and check the claim in the write's own transaction (PT409 otherwise; SQL 2g) |
| P1 | The restore's optional-table queries fail when the table does not exist (today's production) | Confirmed (old expression errors on such a database). Fixed with dynamic SQL; re-proved |
| P1 | A failed restore was reported as committed (`|| true` over the pipeline) | Confirmed. Exit status captured and checked; broken backup → RESTORE FAILED, exit 1 |
| P1 | Startup cleanup could delete another live run's fixtures and injections; teardown asserted globally | Accepted. Only abandoned runs (club older than an hour, or an injection with no club) are swept; assertions scoped to the run |
| P1 | A signed payment/billing-request/mandate event without its link was recorded, skipped and acknowledged | Accepted. Batch refused with 400 before anything is recorded; F extended |
| P2 | Outbound-isolation claims broader than the evidence; Vault names not enforced; future copies may hold merchant tokens | Accepted. Cron commands read; claims narrowed to the channels inspected; Vault allow-list enforced by the script; credential presence vs inactivity distinguished |
| P2 | 127.0.0.1 as a destination does not prove loopback-only exposure | Confirmed (`0.0.0.0` bindings on this Mac). A network-exposure control is now a blocking precondition of the restore |
| P2 | Fingerprint exception omitted `rows` | Fixed |
| P2 | Cryptographic erasure needs a dedicated key | Fixed (a key made for that backup alone) |

**Verification pass (Codex, read-only):** no P0. P1 — check and write in separate transactions: fixed as above. P1 —
the legacy calls (`record_platform_provider_event`, a mark without a generation) are unfenced: kept only so the route
deployed today keeps working until the cutover; this migration is applied inside the maintenance window, where the
gate refuses every API write, and the new route is deployed before reopening, so the unfenced path never runs against
an open database (stated in the migration). P2 — the stale-run threshold could still sweep a run suspended for over
an hour: raised to 24 hours (a run takes seconds); no liveness lock, stated. P2 — two "none possible"/"cannot make an
outbound request" phrasings: narrowed to the channels inspected.

Residual, stated: retry exhaustion — after GoCardless's 9 attempts an unprocessed platform event stays in the inbox
with its error and needs a manual resend from GoCardless (no automatic replay worker for this inbox); processing
several events sequentially with rate-limit waits can exceed GoCardless's 10 s timeout, which only causes a
redelivery.

## 5b. Restore-target isolation preflight (local, disposable; no production data)

**What the platform does (measured on this Mac, Docker Desktop 29.7.2, Supabase CLI 2.120.0):** a plain
`supabase start` publishes Kong, Postgres, Studio, the mail catcher and analytics on `0.0.0.0` and `[::]`; from the
LAN address `192.168.55.46` the unsafe control answered HTTP 200 and Postgres accepted a connection. A bridge network
created with `com.docker.network.bridge.host_binding_ipv4=127.0.0.1` is IGNORED (its container listened on `*` and
answered on the LAN address). An explicit host IP (`-p 127.0.0.1:…`) is honoured (listener `127.0.0.1` only; LAN
address and `[::1]` refused). A container on an `--internal` network has no egress and no outside DNS, but gets no
published port. The CLI has no bind-address setting; it does take `--network-id` and `-x`.

**Built:** `scripts/ops/restore/docker-loopback-proxy.py` (Docker API proxy: every published port of a container it
creates bound to `127.0.0.1`; host networking and publish-all refused), `restore-target-isolation.py` (`isolate`,
`verify`), `start-isolated-restore-target.sh` (proxy → `supabase start -x vector,logflare,studio,postgres-meta,
edge-runtime,imgproxy,supavisor` → isolate → verify). `rehearse-logical-restore.sh` and `copy-storage-objects.py` run
`verify` before they open the backup or read the source, dry run included, with no flag to skip it.

**Ports of the isolated target** (project `ovalball-isolated-restore`): Kong `127.0.0.1:59321`, Postgres
`127.0.0.1:59322`, mail catcher `127.0.0.1:59324` (Docker and `lsof` agree; Studio 59323 and analytics 59327 were
also loopback-only while they ran, and are no longer started). Auth, REST, Storage and Realtime publish nothing.
After isolation Docker Desktop forwards only Kong's port; Postgres is reached with `docker exec`.

| Control | Result |
|---|---|
| Proxy, plain `docker run`: default publish / explicit `0.0.0.0` | both rewritten to `127.0.0.1`; LAN refused; exec and logs pass through |
| Proxy: `-P` / `--network host` | refused (403), nothing created |
| Isolated target, `verify` (final code) | **ISOLATION VERIFIED** — 234 checks, 0 failed (270 with the full service set, earlier code), ~30 s |
| Non-loopback probes | every published and configured port × every non-loopback address (`192.168.55.46` and 14 IPv6 link-local addresses): all refused |
| Local access | Kong → Auth/REST/Storage 200 on `127.0.0.1:59321`; a sign-up and a magic link worked; the magic-link mail reached only the stack's own catcher |
| Egress, probe in each container's network namespace | TCP to `1.1.1.1:443` blocked and `exp.host` unresolvable from db, auth, rest (distroless), storage, realtime, mail catcher (and, with the full set, studio, meta, edge runtime, analytics, vector); Kong (positive control) open by design |
| Egress through the database's own channel, restored fictional copy | `net.http_get` to Expo push, GoCardless live and sandbox, postcodes.io, Google Places, Resend, SendGrid: all "Couldn't resolve host name"; raw TCP from the db namespace to those hosts, `1.1.1.1:443` and `8.8.8.8:53`: blocked |
| N1 project container published on `0.0.0.0` without the proxy (LAN answered 200) | **FAIL** (binding, listener `*`, LAN connections, non-internal network) → removed → pass |
| N2 a host process on `0.0.0.0` on a configured port | **FAIL** (listener, LAN connection) → stopped → pass |
| N3 db re-attached to the CLI network | **FAIL** (network; TCP and DNS open) → detached → pass |
| N4 Kong route to `example.com` | **FAIL** → restored → pass |
| N5 Docker unreachable | **FAIL** ("could not verify") |
| N6 the persistent project | **FAIL**, refused on its project id before any Docker access |
| N7 whole stack started without the proxy; restore of a sealed (`chmod 000`) fictional backup | preflight **FAIL** (85); restore **REFUSED** exit 2 with no permission error (the backup was never opened); target still empty; Storage copier likewise refused |
| A container mounting a Docker socket (vector, through the proxy socket) | **FAIL** — found during the restart test (its restart also failed on the socket mount); vector is no longer started |
| Restore of the fictional backup into the isolated target | preflight passed; restore committed (276 tables), cron 0 active, tokens 0, queue 0; preflight passes after it |
| `docker restart` of every container | still **VERIFIED** |
| CLI `supabase stop` + plain `start` (data kept) | **FAIL** (49) — the CLI recreates containers on its own network with `0.0.0.0` ports |
| `start-isolated-restore-target.sh` again | **VERIFIED**; restored data intact (276 tables, 13 clubs, cron 0 active) |

**Independent review (Codex, read-only) and disposition.** No P0. P1: Kong upstreams only partly parsed (quoted `url`,
`host:`) and accepted by suffix → exact names only (N10: quoted URL and `host:` to outside → FAIL).
P1: scope by name only → scope is name ∪ CLI project label ∪ containers mounting the target's volumes (N8: database
container renamed and given a route out → FAIL). P1: stopped containers not checked → network checks cover stopped
containers (N9 → FAIL). P1: snapshot/TOCTOU → both tools re-verify when done and stop the target on failure (proved,
above). P1: mounts → only the target's named volumes allowed (N11: `~/.docker` bind mount and a volume named for the
persistent project → FAIL). P2: percent-encoded create path, case-insensitive JSON keys, a client-claimed upgrade
→ path decoded, keys matched case-insensitively, upgrade honoured only for exec/attach/session paths (proved: all
rewritten or refused; a second create on a falsely "upgraded" connection was never processed). P2: probe failures
read as "blocked" → exit statuses parsed, anything unexpected is a failure, Kong control requires TCP and DNS open.
P2: a host relay on another port, UDP → stated as operator custody (not detectable by the preflight). P3: "changes
nothing" and "tampering is caught" → narrowed.

**Verification pass (Codex, read-only):** no P0. P1: Kong still parsed by layout (a flow-style `{url: …}` or a plugin
endpoint missed) → the whole file is scanned, comments and `_comment` metadata excepted, for every URL and every
host/target/upstream value; anything not exactly this stack fails (N10b: flow-style service + `http-log` endpoint to
outside → FAIL; the first scan also flagged prose in `_comment` strings, which Kong ignores — those are now excluded).
P1: a target-named volume could be a bind in disguise → volumes must be the `local` driver with no options (N12 →
FAIL). P1: the scope union could pull in a persistent-project container → any such container makes `verify` fail
and `isolate` refuse (N13, a fake persistent-named container → both refused; the real persistent stack untouched).
P1: the emergency stop used the label only and ignored failures → `restore-target-isolation.py emergency-stop` stops
the whole scope and fails loudly if anything is still running (re-proved: route out given after the preflight →
EMERGENCY STOP → "every container of the target is stopped", 0 running). P1: the Storage copier skipped the re-check
on error paths → any exit from the copy (lost isolation, timeout, byte mismatch, interrupt) stops the target, and it
re-verifies every 100 objects (code-reviewed; not exercised against a populated source). P1: TOCTOU is detection,
not prevention → stated (below). P2: an "upgrade" to a path that does not switch protocol could smuggle a pipelined
create → raw relay only after a real `101` from Docker (proved: `/exec/nonexistent/start` + pipelined create → one
404, connection closed, create never processed).

**Limits, stated.** The post-operation checks DETECT a lost isolation and stop the target; they do not prevent the
seconds of exposure between a change and the check. Nothing in the copy starts an outbound request in that window
(cron disabled; tokens and pg_net queue emptied in the restore transaction), and only the named operator uses the
Mac. A target holding data that is restarted with the plain CLI is exposed until it is isolated
again — the preflight stops a restore or a Storage copy into it, not the restart itself; the runbook therefore forbids
stopping and starting a target holding production data (destroy and restore afresh). Kong keeps a route out by
design; it routes only to the stack (verified, and tampering is caught). The LAN probes run from this Mac against
its own non-loopback addresses (the listener is loopback-only, so no interface can reach it), not from a second
device. Everything here used fictional data; no production backup exists.

## 6. Reproduce

```sh
# quiescence (disposable project dir only; dry run without --execute)
scripts/ops/rehearse-write-quiescence.py --project-dir <disposable> --execute
# restore (empty disposable target; dry run without --execute)
scripts/ops/restore/rehearse-logical-restore.sh --backup-dir <dir> --target-project-dir <disposable> --execute
scripts/ops/restore/copy-storage-objects.py --source-project-dir <a> --target-project-dir <b> --execute
# fingerprints (read-only session)
PGOPTIONS='-c default_transaction_read_only=on' psql "$DB" -X -tA -f scripts/ops/restore/fingerprint.sql
```

Guard checks (each REFUSED with exit 2): every script against the persistent project.
