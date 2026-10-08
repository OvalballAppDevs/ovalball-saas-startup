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
