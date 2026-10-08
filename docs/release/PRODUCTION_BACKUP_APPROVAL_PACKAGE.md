# Production backup — approval package (operator-facing)

Prepared 8 Oct 2026 from checkpoint `ca5a284`. Read-only preparation only: **no production backup, export, restore,
write, configuration change, migration or maintenance gate was run.** Two separate approvals are requested at the
end — one for the database backup, one for the Storage export. Approving one approves nothing else.

Operator: **the project owner, sole operator** (owner declaration). Background and restore procedure:
`PRODUCTION_BACKUP_RECOVERY_RUNBOOK.md` sections 5–7.

## 1. Identity and migration status (read-only, 8 Oct 2026)

| Check | Result |
|---|---|
| Repository | `main` at `ca5a2849` or later; no tracked changes before this package |
| Production project | `ywwdizmaanbujcfitpcj`, PostgreSQL 17.6 |
| Cluster identity | `system_identifier` **7678069749886157684** — matches the pinned value in both scripts |
| Migration ledger | **523** applied, last `20270502000000` — unchanged; repository holds 752, so **229 pending** (last `20270765000000`) |
| Maintenance gate | absent: `pgrst.db_pre_request` unset, no read-only defaults, no `ops_maintenance` schema |
| pg_cron | 7 of 7 jobs active |
| Parked migration | `supabase/parked/20270554000000_looking_for_opposition.sql`, sha256 `bb96286c50d919ab…` — unchanged, not applied in production |
| Persistent local database | fingerprint `20270605000000` / 618 ledger rows — unchanged by this work |
| Production Storage | 8 buckets (4 private, 4 public), **392 objects, ~39 MB**: 389 in `club-logos`; nested to depth 3; no user metadata; largest object 1.74 MB |
| Production API keys | legacy JWT keys **enabled** (the Storage export needs the legacy `service_role` key; `sb_secret_…` keys are refused by design, because they carry no project claim to check) |

## 2. Dashboard backup evidence

**Read by the owner in the Dashboard, 8 Oct 2026, 20:02–20:03 (screenshots): the project is on the FREE plan.**
This supersedes the earlier owner declaration that Dashboard backups and PITR were available.

| Item | Status |
|---|---|
| Automated (scheduled) backups | **NONE** — "Free Plan does not include project backups" (Pro: up to 7 days) |
| PITR | **NONE** — "a Pro Plan add-on … starts at $100/month" |
| Latest recoverable point | **none exists on the platform** |
| Retention window | not applicable |
| Restore procedure | not available on this plan |
| Plan limitations | Platform backups (on Pro and above) are physical and exclude Storage objects |

**Consequence: the logical backup and the Storage export below are the ONLY restore point production has.** Gate 1
depends on them entirely. Upgrading (Pro for daily backups; PITR as an add-on) is the owner's billing decision and
is not required to take these backups. Archived WAL (`pg_stat_archiver`) is not evidence of recoverability.

Other setup facts read by the owner in the Dashboard: session-pooler host `aws-1-eu-west-1.pooler.supabase.com` (port
5432 = session mode; user `postgres.ywwdizmaanbujcfitpcj`; resolves to AWS eu-west-1); database root certificate
"Supabase Root 2021 CA", valid to 26 Apr 2031, SHA-256 fingerprint
`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA` (the file downloaded
to the Mac must match it).

## 3. Database backup — exact command (NOT executed)

```sh
mkdir -m 700 -p "$HOME/OvalballBackups/<YYYY-MM-DD>"
# a) PLAN — connects to nothing. Check every line.
scripts/ops/backup/take-production-logical-backup.sh \
  --operator "<owner's name>" \
  --out-dir "$HOME/OvalballBackups/<YYYY-MM-DD>/db" \
  --recipient-cert "<key folder>/ovalball-backup-<YYYY-MM-DD>.crt" \
  --verify-key "<key folder>/ovalball-backup-<YYYY-MM-DD>.key" \
  --db-root-cert "<key folder>/supabase-root-ca.crt" \
  --connection session-pooler --pooler-host "aws-<n>-<region>.pooler.supabase.com"   # or --connection direct
# b) ONLY WITH APPROVAL 1: the same command plus --execute.
#    Prompts: the key passphrase (key-match check), the database password (not echoed), the key passphrase again
#    (round trip).
```

Readiness review (each rehearsed on a disposable stack with fictional data, 8 Oct; evidence in
`RELEASE_OPERATIONS_EVIDENCE.md` §5e–5f):

| Requirement | Met by |
|---|---|
| No backup without `--execute` | Plan mode prints and exits 0; out-dir not created (rehearsed) |
| Identity before any data | Read-only session must report `transaction_read_only = on` and `system_identifier` 7678069749886157684, else exit 3 with nothing dumped |
| No credentials in arguments or logs | Key passphrase typed at openssl's own prompt; production **refuses** a passphrase in the environment. (Rehearsals may set one: it is removed from the environment before any child process starts and handed only to openssl as `-passin env:NAME`; measured: 0 descendant processes carry it, 0 in arguments.) Password via `read -rs` → `PGPASSWORD` of the local Postgres container only; log scrubbed; the CLI is used with `--dry-run` and a placeholder. 47 process-argument samples during a run held no password |
| Read-only session | `PGOPTIONS=-c default_transaction_read_only=on` on every session; pg_dump's own READ ONLY transaction |
| Server authenticated (**new**) | `--db-root-cert` (the project's Supabase root CA, Dashboard → Database → Settings → SSL configuration → Download certificate) is required; every connection uses `sslmode=verify-full`, so libpq checks the chain and host name **before** sending any credential (`require` alone would let an interceptor collect the password and fake the identity answer) |
| Output outside repo and synced folders | refuses repo, iCloud/CloudStorage/Dropbox/Google Drive/OneDrive paths, an existing folder, FileVault off |
| Encrypted before durable storage | plaintext only in `<out>/.plain` (mode 700, umask 077); `tar | openssl cms` straight to the archive |
| Plaintext removed | EXIT trap (signals ignored, `set -e` off inside it) deletes `.plain` and `.verify` on success, failure and INT/TERM/HUP, then **checks** they are gone (else `PLAINTEXT NOT DELETED`, exit 8, archive discarded); `BACKUP VERIFIED` is printed only after that check. Rehearsed: SIGTERM mid-dump → exit 130, only the log left. SIGKILL or power loss cannot be caught: see §11 |
| Failure never reports success | completion markers, COPY-per-table, ledger, cron and pepper-name checks → exit 5; round trip → exit 7; archive and custody file deleted on failure |
| Certificate matches key (**new**) | the verify key's public key must equal the certificate's, before connecting (rehearsed: other certificate → refused; wrong passphrase → refused; nothing created) |
| Trusted digest record (**new**) | the archive SHA-256 printed at `BACKUP VERIFIED` goes into escrow; `verify-backup-archive.py` re-checks against the digest **typed from escrow**, before decrypting |

## 4. Storage export — exact command (NOT executed)

New: `scripts/ops/backup/take-production-storage-export.py` (separate archive, separate custody record).

```sh
# a) PLAN — connects to nothing.
scripts/ops/backup/take-production-storage-export.py \
  --operator "<owner's name>" \
  --out-dir "$HOME/OvalballBackups/<YYYY-MM-DD>/storage" \
  --recipient-cert "<key folder>/ovalball-backup-<YYYY-MM-DD>.crt" \
  --verify-key "<key folder>/ovalball-backup-<YYYY-MM-DD>.key" \
  --db-root-cert "<key folder>/supabase-root-ca.crt" \
  --connection session-pooler --pooler-host "aws-<n>-<region>.pooler.supabase.com"   # or --connection direct
# b) ONLY WITH APPROVAL 2: the same command plus --execute.
#    Prompts: key passphrase, database password, the LEGACY service_role key (Settings → API Keys → Legacy), key
#    passphrase (round trip). None is echoed, passed as an argument or logged.
```

What it does, stopping (and deleting all plaintext) at the first discrepancy:

1. Same preconditions as the database backup, plus the certificate/key match.
2. **Identity:** `sslmode=verify-full` against `--db-root-cert` (server authenticated before any credential is sent); read-only session + `system_identifier`; Storage API pinned to `https://ywwdizmaanbujcfitpcj.supabase.co`;
   the key must decode to `role = service_role` and `ref = ywwdizmaanbujcfitpcj`.
3. **Inventory, read-only:** every bucket (public flag, size limit, MIME allow-list) and every object row (path,
   size, MIME type, cache-control, ETag, user metadata) from `storage.objects`; then the Storage API's own listing,
   paginated (100 per page) through every nested folder, must name **exactly** the same objects.
4. **Export, GET only:** no proxy, redirects refused; each object must be HTTP 200, exactly the inventory size, and
   match its MD5 ETag where it has one; its SHA-256 is recorded.
5. **Manifest** inside the archive (buckets + per-object bucket, path, size, MIME, cache-control, ETag, user
   metadata, SHA-256) — what a restore is verified against.
6. Encrypted separately (`ovalball-storage-export-<stamp>.tar.cms`), round trip: decrypt, re-hash every object.
7. `custody.json` (archive and manifest SHA-256, certificate fingerprint, counts, identity) beside it; the log holds
   counts only — no path, URL, key or password.

Production is never modified: SELECTs in read-only sessions, HTTP GET, and the Storage list endpoint (a read).

**Rehearsal (disposable `ovalball-saas-startup-cleanboot`, 164 fictional objects in 11 buckets, 137 folders in one
bucket to force pagination, depth 4, 1.5 MB object, four cache-control values):**

| Test | Result |
|---|---|
| Plan mode (production target) | prints plan, exit 0, nothing created |
| Full run | EXPORT VERIFIED; 164/164 listed = database; 164 MD5 ETags matched; files mode 600, folder 700; only archive, `custody.json`, `export.log` left |
| Independent check (decrypt by hand) | 164/164 objects byte-identical to a fresh download; MIME + cache-control 164/164 equal to `storage.objects` |
| Injected: wrong identity / object missing from listing / object fetch fails / truncated object / corrupted object / corrupted ciphertext / wrong DB password / anon key / non-JWT key | each **STOPPED, exit 3, only `export.log` left** |
| Wrong key passphrase / certificate of another key | REFUSED before connecting; nothing created |
| Out-dir exists / relative / in repo / iCloud / CloudStorage; foreign pooler host; persistent project as rehearsal | each REFUSED |
| Secrets | service key 0 and distinctive wrong password 0 occurrences in all logs and output; 0 object paths in logs; 19 process-argument samples during a run: 0 secrets; 14 samples: key passphrase 0 in arguments, 0 in docker processes' environment |
| SIGTERM after 32 plaintext objects were on disk | `STOPPED: interrupted`, exit 3, only `export.log` left |
| Zero-byte object; empty export | exported and verified (size 0 accepted); an archive with no objects verifies |
| Production plan without `--db-root-cert` | REFUSED (both scripts); with it, the plan shows `verify-full` |

It is **not** proved at production scale or against production's API; the first real run is the proof, and it
fails closed.

## 5. Encryption and custody verification

**Encryption is LibreSSL `openssl cms -aes256` (AES-256-CBC). It is NOT authenticated encryption.** Rehearsed: a
byte changed in the ciphertext still decrypts with exit 0. Integrity therefore rests on an **independently
protected integrity record**, not on the digest stored beside the archive:

- At `BACKUP VERIFIED` / `EXPORT VERIFIED`, the operator copies the archive SHA-256 (and the certificate
  fingerprint) **into the secret manager entry that holds the key** — escrow, off this Mac.
- `scripts/ops/backup/verify-backup-archive.py --archive <file> --verify-key <key>` asks for the digest from escrow,
  refuses to decrypt on mismatch (exit 4), then checks every file. It hashes and decrypts the **same private copy** of
the archive (made in a mode-700 scratch folder beside it — never `$TMPDIR`, the repository or a synced folder), so a
file swapped after the check is never the one decrypted; it (DB: SHA256SUMS; Storage: every object against the
  manifest) and deletes its plaintext. Rehearsed on both archive types: verified; a wrong escrowed digest → exit 4;
  a tampered archive → refused against the escrowed digest, and caught by the content check even when the digest
  beside it was replaced.

No new tool was installed. `age` (authenticated encryption) remains an owner option, not a requirement under this
design.

| Control | Status |
|---|---|
| Recipient certificate matches the escrowed private key | enforced by both scripts before connecting |
| Key + passphrase recoverable independently of the Mac | OWNER-CONFIRMED (escrowed and recovery-tested) — NOT INDEPENDENTLY VERIFIED |
| Separately trusted integrity record | archive SHA-256 into escrow (operator step, checklist item 9) |
| Destination encrypted, restricted, outside repo | enforced: FileVault on, mode 700/600, repo and synced folders refused |
| Second encrypted copy | **destination not yet named by the owner** (checklist item 6) |
| DB and Storage archives distinguishable | different names (`ovalball-db-backup-*` / `ovalball-storage-export-*`), folders and custody files; each verified on its own |
| No keys or passwords in Git, logs or arguments | rehearsed for both scripts; nothing under `$HOME/OvalballBackups` or the key folder is in the repository |

## 6. Expected artifacts

```
~/OvalballBackups/<YYYY-MM-DD>/            (700)
  db/       ovalball-db-backup-<stamp>.tar.cms     custody.json   manifest.json   backup.log
  storage/  ovalball-storage-export-<stamp>.tar.cms   custody.json   export.log
```

Expected sizes: DB archive — tens of MB at most; Storage archive ≈ 40 MB (392 objects, ~39 MB, plus tar overhead).
No `.plain`, `.verify` or `.plain.tar` may remain.

## 7. Recovery completeness

| Component | In these backups? | Recovery path |
|---|---|---|
| Database schema and data (incl. `auth.users`, Storage object rows) | **Yes** — DB backup | `rehearse-logical-restore.sh` into an empty project; rehearsed (fictional) |
| Migration ledger | **Yes** — supplement `ledger` | restored in the same transaction; rehearsed |
| Roles, grants, default privileges, policies, triggers (incl. `auth.users` triggers, Storage/Realtime policies) | **Yes** — `roles.sql`, `schema.sql`, `managed.sql`, `align-default-privileges.sql` | rehearsed; fingerprint-compared |
| pg_cron jobs and their active state | **Yes** — supplement `cron` | rehearsed (restored disabled for isolation, then resumed deliberately) |
| Storage objects and metadata | **Yes** — Storage export (bytes, MIME, cache-control, ETag, user metadata, bucket settings) | upload with original Content-Type/Cache-Control (method proved by `copy-storage-objects.py`, stack-to-stack). **A loader from the export archive is NOT yet written** |
| Vault secrets incl. the two code peppers | **Names only** | values from the secret manager. **Pepper escrow (P2) is not confirmed** — without the peppers, invitation and recovery codes issued before a restore stop validating |
| Auth configuration (providers, redirect URLs, SMTP, hooks, JWT secret) | **No** | Dashboard, by hand; a new project means a new JWT secret and every user signs in again |
| Edge Functions (`address-lookup`) and their secrets | **No** (code is in Git) | redeploy from the repository; secrets from the secret manager |
| Deployment configuration (Vercel env, mobile `EXPO_PUBLIC_SUPABASE_URL`) | **No** | Vercel settings; a new project ref needs a new mobile build |
| External providers (GoCardless, Expo push, email provider, Google Places) | **No** | provider dashboards and the secret manager |

**This is not a complete recovery point.** It is a verified copy of the database and of Storage. A full recovery
also needs the pepper values, platform/Auth configuration and provider secrets, none of which has a verified recovery
path yet, and the Storage loader. The platform's own PITR (owner-confirmed) is the only path that keeps the project
ref, keys and configuration.

## 8. Custody record (filled in by the operator at the run; copied into the release log and the escrow entry)

| Field | Value |
|---|---|
| Operator (sole) | the project owner |
| Created (UTC) | DB: `<custody.json created_utc>` · Storage: `<…>` |
| Project / DB identity | `ywwdizmaanbujcfitpcj` / `7678069749886157684` |
| Ledger at backup | `<count> / <last version>` (expected 523 / `20270502000000`) |
| DB archive SHA-256 | `<…>` (also in escrow) |
| Storage archive SHA-256 / manifest SHA-256 | `<…>` / `<…>` (archive digest also in escrow) |
| Objects / bytes | `<…>` (expected 392 / ~39 MB, unless changed since 8 Oct) |
| Recipient certificate SHA-256 fingerprint | `<…>` |
| Primary destination | `~/OvalballBackups/<YYYY-MM-DD>/` on the operator's FileVault Mac |
| Secondary encrypted destination | `<owner-approved location>` |
| Recovery-test evidence | `verify-backup-archive.py` output for each archive, run from the **secondary** copy, with the key recovered from escrow |
| Retention | 30 days after the owner declares the release stable |
| Deletion | the project owner — only after confirming stability and that no retention requirement remains; never automatic. Then delete every archive copy and every copy of the dedicated key (cryptographic erasure); record date and method |
| Separation | archives and keys are never placed in a restore target's project directory or anything the restore guard can destroy |

## 9. Preflight checklist (immediately before `--execute`)

1. `git rev-parse HEAD` is the commit recorded in the final report; working tree has no unexpected changes.
2. Read-only identity: `system_identifier` 7678069749886157684; ledger still 523 / `20270502000000` (any change →
   stop and explain).
3. No maintenance gate active (or, if the backup is deliberately taken inside the release window, the window's
   state recorded — runbook §6 "Maintenance residue").
4. Dashboard: plan re-checked (Free on 8 Oct: no platform backups; if upgraded since, record the latest recoverable point and retention).
5. Supabase root CA downloaded (Dashboard → Database → Settings → SSL configuration) into the key folder.
   Dedicated key pair created (`openssl req -x509 -newkey rsa:4096 … -subj "/CN=ovalball-backup-<date>"`, passphrase
   set); key and passphrase in escrow; recovery from escrow tested.
6. Secondary encrypted destination named.
7. `$HOME/OvalballBackups/<date>` created (mode 700); the `db` and `storage` subfolders do NOT exist yet.
8. Plan output of each script read and matching this package.
9. A place in the escrow entry ready for the two archive digests.
10. Nobody else at the Mac; no screen sharing or recording while secrets are typed.

## 10. Success and failure criteria

**Success** (each archive separately): the script prints `BACKUP VERIFIED` / `EXPORT VERIFIED` and exits 0; only the
expected artifacts remain; the DB log shows ledger 523 / `20270502000000`, 7 cron jobs and both pepper names; the
Storage log shows API listing = database (expected 392 objects); the digest is in escrow; `verify-backup-archive.py`
passes against the escrowed digest from the secondary copy.

**Failure:** any non-zero exit, any `STOPPED`/`REFUSED`/`FAILED` line, any leftover `.plain*`/`.verify`, or a
verifier mismatch. A failed run produces no usable archive by construction.

## 11. Abort and cleanup

- Abort at any prompt with Ctrl-C (or SIGTERM): both scripts delete their plaintext and check it is gone. Nothing in
  production changes either way (read-only sessions, GETs).
- SIGKILL, a crash of the Mac or power loss cannot be intercepted: plaintext may remain in `<out>/.plain`, `.verify`,
  `.plain.tar` or `<archive folder>/.ovb-verify-*` — still inside the FileVault-encrypted, mode-700 folder. Delete
  them before doing anything else.
- After any failure or abort: `ls -A <out-dir>`; delete any `.plain`, `.verify`, `.plain.tar` that a hard kill left
  behind (`rm -rf`); keep the log for diagnosis; delete the out-dir before a retry (the scripts refuse an existing
  one).
- If a secret was exposed (typed into the wrong place, shown on screen): rotate it — the database password in
  Dashboard → Database, the service-role key by rotating the JWT secret / legacy keys (**that changes the anon key
  the apps use: an owner decision with release impact**), the backup key by generating a new pair and discarding any
  archive made with it.
- Never delete or move anything in the persistent local project, the parked migration, or production.

## 12. Remaining blockers

**Mandatory before execution**

| # | Blocker | Owner action |
|---|---|---|
| M1 | Separate explicit approval for each export (below) | approve 1 and/or 2 |
| M2 | Secondary encrypted destination not named | name it |
| M3 | Dedicated key pair for this backup not yet created/escrowed (the rehearsal key is fictional and must not be used) | checklist 5 |
| M4 | Escrow entry ready to hold the archive digests (the independent integrity record CMS needs) | checklist 9 |
| M5 | The project's Supabase root CA certificate downloaded from the Dashboard (`--db-root-cert`). `verify-full` against production has not been exercised (no production connection was made); if the pooler or direct host fails verification the run stops before sending any credential | download it; checklist 5 |

**Advisory (do not block taking the backups; they block calling the result a complete recovery point / Gate 1)**

| # | Item |
|---|---|
| A1 | The project is on the Free plan: no platform backups or PITR. These backups are the only restore point; upgrading is the owner's decision |
| A2 | Pepper values (P2) escrow not confirmed — required to restore working invitation/recovery codes |
| A3 | No loader from the Storage export archive into a restore target yet; required before a Storage restore |
| A4 | Auth/platform configuration, Edge Function secrets, Vercel env and provider configuration have no recorded recovery path |
| A5 | DB backup and Storage export are taken minutes apart, not atomically: an upload in between appears in one and not the other. Run them back to back; the export's object count vs the DB's `storage.objects` rows shows any drift |
| A6 | Neither script has run against production's network path (direct IPv6 vs pooler); the first run proves it, failing closed |
| A7 | `age` (authenticated encryption) not installed — optional; the escrowed digest + verifier compensate |
| A8 | The Storage export holds the whole of each object in memory while hashing it (largest production object 1.74 MB; fine at today's scale) |

**Independent review.** Codex reviewed the new export, the verifier and the DB-script change: 6 release-blocking
and 2 advisory findings — plaintext surviving SIGTERM; passphrase reachable through arguments/child environments;
verifier hashing one opening of the archive and decrypting another; unchecked cleanup; `sslmode=require` not
authenticating the server; verifier scratch following `$TMPDIR` into a synced folder; zero-byte objects; empty
exports. All eight fixed and re-rehearsed (§3, §4, §5). A Codex re-review closed five and found three incomplete
(signals during the shell cleanup; the passphrase still reaching precondition children and being accepted in
production; unguarded cleanup steps and success printed before cleanup) plus one new shell defect (`set -e` could skip
the remnant check); all fixed and re-rehearsed. Deliberately not changed: the verifier never deletes the operator's
own (encrypted) input archive. A final Codex check closed every finding (the last, a `dirname` child started before the
shell removed the rehearsal passphrase, was fixed by moving the removal to the first line) and found no new
release-blocking defect.

## 13. Approval requests

**Approval 1 — production DATABASE logical backup.** Run `take-production-logical-backup.sh … --execute` ONCE, as in
§3, by the project owner, to `~/OvalballBackups/<date>/db`, then the verifier against the escrowed digest. Approves
nothing else.

**Approval 2 — production STORAGE export.** Run `take-production-storage-export.py … --execute` ONCE, as in §4, by the
project owner, to `~/OvalballBackups/<date>/storage`, then the verifier against the escrowed digest. Approves nothing
else.

Neither approves a restore, a maintenance window, a migration, a deployment or any production write.
