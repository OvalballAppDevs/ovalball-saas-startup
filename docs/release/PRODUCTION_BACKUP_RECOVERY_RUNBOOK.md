# Production Backup and Recovery Runbook

Project `ywwdizmaanbujcfitpcj` (Ovalball production). Written 8 October 2026 at checkpoint `a1eab03`; capability
facts, the platform documentation and the restore-isolation design (section 6, "Restore isolation") updated the same
day after `5e38eb8`.

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
| WAL archiving | `archive_mode` on; 5,950 segments archived, last 09:16 UTC 8 Oct, 0 failed (re-read the same day) |
| Outbound channels Ovalball uses | **none present today** (the channels inspected — not a proof that no outbound mechanism of any kind exists): `pg_net` is not installed (extensions: pg_cron, pg_stat_statements, pg_trgm, pgcrypto, plpgsql, supabase_vault, uuid-ossp); no function in `public`/`internal` calls `net.http_*`; no push-token table exists. Both arrive with the pending migrations (544, 706–707) |
| Payment providers | 0 GoCardless merchant connections, 0 member events, 0 platform events, 0 platform payments; the one platform subscription has no provider ids |

## 2. Backup capabilities

| Capability | Status | Notes |
|---|---|---|
| Continuous WAL archiving | **VERIFIED (exists)** | `pg_stat_archiver`. Proves WAL is shipped somewhere; does NOT prove a restorable backup, its retention, or that PITR is enabled on the plan. |
| Project plan | **UNKNOWN** | Decides everything below. Not readable through SQL or the MCP; the CLI needs a login (not attempted). |
| Platform daily backups | **UNKNOWN** | Supabase documents: **Free plan — no automatic backups** ("regularly export their data using the Supabase CLI"); Pro 7 days, Team 14, Enterprise up to 30. They are physical backups and **do not include Storage objects**. |
| Point-in-time recovery | **UNKNOWN** | Supabase documents: an add-on for Pro/Team/Enterprise, needs at least the Small compute add-on, seconds of granularity, and **replaces** daily backups once enabled. |
| Platform restore in place (same project ref) | **UNKNOWN** | Documented as in place with the project **inaccessible during the restore**, and it overwrites everything written since the restore point. The only recovery path that keeps the project ref, API keys, JWT secret, Auth sessions and the mobile build's baked-in URL. |
| Platform "restore to a new project" | **UNKNOWN** | Documented route: Duplicate Project. A new project ref, so new keys and a new mobile build. |
| Last automatic backup / retention | **UNKNOWN** | Owner reads it (screens below). |
| Logical backup (`supabase db dump` + supplement) | **AVAILABLE; rehearsed on disposable stacks** | Read-only against the source. Restores into an EMPTY project. Every compared property matched, with three explained exceptions (section 7). |
| Storage file export | **AVAILABLE; rehearsed on disposable stacks** | Through the Storage API with the service role (`scripts/ops/restore/copy-storage-objects.py` shows the method; it only accepts local stacks). |
| Last known restore point | 5 Sep 2026 manual dumps (`~/ovalball-deploy-backups`) | Never restored; predates 30+ days of data. Not acceptable as the release backup. |

**Archived WAL is not a restore point.** It proves the platform ships WAL somewhere; whether any of it can be
restored, to when, and by whom is exactly the UNKNOWN above.

**Screens the owner reads (read-only; change nothing):**

1. Organization → Billing (or Settings → Billing): the plan of the organisation that owns `ywwdizmaanbujcfitpcj`.
2. Project → Database → Backups → "Scheduled backups": whether daily backups are listed, the newest one's time, how
   many days are kept. (On the Free plan this screen offers no backups.)
3. Project → Database → Backups → "Point in time": whether PITR is enabled and its retention window.
4. Project → Settings → Add-ons: compute size and PITR add-on.
5. Note what the restore buttons say (in place, downtime) — do NOT press them.

Record the answers in the release log. If the plan is Free, the logical backup in section 5 is the only restore
point Ovalball has, and Gate 1 depends on it entirely.

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

### Restore isolation (any restore of PRODUCTION data outside production)

**Status: the isolated target — no route out for any container, loopback-only access through a relay, a guard
that destroys the copy on any isolation failure — is implemented and proved on disposable stacks with fictional data
(see "Network isolation of the target" and the evidence report). Not run with production data.** Restoring a
production backup anywhere needs its own approval (section 9). The design below is what that approval would cover.
What was inspected in production, read-only: no `pg_net` and no other HTTP-capable extension (the full extension
list is in section 1; no `http`, `dblink` or `postgres_fdw`), no function in `public`/`internal` calling `net.http_*`,
no push-token table, and all 7 cron jobs are plain SQL function calls (`select internal.…()`). So **none of the
outbound channels Ovalball uses exists in the current production database**; that is a statement about those
channels, not a proof that no outbound mechanism of any kind could exist. A backup taken before the migration window
carries none of them. A backup taken AFTER the release is not (pg_net,
push tokens and the GoCardless replay arrive with the migrations), which is why the controls below are enforced by
the restore script rather than by remembering.

**Where.** A disposable local Supabase stack on the owner's Mac (Docker; FileVault verified on), started from an
EMPTY project directory with its own project id and ports, seeds disabled — the `opsrestore` shape the rehearsal
used. Not a new cloud project: a cloud project would hold personal data at a second provider location, send Auth
email through the platform and be reachable from the internet. The local stack's Auth sends mail only to its own
local mail catcher (no SMTP is configured in `supabase/config.toml`); its Realtime, Storage and Edge runtime are
local containers.

**Network isolation of the target — no route out for any container, loopback-only access, and a guard that
detects and contains a broken topology.** Measured on this Mac (Docker Desktop 29.7.2, CLI 2.120.0): the Supabase CLI publishes every service on all
interfaces and has no bind-address setting; Docker Desktop ignores a network-wide bind default but honours an explicit
host IP; a container on an `--internal` network has no default route and no outside DNS — and Docker Desktop then
forwards none of its published ports. An earlier design kept Kong on the CLI's network so its port could be published;
that left Kong a real route out (from Kong's namespace a full HTTP exchange with an internet host succeeded), which it
never needed. The final design, all in `scripts/ops/restore/start-isolated-restore-target.sh`:

1. **Start, loopback only.** The CLI runs against `docker-loopback-proxy.py` (every published port of every container
   it creates bound to `127.0.0.1`; host networking and publish-all refused), with only the services a restore needs
   (no vector — it mounts the Docker socket — no analytics, Studio, Meta, Edge runtime, imgproxy or pooler).
2. **No route out, for any container.** `restore-target-isolation.py isolate` puts every container — Kong included —
   on an `--internal` network (service aliases kept) and removes it from every other network. No container has a
   default route; Docker's leftover forwarders on `127.0.0.1` accept and close without answering.
3. **The API, through a loopback relay.** `loopback-api-relay.py` listens on `127.0.0.1:<api port + 20>` only and pipes
   each connection through `docker exec -i supabase_kong_<id> nc 127.0.0.1 8000` — Kong's own loopback, inside Kong's
   internal-only namespace. A fixed destination (not a proxy); it gives no container a socket, a network or a mount;
   it re-checks Kong's name, project label and internal-only networks on every connection and refuses otherwise. The
   database is reached with `docker exec`.
4. **Proof, then a guard while the target exists.** `verify` must pass; then the relay and
   `restore-target-isolation.py guard` start (detached), and `verify --api-port` passes again through the relay; if
   any of that fails, the wrapper destroys the target. The guard re-checks the structure on every Docker
   container/network/volume event and every 3 s, and writes a heartbeat. When it detects a failure — a container on a
   network with a route out or on any network but the target's own, a container borrowing the namespace of one outside
   the target, a non-loopback port, a foreign or disguised mount,
   host networking or privilege, a persistent-project container linked to the target, a check that errors or times
   out, Docker's event stream ending, SIGTERM or SIGHUP to the guard — it kills every container of the target and then
   tries to destroy its containers, data volumes and network, confirming each one is gone (and logging anything that
   is not). The restore and Storage tools refuse to start without a live guard (`guard-status`: the recorded process,
   for this project, with a heartbeat younger than 15 s), and check it again when they finish.

**Never restarted.** A target is destroyed (`start-isolated-restore-target.sh --target-project-dir <dir> --destroy`)
and rebuilt, never stopped and started: a CLI `supabase stop` trips a live guard, which destroys the data (proved: a
plain `start` afterwards came up empty). The wrapper refuses to start while a guard is alive OR while any container or
volume of the target is left (a dead guard and a stop that kept the volumes would otherwise let the CLI bring retained
data back up on its own network).

The target has its own `.env` (never the repository's — that one points Auth's links at a LAN address):

```sh
SUPABASE_AUTH_EXTERNAL_URL=http://127.0.0.1:<api port>
SUPABASE_SITE_URL=http://127.0.0.1:3000
EXPO_RECOVERY_REDIRECT=http://127.0.0.1:3000     # and the other EXPO_* redirects likewise
# every provider secret (OPENAI_API_KEY, SENDGRID_API_KEY, SUPABASE_AUTH_EXTERNAL_*_SECRET, ...) left empty
```

**The preflight — `restore-target-isolation.py verify`, fail-closed.** It trusts no configuration file and changes
nothing in the target (its only side effect is short-lived probe containers). Its scope (for detection) is every container that
belongs to the target by name, by the CLI's project label, by mounting one of the target's volumes, by sharing a
target container's network namespace, or by being attached to (or configured on) a network a target container is on
— running or stopped. Emergency stop and destroy act only on the containers the target OWNS (label, name, its
volumes, its own internal network, an owned namespace); a peer that is merely reachable — another application's
container — is reported, never touched, and nothing of the persistent project is ever touched. It fails on any of: a published port not bound to
loopback, publish-all, host networking, a privileged container, any mount other than the target's own plain local
volumes (no Docker socket, no `~/.docker`, no host path, no disguised bind volume, no volume of another project); a
host listener on a published, configured or relay port that is not loopback (`lsof`); a successful connection to any
of those ports through ANY non-loopback address of the Mac; ANY container — Kong included, stopped ones included — on
a network that is not internal; a Kong upstream anywhere in its declarative config that is not exactly one of this
stack's containers or service names, or Kong's admin API off loopback; a successful TCP connection to the internet or
a resolvable outside name from inside any container's namespace (the probe's positive control runs in a throwaway
container on Docker's default bridge and must reach the internet, or verify fails); Auth mailing anything but this
stack's catcher, Auth links that are not loopback, an external sign-in provider; with `--api-port`, the relay not on
loopback only or the API not answering through it; anything it cannot inspect.

**What is enforced, what is monitored, what is prevented, what is only detected.**

- *Enforced by the network topology* (proved on every container, Kong included): no IPv4 or IPv6 default route, no
  outside DNS, no TCP to the internet; the only host listeners are on `127.0.0.1`, and the only one that reaches the
  target is its own relay; nothing answers on any non-loopback address of the Mac. This holds whether or not the guard
  is running, for as long as nobody changes the Docker configuration.
- *Prevented*, therefore: every outbound request the copy or its services could make by themselves (push, mail,
  billing, geocoding, replay — also emptied or disabled inside the restore transaction), and every inbound connection
  from the network, **as long as the topology is unchanged**.
- *Monitored by the guard*: changes to that topology (networks, ports, mounts, privilege, new or renamed containers,
  netns sharing), Docker's availability, and the guard's own liveness (heartbeat).
- *Detected after it occurs, not prevented*: a deliberate change by someone with Docker access on this Mac. The guard
  is a polling/event watcher: it reacts AFTER the change. Measured, with Kong re-attached to a network with a route
  out and an attacker executing inside Kong: **15, 24, 29 and 27 successful outbound connections in four runs, before
  the guard killed Kong 1.30 s, 1.93 s, 2.29 s and 2.09 s after the change.** In that window data can leave. The guard does not prevent
  exfiltration; it bounds the window and then destroys the copy. A person with that access could equally copy the data
  out with `docker cp` without touching the network; Docker Desktop offers no pre-authorisation hook to prevent either.
- *Not covered at all*: a guard killed with SIGKILL or frozen (SIGSTOP) — the restore tools then refuse the target,
  but a copy already loaded keeps running, still isolated by topology, unwatched; a Docker daemon or engine defect; a
  host process that forwards a LAN port to the loopback relay, edits the pidfiles or spoofs a process name; anyone
  else using this Mac.

So the topology isolation is complete for the copy's own behaviour; protection against a person with Docker or host
access is custody, not technology: **only the named operator uses this Mac and its Docker while it holds production
data**. The guard's ability to destroy a copy after detecting exposure is containment, not a reason to consider a
production-derived restore safe.

**Outbound isolation — in force before the copy is ever committed.** `rehearse-logical-restore.sh` does all of this
INSIDE the one restore transaction, so there is no moment at which the restored database is both committed and live:

| Channel | Control | Proved |
|---|---|---|
| pg_cron (all jobs, including the GoCardless replay and push/reminder jobs) | every job disabled in the same transaction | 12 captured active → 0 active, 0 runs (fictional data) |
| pg_net (push to `exp.host`, postcodes.io geocoding, replay) | push device tokens deleted and any queued request dropped in the same transaction; the tokens' content hash is printed first, so verification still compares against the source | 1 fictional token → hash recorded, 0 tokens, 0 queued, at commit |
| Vault | nothing is copied unless named, and the script refuses any name but the two peppers; production peppers are entered by the owner from the secret manager only if the pepper check (section 7, item 5) is wanted — otherwise skipped. GoCardless replay URL/secret never | allow-list enforced by the script |
| GoCardless (member and platform) | today's production holds no merchant connection or token (0 rows) and Vault holds no replay secret, so a copy of it holds no provider credential. A LATER backup may hold merchant access tokens in `gocardless_merchant_connections`: then the credentials ARE in the copy, and only the absence of any application or job using them (no app pointed at the copy, cron disabled, no replay secret) keeps them inert — treat such a copy as holding live credentials | read-only count; script allow-list |
| Email | the application's own mailer is not running against the copy; local Auth mail goes to the local catcher | by construction (config) |
| Auth callbacks / OAuth | local `site_url`; no sign-in through external providers is exercised | by construction |
| Edge Functions | local `address-lookup` only, and only if called; it reads public lookup services and writes nothing | source read |
| Realtime | local container; no clients connect | by construction |
| Storage | objects copied into the local stack's own volume only | rehearsed (fictional) |
| Application environment | no Next.js or mobile build is pointed at the copy; HTTP checks are made with curl to 127.0.0.1 only (which says where the checks go, not who else can connect — see "Network exposure") | procedure |

**Data protection.** The backup holds personal data, including children's records (safeguarding-sensitive).
- People: the owner (approver and data controller) and one named operator. No one else reads the dump or the copy.
- At rest: only on the FileVault-encrypted Mac, in one dated folder (`chmod 700`) outside the repository and outside
  any synced folder (no iCloud/Dropbox). The archive kept as the release restore point is additionally encrypted
  (e.g. `age` to the owner's key) before it is copied to its second location; the plain working copy never leaves the
  Mac.
- Never: committed, pasted into a chat, an issue or a log, or opened by any tool that uploads content.
- Retention: the rehearsal copy and its working files for 24 hours after verification; the encrypted release backup
  until the owner declares the release stable (proposal: 30 days), then destroyed. It is encrypted to a key made for
  this backup alone (a new `age` key pair, private key held only in the owner's secret manager), never to a key that
  protects anything else.
- Destruction: `supabase stop --project-id <the disposable id> --no-backup` (never the persistent project), remove the
  stack's Docker volumes by name, delete the working folder; for the encrypted archive, destroy every copy of its dedicated key
  (cryptographic erasure — overwriting files on an SSD is not reliable), then delete the archive copies. Record date and method in the release log.

**Validation checklist.** Before loading: `start-isolated-restore-target.sh` ended with `ISOLATION VERIFIED` (the
restore re-checks it itself). After the restore, the preflight passes again, and before any verification step that
writes: cron active = 0; `push_device_tokens` = 0 or n/a; `net.http_request_queue` = 0 or n/a; Vault names
= only those approved; no `.env` in the target folder points at production; the operator has no production key
exported in that shell.

**Emergency stop (the guard does this itself on an isolation failure; for anything else, any one → `restore-target-isolation.py emergency-stop --project-dir <target>` — it stops every container in the target's scope and fails loudly if any is still running; if it fails, quit Docker Desktop — then destroy as above and
tell the owner):** the isolation preflight failing at any time; a cron job found active; a push token or queued pg_net request after commit; any outbound
connection seen from a container; a mail other than a test account's in the local catcher; a Vault name not
approved; any sign that a production URL or key is in use.

**What would make this BLOCKED:** restoring by hand (bypassing the scripts and their preflight); a target holding
production data stopped and started with the CLI instead of destroyed; restoring into a cloud project; any need to run
the application against the copy.

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
   - `cron`: compare against the CAPTURED state — the restore disables every job for isolation;
   - `rows` and `data` for `public.push_device_tokens` (once that table exists): emptied for isolation; compare the
     source's count and hash with the "push device tokens as captured (count|content md5)" line the restore printed.
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
- A restore of a PRODUCTION backup (not authorised). Production carries data shapes the synthetic rehearsal data may
  not (for example function-based CHECKs over real rows).
- The restore-isolation design on a production-derived copy: its controls are proved on fictional data only.
- Storage export at production scale (392 objects; sizes not read).
- In-place logical restore over an existing project.

## 9. Approvals

Each needs the owner's explicit approval, separately: (a) taking the production backup (sections 5.3–5.7);
(b) restoring it into a disposable environment and verifying (sections 6–7) — this is what passes Gate 1;
(c) any production restore.
