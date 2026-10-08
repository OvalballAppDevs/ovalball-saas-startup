# Production Backup and Recovery Runbook

Project `ywwdizmaanbujcfitpcj` (Ovalball production). Written 8 October 2026 at checkpoint `a1eab03`.

**Gate 1 status: NOT PASSED.** The procedure below has been rehearsed end to end on disposable local stacks and
reproduces every compared property of a database exactly — the comparison and its known gaps are listed in
`RELEASE_OPERATIONS_EVIDENCE.md`. No production backup has been taken or
restored, and the platform's own backup and point-in-time recovery settings could not be read. The gate passes
only when a current production backup has been restored into a disposable environment and verified, through an
owner-approved run of this runbook.

Nothing in this runbook has been run against production. Every production step below needs the owner's explicit
approval at the time, as listed in "Approvals".

## 1. What production holds (read-only inspection, 8 Oct 2026)

| Item | Value |
|---|---|
| PostgreSQL | 17.6; database `postgres` owned by `postgres` (not a superuser) |
| Size | 65 MB |
| Migration ledger | 523 versions, last `20270502000000` |
| Auth | 4 users |
| Storage | 8 buckets, 392 objects (files are NOT in any database dump) |
| Vault | 2 secrets: `invitation_code_pepper`, `recovery_code_pepper` (names only were read) |
| pg_cron | 7 jobs, all run as `postgres` |
| Project objects in Supabase-managed schemas | 3 triggers on `auth.users`; 28 policies on `storage` tables |
| Default privileges | `postgres` in `public`: tables, sequences, functions granted to `postgres` and `service_role` only |
| WAL archiving | `archive_mode` on; 5,913 segments archived, last 05:16 UTC 8 Oct, 0 failed |

## 2. Backup capabilities

| Capability | Status | Notes |
|---|---|---|
| Continuous WAL archiving | **VERIFIED (exists)** | `pg_stat_archiver`. Proves WAL is shipped somewhere; does NOT prove a restorable backup, its retention, or that PITR is enabled on the plan. |
| Platform daily backups | **UNKNOWN** | Not exposed to read-only SQL. `supabase backups list --project-ref …` needs an authenticated CLI session; it was not completed (no login attempted). Owner: Dashboard → Database → Backups. |
| Point-in-time recovery | **UNKNOWN** | Plan add-on; same as above. |
| Platform restore in place (same project ref) | **UNKNOWN** | Depends on the two rows above. The only recovery path that keeps the project ref, API keys, JWT secret, Auth sessions and the mobile build's baked-in URL. |
| Platform "restore to a new project" | **UNKNOWN** | As above. |
| Logical backup (`supabase db dump` + supplement) | **AVAILABLE; rehearsed on disposable stacks** | Read-only against the source. Restores into an EMPTY project. Every compared property matched, with three explained exceptions (section 7). |
| Storage file export | **AVAILABLE; rehearsed on disposable stacks** | Through the Storage API with the service role (`scripts/ops/restore/copy-storage-objects.py` shows the method; it only accepts local stacks). |
| Last known restore point | 5 Sep 2026 manual dumps (`~/ovalball-deploy-backups`) | Never restored; predates 30+ days of data. Not acceptable as the release backup. |

## 3. Proposed targets and owners (PROPOSALS — not agreed)

These are proposals for the owner to accept, change or reject. None has been agreed.

- **RPO for the release window: zero writes lost.** Writes are quiesced before the backup is taken (see the
  quiescence runbook), so the backup is the exact pre-migration state.
- **RPO in ordinary running:** whatever the platform plan provides (UNKNOWN). Proposal: enable PITR before mandates
  and payments go live.
- **RTO for a release failure:** proposal 60 minutes to a decision, 2 hours to service. The rehearsal timings
  (section 6) show the logical restore itself is minutes; the time goes on decision and verification.
- **Owners (proposal):** the product owner decides restore vs fix-forward and approves every production step; one
  named operator runs the commands; a second person (or Codex review of the transcript) checks each verification.

## 4. Restore or fix forward?

Pending migrations 605, 729, 742 and 757 cannot be reversed (a table becomes a view, a column and functions are
dropped, conversations are merged), so "rollback" means restore. Decide in this order:

1. **Fix forward** when a migration fails cleanly (each migration commits or not as a whole; 757 and 763 refuse to
   half-apply), the cause is understood, and a corrected migration can be reviewed and rehearsed on a disposable
   stack from the same ledger point. Writes stay quiesced throughout.
2. **Restore** when data is damaged or lost, when the database is in a state no rehearsal has reproduced, when the
   fix needs more than the agreed RTO, or when the owner says so.
3. **Which restore:** the platform's in-place restore if it exists (keeps the project ref and every client
   working). A logical restore into a NEW project is the proven fallback, at these costs: new project ref and keys;
   every user signs in again (new JWT secret); web environment variables change; the mobile app reads
   `EXPO_PUBLIC_SUPABASE_URL` at build time (`apps/mobile/app.config.ts`), so installed apps need a new build;
   OAuth redirect URLs, the Auth hook configuration, Edge Function secrets and the `address-lookup` deployment are
   recreated by hand. An in-place LOGICAL restore over the existing project has NOT been rehearsed and must not be
   improvised.

## 5. Taking the release backup (production — needs approval)

Run from the operator's machine. All capture steps only read. Keep every output off the repository and out of
shared logs: the data dump contains personal data.

1. **Quiesce writes first** (quiescence runbook, "Enter maintenance"), so the backup is the final pre-migration
   state. A backup taken before quiescence is still a valid backup, but writes after it would be lost on restore.
2. Confirm the platform backup state in the Dashboard and record it (time of last daily backup, PITR window).
3. Logical dump, three parts, into a new dated folder outside the repository:

   ```sh
   export PGOPTIONS='-c default_transaction_read_only=on'      # the session cannot write, whatever is run
   supabase db dump --db-url "$PROD_DB_URL" --role-only -f roles.sql
   supabase db dump --db-url "$PROD_DB_URL" -f schema.sql
   supabase db dump --db-url "$PROD_DB_URL" --data-only --use-copy \
     -x storage.buckets_vectors -x storage.vector_indexes -f data.sql
   ```

   `$PROD_DB_URL` is the DIRECT database connection (the same one the quiescence runbook requires), typed by the
   operator, never stored in a file in the repository. pg_dump only reads in any case; `PGOPTIONS` makes the whole
   session refuse writes as well (verify with `show default_transaction_read_only` → `on`).

4. The supplement — what the dump leaves out — from the same read-only session:

   ```sh
   for part in managed defer recheck cron ledger vaultnames; do
     psql "$PROD_DB_URL" -X -tA -v ON_ERROR_STOP=1 -v part=$part \
       -f scripts/ops/restore/capture-supplement.sql > $part.sql
   done
   ```

5. **Vault values** are NOT captured by any script. Confirm the two pepper values are held in the owner's secret
   manager. They are irreplaceable: without them every existing invitation code and account recovery code stops
   validating (the functions refuse rather than fall back — proven in the rehearsal). If they are not already held
   outside the database, an owner with Dashboard access copies them into the secret manager before the window.
6. **Storage files:** export all 392 objects with the service role through the Storage API (or the Dashboard), into
   the same dated folder, keeping bucket and path. Record count and a SHA-256 per file.
7. **Checksums and custody:** `shasum -a 256 * > SHA256SUMS`; store the folder encrypted, in two places, under the
   owner's control. Record the dump time, ledger version and row counts (section 7) beside it.

## 6. Restoring a logical backup into an empty project

Rehearsed on disposable stacks; the commands below are exactly what `scripts/ops/restore/rehearse-logical-restore.sh`
runs. For a real recovery the target is a newly created, empty Supabase project.

One transaction, in this order:

| Step | File | Why |
|---|---|---|
| 1 | `roles.sql` minus `GRANT SET ON PARAMETER …` | That line is platform-managed; `postgres` may not grant it and the restore aborts. |
| 2 | `scripts/ops/restore/align-default-privileges.sql` | **Security.** pg_dump writes default privileges at the end, so every object would first inherit the new project's defaults (ALL to `anon`, `authenticated` and `service_role`) and keep them — the dump only ever adds grants. Rehearsal without it: 335 extra table grants and 850 changed function ACLs; with only anon/authenticated revoked, `service_role` still gained ALL on `public.audit_log` (read-only in the source). |
| 3 | `schema.sql` | Expect warnings "no privileges were granted for gtrgm_…/similarity…": `pg_trgm` lives in `public` and is owned by the platform. Harmless. |
| 4 | `managed.sql` | The 3 `auth.users` triggers (profile creation, account security bootstrap, email sync), the storage policies and the 2 `realtime.messages` policies (private channels). Without them sign-up creates no profile, Storage denies everything and private Realtime channels are refused. |
| 5 | `defer.sql` | Drops the CHECK constraints that call functions reading other tables (3 today). `session_replication_role` does not suspend CHECKs, and table order breaks them. |
| 6 | `data.sql` under `SET session_replication_role = replica` | Triggers off for the bulk load, as Supabase documents. |
| 7 | `recheck.sql` | Re-adds those CHECKs `NOT VALID`, then `VALIDATE` — every row is checked. |
| 8 | `cron.sql`, `ledger.sql` | pg_cron jobs (with their paused/active state) and the migration ledger — neither is in the dump. |

```sh
psql "$TARGET_DB_URL" -X --single-transaction -v ON_ERROR_STOP=1 -q \
  -f roles.restore.sql -f align-default-privileges.sql -f schema.sql -f managed.sql -f defer.sql \
  -c 'SET session_replication_role = replica' -f data.sql -c 'SET session_replication_role = origin' \
  -f recheck.sql -f cron.sql -f ledger.sql
```

Then, outside that transaction:

- **Vault:** `select vault.create_secret('<value>', '<name>', '<description>');` for each secret, values typed from
  the secret manager.
- **Storage files:** upload each exported file to the same bucket and path (`x-upsert: true`); the object rows
  already exist from the data load. Copy only objects that have a row; report any row without a file.
- **Maintenance residue.** A backup taken inside the maintenance window (as the release plan does) carries the
  window with it: `roles.sql` sets `pgrst.db_pre_request` on `authenticator` (every REST/RPC write refused),
  `schema.sql` contains `ops_maintenance`, and `cron.sql` records every job paused. The database-level read-only
  default is NOT in the dump. The restore script reports all three. Clear them deliberately, once the restore is
  verified and the owner wants writes on:

  ```sql
  alter role authenticator reset pgrst.db_pre_request;
  notify pgrst, 'reload config';
  drop schema if exists ops_maintenance cascade;
  -- resume ONLY the jobs that were active before the window (the release log's cron record):
  select cron.alter_job(jobid, active := true) from cron.job where jobname in ( /* recorded list */ );
  ```

  Rehearsed: before clearing, the restored target refused writes and had 0 of 12 jobs active; after, the zero-row
  canary answered 204, 12 of 12 jobs were active and the HTTP checks passed.
- **Platform configuration** (new project only): Auth providers, redirect URLs, SMTP, Auth hooks, API settings,
  Edge Function `address-lookup` and its secret, network restrictions — none of these are in the database.

### Outbound isolation (any restore of PRODUCTION data into a rehearsal environment)

A restored copy of real data can act on the outside world. `rehearse-logical-restore.sh` therefore disables every
cron job INSIDE the restore transaction, so none is ever active after the commit (jobs call HTTP endpoints through
pg_net), copies only the named Vault secrets (default: the two
peppers — never the GoCardless replay URL or bearer secret), and reports how many push device tokens the copy holds:
any write that raises a notification posts to Expo for each of them. Before a write test on a production copy:
`delete from public.push_device_tokens;` in the COPY (or block the target's outbound network), and keep cron
disabled. Never run a rehearsal copy with production's provider credentials.

## 7. Verifying a restore

All of these passed in the rehearsal; a production restore rehearsal must pass the same list.

1. **Fingerprints** — `scripts/ops/restore/fingerprint.sql` (read-only) on source and target: functions, columns,
   policies, function grants, table grants, triggers, extensions, row count AND content hash per public table, auth
   counts, storage rows, Vault names, cron jobs, plus relation flags and effective ACLs, constraints, views, indexes,
   sequences, publications, event triggers and role settings. Every category must match, with exactly these known
   exceptions (`-v detail=1` names each differing object; anything else is a failure):
   - `con`: a constraint whose nested AND clauses PostgreSQL prints with different brackets after a reload (same
     meaning — inspect each; 6 in the rehearsal);
   - `vault`: names not restored by design (only the allow-listed secrets, or those entered from the secret manager);
   - `roleset`: the database-level read-only default of a maintenance window, which pg_dump does not carry; and,
     once residue is cleared, the PostgREST gate setting on `authenticator`;
   - `cron`: compare against the CAPTURED state — the restore disables every job for isolation.
   For a backup taken in the window, compare with the source's fingerprint taken in the same window.
2. **Ledger** equals the source (count and last version).
3. **SQL suites** from `supabase/tests` run on the target behave identically to the source (rehearsal: 12 suites,
   including `recovery_codes`, `invitation_authority_matrix`, `release_hardening_corrections`,
   `fixture_conversation_invitation_lifecycle`, `club_admin_audit_remediation`).
4. **HTTP:** a fictional user created through Auth gets a profile (the restored trigger); signs in; a
   SECURITY DEFINER RPC write succeeds; an anonymous read succeeds; a Storage object downloads with the right bytes.
   On a production-derived restore, run these only in the disposable target, never against production.
5. **Peppers:** the same test code hashes identically on source and target —
   `select md5(encode(internal.invitation_code_hash('X'),'hex') || encode(internal.recovery_code_hash('X'),'hex'))` —
   which proves codes issued before the restore still validate after it (rehearsal: identical).

## 8. Not verified

- The platform's backup, PITR and in-place restore (section 2).
- Whether the direct connection is reachable from the operator's network (IPv6, or the IPv4 add-on).
- Realtime private-channel behaviour after a restore: the 2 `realtime.messages` policies are captured and restore
  identically (fingerprint), but channel authorisation was not exercised.
- A restore of a PRODUCTION backup (not authorised in this task). Production carries data shapes the synthetic
  rehearsal data may not (for example function-based CHECKs over real rows).
- Storage export at production scale (392 objects; sizes not read).
- In-place logical restore over an existing project.

## 9. Approvals

Each needs the owner's explicit approval, separately: (a) taking the production backup (sections 5.3–5.7);
(b) restoring it into a disposable environment and verifying (sections 6–7) — this is what passes Gate 1;
(c) any production restore.
