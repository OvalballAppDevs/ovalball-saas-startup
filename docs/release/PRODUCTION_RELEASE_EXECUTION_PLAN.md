# Production Release Execution Plan

For the release of `main` (local, 16 commits ahead of `origin/main` `6d32f5b` at the time of writing; nothing pushed)
and the 228 pending migrations (`20270503000000` … `20270764000000`) to project `ywwdizmaanbujcfitpcj`.
Written 8 October 2026. **Nothing in this plan has been executed.** Each numbered phase names the approval it needs.

Companion runbooks: `PRODUCTION_BACKUP_RECOVERY_RUNBOOK.md` (Gate 1), `PRODUCTION_WRITE_QUIESCENCE_RUNBOOK.md`
(Gate 2). Evidence: `RELEASE_OPERATIONS_EVIDENCE.md`. Earlier analysis: `docs/RELEASE_READINESS_2026_10_08.md`.

## 0. Preconditions (all must hold before booking the window)

| # | Precondition | Status 8 Oct |
|---|---|---|
| P1 | Platform backup / PITR state confirmed by the owner (Dashboard) | OPEN |
| P2 | Pepper values (`invitation_code_pepper`, `recovery_code_pepper`) held in the owner's secret manager | OPEN — unknown |
| P3 | A production logical backup restored into a disposable environment and verified (Gate 1) | OPEN — needs approval |
| P4 | Platform-billing webhook: a tested code fix (answer 5xx when the inbox write fails, as the GoCardless route does) deployed, or the provider's delivery verified paused for the window. Not a risk to accept: an event arriving in the window is acknowledged and lost | OPEN — owner decision on which |
| P5 | Window booked at low traffic; users told (web and mobile have no maintenance message) | OPEN |
| P6 | `GOOGLE_PLACES_API_KEY` present for `address-lookup`; decision on GoCardless replay Vault secrets (749 is inert without them) | OPEN (from readiness report) |
| P7 | Operator has: the DIRECT database URL for `postgres` (not a pooler; IPv6 or the IPv4 add-on), the service-role key, Vercel access — all typed, none stored in the repo | OPEN |
| P9 | GoCardless still unconfigured in production (`GOCARDLESS_*` unset in Vercel), so provider-first actions (cancel membership, OAuth exchange, mandate/subscription creation) cannot act at GoCardless in the window; if configured, those actions are switched off for the window | OPEN — owner confirms |
| P10 | Credentials custody for the window: only the operator holds the database password and uses the Dashboard (the boundary the database cannot enforce); optional password rotation beforehand is its own approval | OPEN |
| P11 | Deployed `address-lookup` v3 confirmed to write nothing (download its source read-only) or explicitly accepted; Realtime NOT VERIFIED explicitly accepted | OPEN |
| P8 | Data assumptions re-checked read-only on the day: 0 events, 0 event attendance rows with `event_id`, 0 dispensations, 0 tournaments; no fixture message without a conversation; no conversation shared across opposing pairs | Held on 8 Oct; recheck |

## 1. Pre-maintenance (read-only; no production change)

1. `supabase migration list --db-url …` → 523 applied, 228 pending, no remote-only version.
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

One push, in order; each migration commits as a whole; the push stops at the first error. Rehearsal: 228 in 7.8 s.
The owner decides whether the "one migration at a time" practice holds across 228. One push is what was rehearsed;
pushing in batches would mean staging subsets of the migration files, which was not rehearsed.

Checks after the push (all rehearsed on the synthetic production-shaped data):

| Migration | What to check | Expected |
|---|---|---|
| all | `select count(*), max(version) from supabase_migrations.schema_migrations` | 751, `20270764000000` |
| 513, 630 | probe residue: no `TRFIX …` club/user, no new `audit_log` rows from probes | 0 (probes roll themselves back) |
| 544 | `pg_net` installed; geocoding job present | yes |
| 605 | `public.tournament_team_entries` is a view with `security_invoker` | yes; 0 tournaments |
| 729 | `player_fixture_attendance.event_id` gone; every row has exactly one of fixture/training/tournament | 2 rows, both valid |
| 730–731 | event reminder job and its constraint | no failures in `cron.job_run_details` after reopening |
| 742 | `request_/decide_player_dispensation` gone; one dispensation workflow present | 0 dispensations |
| 757 | fixtures 278 → conversations 184; the 1 message in a fixture conversation; the function's own assertions passed (it raises otherwise) | as stated |
| 763 | parties recorded for every fixture conversation | one parties record per conversation (184 expected) |
| 764 | invitation lifecycle objects present; backfill guard satisfied | no error |
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
5. Webhooks: the GoCardless route answers 500 to anything refused in the window, and the inbox claims a redelivered
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
