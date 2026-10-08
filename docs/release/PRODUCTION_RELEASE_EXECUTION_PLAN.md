# Production Release Execution Plan

For the release of `main` (local, ahead of `origin/main` `6d32f5b`; nothing pushed) and the **229** pending
migrations (`20270503000000` … `20270765000000`; 228 until the platform-billing webhook fix added
`20270765000000`) to project `ywwdizmaanbujcfitpcj`. Written 8 October 2026; preconditions re-classified the same day
from read-only production evidence. **Nothing in this plan has been executed.** Each numbered phase names the
approval it needs. The owner's checklist is section 9.

Companion runbooks: `PRODUCTION_BACKUP_RECOVERY_RUNBOOK.md` (Gate 1), `PRODUCTION_WRITE_QUIESCENCE_RUNBOOK.md`
(Gate 2). Evidence: `RELEASE_OPERATIONS_EVIDENCE.md`. Earlier analysis: `docs/RELEASE_READINESS_2026_10_08.md`.

## 0. Preconditions (all must hold before booking the window)

Status words: **VERIFIED** (read-only production evidence or code + tests), **UNKNOWN** (cannot be read without a
login or a change), **OWNER DECISION** (only the owner can settle it), **BLOCKED** (cannot proceed as things stand).
A gate that passed only on a disposable stack is never VERIFIED here.

| # | Precondition | Status (8 Oct, after the webhook fix) |
|---|---|---|
| P1 | Platform backup / PITR state confirmed by the owner (Dashboard) | **UNKNOWN.** Plan, daily backups, PITR and retention are not readable read-only; WAL archiving is on (5,950 segments, 0 failed) but that is not a restore point. Supabase documents no automatic backups on the Free plan. Owner reads the five screens in the backup runbook, section 2 |
| P2 | Pepper values (`invitation_code_pepper`, `recovery_code_pepper`) held in the owner's secret manager | **OWNER DECISION.** Names VERIFIED (exactly these two Vault secrets in production; values never read). Escrow procedure below (section 9 D) |
| P3 | A production logical backup restored into a disposable environment and verified (Gate 1) | **BLOCKED on approvals** (backup creation, then restore). The isolated target is implemented and proved with fictional data: loopback-only ports, no route out, a fail-closed preflight the restore runs before opening the backup (backup runbook, "Restore isolation") |
| P4 | Platform-billing webhook cannot acknowledge and lose an event in the window | **CODE FIXED, NOT DEPLOYED.** Fix + migration `20270765000000` + 13 route tests + 7 SQL checks + rehearsal under the real gate. The deployed route still has the defect, so for the window: **OWNER DECISION** — confirm `GOCARDLESS_PLATFORM_WEBHOOK_SECRET` is unset in Vercel production (then it answers 503 and acknowledges nothing), or disable Ovalball's own GoCardless webhook endpoint for the window (quiescence runbook 4.1 step 5). Production: 0 platform events ever, 0 platform payments, no provider-linked subscription |
| P5 | Window booked at low traffic; users told (web and mobile have no maintenance message) | **OWNER DECISION** |
| P6 | `GOOGLE_PLACES_API_KEY` present for `address-lookup`; decision on GoCardless replay Vault secrets (749 is inert without them) | **OWNER DECISION** (secrets not readable; Vault holds only the peppers today) |
| P7 | Operator has: the DIRECT database URL for `postgres` (not a pooler; IPv6 or the IPv4 add-on), the service-role key, Vercel access — all typed, none stored in the repo | **OWNER DECISION** |
| P9 | GoCardless unconfigured in production, so provider-first actions cannot act at GoCardless in the window | **Database side VERIFIED** (0 merchant connections, 0 member events, 0 platform events/payments, no replay secrets in Vault). **Vercel side UNKNOWN** (environment not readable here): owner confirms no `GOCARDLESS_*` variable is set |
| P10 | Credentials custody for the window | **OWNER DECISION.** Who holds: the `postgres` database password (direct and pooler URLs), Supabase Dashboard access (its SQL editor runs as `postgres`), the service-role key (Vercel and wherever else it is held), Supabase access tokens/CLI logins, Vercel access, GoCardless Dashboard access. For the window: one named operator uses them; everyone else is told not to; no scheduled scripts outside the database. Rotation beforehand is a separate production change and approval. No password is requested or recorded here |
| P11 | Edge Functions and Realtime | **address-lookup VERIFIED writes nothing:** the only deployed function (v3, `verify_jwt` on) was read read-only — no database client, only outbound lookups to postcodes.io and Google Places. **Realtime: OWNER DECISION** to accept NOT VERIFIED: production has 0 publications (no database-change streaming); messaging broadcasts are sent by `realtime.send` inside message writes, which the window already refuses; presence is in memory. Risk: live updates may pause; no application data is written through Realtime |
| P8 | Data assumptions re-checked read-only on the day: 0 events, 0 event attendance rows with `event_id`, 0 dispensations, 0 tournaments; no fixture message without a conversation; no conversation shared across opposing pairs | Held on 8 Oct; recheck |

Also confirmed read-only on 8 Oct: ledger **523 / `20270502000000`** (unchanged), **229 pending, 0 remote-only**;
PostgREST **14.5**; no `pgrst.db_pre_request` and no read-only settings beyond `supabase_read_only_user`; 7 cron jobs,
all active; the parked migration `20270554000000` absent from the ledger; no unapproved production change.
729/742 compatibility risks are unchanged from the readiness report: 729 drops `player_fixture_attendance.event_id`
(2 rows, both valid) and 742 drops `request_/decide_player_dispensation`, which the live web (6d32f5b) calls — hence
the cutover inside the window (section 5). The approved quiescence mechanism is unchanged: layers A–C of the
quiescence runbook.

## 1. Pre-maintenance (read-only; no production change)

1. `supabase migration list --db-url …` → 523 applied, 229 pending, no remote-only version.
2. Quiescence runbook 4.1: the operator's DIRECT connection honours session options (`show default_transaction_read_only`
   with `PGOPTIONS=on` → `on`, port 5432); no existing read-only settings or `pgrst.db_pre_request`; record `cron.job`
   (7 jobs, all active); P4, P9, P10, P11 met.
3. Re-run P8's counts.
4. Prepare the release log: times, outputs, decisions. No secrets or personal data in it.

## 2. Enter maintenance — needs **maintenance approval**

Quiescence runbook 4.2, then 4.3. **Stop (exit maintenance, no migration) if the zero-row canary answers 204 or a
plain session can write.**

## 3. Release backup — needs **backup approval**

Backup runbook section 5, taken inside the window so it is the exact pre-migration state: dump (roles, schema,
data), supplement (managed, defer, recheck, cron, ledger, vault names), Storage file export, checksums, custody.
Record ledger `523 / 20270502000000` and the P8 counts beside it. (If Gate 1 was passed with a backup taken earlier
the same day, this one is still taken: it is the restore point for this window.)

## 4. Migration window — needs **migration approval**

```sh
supabase db push --db-url "$OPERATOR_DB_URL?options=-c%20default_transaction_read_only%3Doff"
```

One push, in order; each migration commits as a whole; the push stops at the first error. Rehearsal: 228 in 7.8 s
(before `20270765000000` existed; that one was proved by the isolated clean boot of all 752, and only alters one
empty table and three functions). The owner decides whether the "one migration at a time" practice holds across 229. One push is what was rehearsed;
pushing in batches would mean staging subsets of the migration files, which was not rehearsed.

Checks after the push (all rehearsed on the synthetic production-shaped data):

| Migration | What to check | Expected |
|---|---|---|
| all | `select count(*), max(version) from supabase_migrations.schema_migrations` | 752, `20270765000000` |
| 513, 630 | probe residue: no `TRFIX …` club/user, no new `audit_log` rows from probes | 0 (probes roll themselves back) |
| 544 | `pg_net` installed; geocoding job present | yes |
| 605 | `public.tournament_team_entries` is a view with `security_invoker` | yes; 0 tournaments |
| 729 | `player_fixture_attendance.event_id` gone; every row has exactly one of fixture/training/tournament | 2 rows, both valid |
| 730–731 | event reminder job and its constraint | no failures in `cron.job_run_details` after reopening |
| 742 | `request_/decide_player_dispensation` gone; one dispensation workflow present | 0 dispensations |
| 757 | fixtures 278 → conversations 184; the 1 message in a fixture conversation; the function's own assertions passed (it raises otherwise) | as stated |
| 763 | parties recorded for every fixture conversation | one parties record per conversation (184 expected) |
| 764 | invitation lifecycle objects present; backfill guard satisfied | no error |
| 765 | `platform_provider_events` has `attempts`, `claimed_until`, `last_attempt_at`; `platform_provider_event_processed(text)` exists and only `service_role` (and owners) may execute the three inbox functions | yes; 0 events |
| — | `cron.job` | 12 jobs (7 paused by us, 5 new active) |
| — | advisors | no new ERROR (two existing definer-view findings are deliberate) |
| — | schema equals the rehearsal's fresh build | spot-check counts: functions, policies, triggers |

**On a failed migration:** writes stay quiesced; go to section 7.

## 5. Application cutover — needs **push/deploy approval**

Still inside the window (the live web, `6d32f5b`, calls functions 742 drops, so the old site must not take writes
against the new schema — and the gate prevents it from taking any):

1. Edge Function: redeploy `address-lookup` from the release commit; confirm its secret.
2. Web: push `main` to `origin` (and/or `vercel --prod`, per `docs/PRODUCTION_HOSTING.md`); wait for the production
   deployment to be live; confirm the deployed commit.
3. Read-only smoke on the new site while still in maintenance: public pages, a signed-in page renders.
4. Mobile: no change in this window. The new native build goes to the stores separately; current installs keep
   working against the upgraded API only as far as their calls still exist — check the mobile build in use calls
   nothing 742 drops.

## 6. Reopen and post-cutover — part of **maintenance approval**

1. Quiescence runbook 4.5 (gate off, database default reset, sessions terminated, the 7 recorded jobs resumed,
   `ops_maintenance` dropped). Canary → 204; new session writable; cron 12/12.
2. Smoke tests with the owner's own accounts (not new production personas): sign-in, Club Admin home, fixtures and
   Match Centre, messaging (a conversation for a merged opponent shows the full history), Season Planner,
   notifications, a Storage upload.
3. Check `cron.job_run_details` for failures since the window opened (jobs created during the push will have failed
   harmlessly under read-only; the next runs must succeed).
4. Monitor Auth, PostgREST and Postgres logs and Vercel errors for 24 hours.
5. Webhooks: after cutover both routes answer 500 to a refused or failed event (the platform-billing one from
   `20270765000000` and its route). If the platform-billing endpoint was disabled at GoCardless for the window
   (P4 b), re-enable it and retry failed deliveries from GoCardless. The GoCardless route answers 500 to anything refused in the window, and the inbox claims a redelivered
   event once and skips it after (proved locally). Whether and when GoCardless actually redelivers is its own retry
   policy — NOT VERIFIED here; after reopening, check GoCardless's webhook log for failed deliveries and resend any it
   has given up on. If the platform-billing provider was paused, resume it.

## 7. Failure decisions

| When | What happened | Decision |
|---|---|---|
| Phase 2 | Canary 204, or a plain session can write | Exit maintenance. Do not migrate. Nothing changed. |
| Phase 3 | Backup fails or cannot be checksummed | Exit maintenance. Do not migrate. |
| Phase 4 | A migration fails cleanly (error, push stopped) | Stay quiesced. Read the error. If understood and fixable within the RTO: correct the migration in the repository, rehearse it on a disposable stack restored to the same ledger point, get approval, push the rest. Otherwise restore (backup runbook §4). |
| Phase 4 | 757/763 assertion fires | It aborted as designed; nothing half-applied. As above; the data assumption it guards (P8) was wrong — investigate before anything else. |
| Phase 4 | A post-push check fails but nothing errored | Stay quiesced. Fix forward if the defect is understood; restore if data is wrong. |
| Phase 5 | Web deploy fails | Stay quiesced; redeploy; the database is already upgraded and the old site must not reopen against it. If the new site cannot be deployed within the RTO: restore the database AND keep the old site — owner decision. |
| Phase 6 | Smoke test fails after reopening | Re-enter maintenance if writes could cause damage; otherwise fix forward with writes open. |
| Any | Operator connection lost | The database stays in maintenance; reconnect with the opt-out. |
| Any | Unsure | Stay in maintenance and ask the owner. Reads keep working; nothing is lost by waiting except availability of writes. |

## 8. Approvals required (separately)

1. **Backup creation** (phase 3, and the earlier Gate 1 backup).
2. **Restore rehearsal** of that production backup into a disposable environment (Gate 1).
3. **Maintenance configuration** (phases 2 and 6: layers A–C and their reset, at the booked time).
4. **Migration execution** (phase 4).
5. **Push and deploy** (phase 5: web push/deploy, Edge Function redeploy; mobile later and separately).

## 9. Owner approval checklist

**A. Still unknown.** Project plan; whether daily backups exist, the newest one's time and retention; PITR and its
window; what a platform restore would do (P1). Whether any `GOCARDLESS_*` variable — in particular
`GOCARDLESS_PLATFORM_WEBHOOK_SECRET` — is set in Vercel production (P4, P9). Whether the peppers are already held
outside the database (P2). PostgREST 14.5 honouring the gate (checked in the window by the canary). Realtime under
read-only. GoCardless's actual retry intervals.

**B. Verified.** Production unchanged (ledger 523 / `20270502000000`; 229 pending; no gate or maintenance settings).
None of the outbound channels Ovalball uses exists in the production database today (no pg_net or other
HTTP-capable extension, no push tokens, plain-SQL cron jobs) — a statement about those channels, not a guarantee of
egress isolation, which the restore design still enforces separately. The deployed Edge Function writes
nothing. No GoCardless activity in the database. Locally: the platform-billing webhook fix (13/13 route tests, 7 of
which fail against the old route on the 200-vs-500 defect itself; 25/25 SQL); the fix under the real maintenance gate
on a disposable stack; the canonical isolated clean boot with all 752 migrations; the billing, payment and perimeter
suites; restore isolation inside the restore transaction (fictional data).

**C. Must be live before the maintenance window.** Nothing new needs deploying first, provided P4 (a) or (b) holds:
the webhook fix itself deploys with `main` during the cutover (phase 5), because the rest of `main` needs the new
schema. If the owner prefers the fix live before the window, that is a separate web deployment and approval.

**D. Proposed production backup operation (the smallest next step).** One logical backup of production, taken
read-only through the DIRECT connection with `PGOPTIONS=-c default_transaction_read_only=on` (backup runbook 5.3–5.4),
plus the Storage export (5.6) and checksums (5.7). No maintenance window, no migration, no deployment, no restore.
Pepper escrow, as its own step before it: an owner with Dashboard access copies the two Vault values into the
secret manager by hand; nothing prints them and no script reads them.

**E. Where the isolated restore would happen.** A disposable local Supabase stack on the owner's FileVault-encrypted
Mac, from an empty project directory with its own id and ports — never a cloud project, never the persistent local
project (backup runbook, "Restore isolation"), started by `scripts/ops/restore/start-isolated-restore-target.sh`:
no container (Kong included) has any route out; the API is reached only through a loopback relay; a fail-closed
preflight runs before anything is opened; a guard detects topology changes and destroys the copy — after the fact
(measured exposure window 1.3–2.3 s, 15–29 outbound connections, for a deliberate change by someone with Docker access). Never stopped and started
while it holds production data — destroyed instead. Custody of the Mac remains the control against a person with
Docker access.

**F. How outbound traffic and personal data are protected.** None of the outbound channels Ovalball uses exists in
today's production database (no pg_net or other HTTP-capable extension, no push tokens, cron jobs are plain SQL).
The restore script still disables every cron job, removes push tokens and empties the pg_net queue inside the
restore transaction, refuses any Vault name but the two peppers, and nothing runs the application against the copy.
Inbound: loopback only, verified from Docker, the host's own sockets and live attempts through every non-loopback
address (E). Data stays on the encrypted Mac with two named people, is never committed
or shared, and is destroyed 24 hours after verification; the release backup is encrypted to a dedicated key and
erased by destroying that key when the owner declares the release stable.

**G. Separate approvals, in order (none implies the next):**

1. Pepper escrow by the owner (Dashboard → Vault, values into the secret manager).
2. **Production backup creation** (D) — the smallest next production action; read-only on production.
3. **Restore rehearsal** of that backup into the isolated local stack (E, F) — passes Gate 1 if it verifies.
4. P4 choice and P9/P10 confirmations (owner statements; P4 (b) is a change at GoCardless).
5. **Maintenance configuration** at a booked time (phases 2 and 6).
6. **Migration execution** (phase 4, 229 migrations).
7. **Push and deploy** (phase 5: web, Edge Function; mobile separately).
