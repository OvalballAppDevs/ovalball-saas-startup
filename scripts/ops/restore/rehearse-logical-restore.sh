#!/usr/bin/env bash
# Rehearse an Ovalball logical restore into a DISPOSABLE, EMPTY local Supabase project.
#
#   scripts/ops/restore/rehearse-logical-restore.sh --backup-dir DIR --target-project-dir DIR
#       [--vault-from-container NAME [--vault-names a,b]] [--keep-cron-active] [--keep-push-tokens] [--execute]
#
# DIR (the backup) must hold, from the same moment:
#   roles.sql schema.sql data.sql        supabase db dump --role-only / (schema) / --data-only --use-copy
#                                        (data with -x storage.buckets_vectors -x storage.vector_indexes)
#   managed.sql defer.sql recheck.sql    capture-supplement.sql parts of the same names
#   cron.sql ledger.sql
#
# SAFETY. Without --execute this is a dry run that prints the plan and changes nothing. It refuses:
#   * a target whose project_id is the persistent local project, or is not a plain lowercase id;
#   * a target whose database is not that project's own local container;
#   * a target that is not EMPTY (any table in public);
#   * any remote database -- it has no connection-string input at all; every statement runs through
#     `docker exec` into the target's container.
# --vault-from-container copies Vault secrets from ANOTHER DISPOSABLE local container (rehearsal only: in a real
# recovery the values come from the owner's secret manager, never from a script). Only the names in --vault-names
# are copied (default: the two code peppers), so endpoint URLs and bearer secrets (e.g. the GoCardless replay pair)
# never reach a rehearsal copy.
#
# OUTBOUND ISOLATION, INSIDE THE RESTORE TRANSACTION. A restored copy of real data can act on the outside world:
# pg_cron jobs call HTTP endpoints through pg_net, and any write that raises a notification posts to Expo's push
# service for REAL device tokens. So, in the same transaction that loads the data -- the copy is never committed in
# an operational state -- every cron job is disabled (unless --keep-cron-active), every push device token is removed
# and any request already queued for pg_net is dropped (unless --keep-push-tokens). The tokens' content hash is
# printed BEFORE they are removed, so the copy can still be checked against the source's fingerprint ("data" for
# public.push_device_tokens is then the one expected difference). See PRODUCTION_BACKUP_RECOVERY_RUNBOOK.md section 7.
set -euo pipefail

PERSISTENT_PROJECT_ID="ovalball-saas-startup"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP=""; TARGET=""; VAULT_FROM=""; VAULT_NAMES="invitation_code_pepper,recovery_code_pepper"; KEEP_CRON=0; KEEP_PUSH=0; EXECUTE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --backup-dir) BACKUP="$2"; shift 2 ;;
    --target-project-dir) TARGET="$2"; shift 2 ;;
    --vault-from-container) VAULT_FROM="$2"; shift 2 ;;
    --vault-names) VAULT_NAMES="$2"; shift 2 ;;
    --keep-cron-active) KEEP_CRON=1; shift ;;
    --keep-push-tokens) KEEP_PUSH=1; shift ;;
    --execute) EXECUTE=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

refuse() { echo "REFUSED: $*" >&2; exit 2; }

[ -n "$TARGET" ] && [ -f "$TARGET/supabase/config.toml" ] || refuse "--target-project-dir must hold supabase/config.toml"
# Exactly one project_id line, a plain double-quoted lowercase id (no escapes, no second definition).
[ "$(grep -c '^[[:space:]]*project_id[[:space:]]*=' "$TARGET/supabase/config.toml")" = "1" ] || refuse "config.toml must define project_id exactly once"
PID="$(sed -n 's/^[[:space:]]*project_id[[:space:]]*=[[:space:]]*"\([a-z0-9-]*\)"[[:space:]]*$/\1/p' "$TARGET/supabase/config.toml")"
[[ "$PID" =~ ^[a-z0-9][a-z0-9-]*$ ]] || refuse "project_id must be a plain double-quoted id of lowercase letters, digits and hyphens"
[ "$PID" != "$PERSISTENT_PROJECT_ID" ] || refuse "that is the persistent local project"

# NETWORK ISOLATION FIRST -- before the backup folder is even looked at. The target must pass every check of
# restore-target-isolation.py: every published port bound to loopback (proved from Docker, the host's own listeners and
# live connection attempts through every non-loopback address of this Mac), every container but Kong on an internal
# network with no route out (proved by a probe inside each container's network namespace), Kong routing only to this
# stack, Auth mailing only this stack's catcher with loopback links. Any failure, or anything it cannot inspect,
# stops here, dry run included. There is no flag to skip it.
echo "Isolation preflight of the target (nothing in the backup has been read)..."
if ! python3 "$HERE/restore-target-isolation.py" guard-status --project-dir "$TARGET"; then
  refuse "no live isolation guard for the target; the backup was not opened. Start the target with start-isolated-restore-target.sh"
fi
if ! python3 "$HERE/restore-target-isolation.py" verify --project-dir "$TARGET" --quiet; then
  refuse "the target is not network-isolated (see the failures above); the backup was not opened. Start it with start-isolated-restore-target.sh"
fi

[ -n "$BACKUP" ] && [ -d "$BACKUP" ] || refuse "--backup-dir must name a directory"
CONTAINER="supabase_db_${PID}"
docker ps --format '{{.Names}}' | grep -qx "$CONTAINER" || refuse "container $CONTAINER is not running"
[[ "$VAULT_NAMES" =~ ^[a-z0-9_]+(,[a-z0-9_]+)*$ ]] || refuse "--vault-names must be a comma-separated list of plain names"
# Only the code peppers may ever be copied: endpoint URLs and bearer secrets (the GoCardless replay pair, anything
# added later) must never reach a rehearsal copy, whatever is asked for.
for name in ${VAULT_NAMES//,/ }; do
  case "$name" in invitation_code_pepper|recovery_code_pepper) ;; *) refuse "--vault-names: '$name' is not an allowed rehearsal secret (only invitation_code_pepper, recovery_code_pepper)" ;; esac
done
if [ -n "$VAULT_FROM" ]; then
  [ "$VAULT_FROM" != "supabase_db_${PERSISTENT_PROJECT_ID}" ] || refuse "will not read Vault from the persistent local database"
  [ "$VAULT_FROM" != "$CONTAINER" ] || refuse "Vault source and target are the same container"
  docker ps --format '{{.Names}}' | grep -qx "$VAULT_FROM" || refuse "container $VAULT_FROM is not running"
fi

for f in roles.sql schema.sql data.sql managed.sql defer.sql recheck.sql cron.sql ledger.sql; do
  [ -s "$BACKUP/$f" ] || refuse "backup is missing $f"
done

tables="$(docker exec "$CONTAINER" psql -U postgres -tA -c "select count(*) from pg_tables where schemaname = 'public'")"
[ "$tables" = "0" ] || refuse "target is not empty ($tables public tables); recreate it first"

echo "Target: disposable project $PID ($CONTAINER), empty."
echo "Plan, one transaction:"
echo "  1 roles.sql (minus platform-managed GRANT SET ON PARAMETER lines)"
echo "  2 align-default-privileges.sql"
echo "  3 schema.sql"
echo "  4 managed.sql (auth/storage/realtime triggers and policies)"
echo "  5 defer.sql (function-calling CHECKs dropped)"
echo "  6 data.sql under session_replication_role = replica"
echo "  7 recheck.sql (CHECKs re-added NOT VALID, then validated)"
echo "  8 cron.sql + ledger.sql; then, unless --keep-cron-active, every cron job disabled (same transaction)"
if [ -n "$VAULT_FROM" ]; then
  echo "Then: Vault -- only $VAULT_NAMES, copied from disposable $VAULT_FROM."
else
  echo "Then: Vault NOT restored -- enter values from the secret manager."
fi
if [ "$KEEP_CRON" -eq 1 ]; then echo "Then: cron jobs left as captured."; else echo "Then: every cron job DISABLED (outbound isolation)."; fi
if [ "$KEEP_PUSH" -eq 1 ]; then echo "Then: push device tokens and the pg_net queue left as captured."; else echo "Then: push device tokens REMOVED and the pg_net queue emptied (outbound isolation, same transaction)."; fi
if [ "$EXECUTE" -ne 1 ]; then
  echo "DRY RUN. Re-run with --execute. Nothing was changed."
  exit 0
fi

stage="/tmp/ovalball-restore-$$"
docker exec "$CONTAINER" mkdir -p "$stage"
cleanup() { docker exec "$CONTAINER" rm -rf "$stage" >/dev/null 2>&1 || true; }
trap cleanup EXIT

roles_tmp="$(mktemp)"
grep -v '^GRANT SET ON PARAMETER ' "$BACKUP/roles.sql" > "$roles_tmp"
docker cp "$roles_tmp" "$CONTAINER:$stage/roles.sql" >/dev/null; rm -f "$roles_tmp"
docker cp "$HERE/align-default-privileges.sql" "$CONTAINER:$stage/align.sql" >/dev/null
for f in schema managed defer data recheck cron ledger; do docker cp "$BACKUP/$f.sql" "$CONTAINER:$stage/$f.sql" >/dev/null; done

# The jobs as CAPTURED, read from cron.sql itself (so they can be reported after isolation has disabled them).
captured_all="$(sed -n "s/^select cron.schedule('\([^']*\)'.*/\1/p" "$BACKUP/cron.sql" | sort)"
captured_paused="$(sed -n "s/.*where jobname = '\([^']*\)'), active := false);.*/\1/p" "$BACKUP/cron.sql" | sort)"
captured_active="$(comm -23 <(echo "$captured_all") <(echo "$captured_paused") | paste -sd, - | sed 's/,/, /g')"

# Outbound isolation happens INSIDE the restore transaction: no restored job is ever active after the commit.
isolate=(-c "select 1")
if [ "$KEEP_CRON" -ne 1 ]; then
  isolate+=(-c "select cron.alter_job(jobid, active := false) from cron.job where active")
fi
if [ "$KEEP_PUSH" -ne 1 ]; then
  # The hash first (same expression as fingerprint.sql's "data" row), then the tokens and any queued request go.
  # The table may not exist (production before the release has none), and a static reference would abort the whole
  # restore at parse time whatever CASE says -- so it is only ever named inside dynamic SQL.
  isolate+=(-c "select 'PUSH_TOKENS_BEFORE_ISOLATION|' || case when to_regclass('public.push_device_tokens') is null then 'n/a' else (xpath('/row/h/text()', query_to_xml('select count(*) || ''|'' || md5(coalesce(string_agg(t::text, chr(10) order by t::text), '''')) as h from public.push_device_tokens t', false, true, '')))[1]::text end")
  isolate+=(-c "do \$\$ begin if to_regclass('public.push_device_tokens') is not null then execute 'delete from public.push_device_tokens'; end if; if to_regclass('net.http_request_queue') is not null then execute 'delete from net.http_request_queue'; end if; end \$\$")
fi

start=$(date +%s)
restore_out="$(mktemp)"
set +e
docker exec "$CONTAINER" psql -X -U postgres -d postgres --single-transaction -v ON_ERROR_STOP=1 -q \
  -f "$stage/roles.sql" -f "$stage/align.sql" -f "$stage/schema.sql" -f "$stage/managed.sql" -f "$stage/defer.sql" \
  -c 'SET session_replication_role = replica' -f "$stage/data.sql" -c 'SET session_replication_role = origin' \
  -f "$stage/recheck.sql" -f "$stage/cron.sql" -f "$stage/ledger.sql" "${isolate[@]}" -tA > "$restore_out"
restore_rc=$?
set -e
if [ "$restore_rc" -ne 0 ]; then
  rm -f "$restore_out"
  echo "RESTORE FAILED (psql exit $restore_rc): the transaction was rolled back; the target holds nothing from this backup." >&2
  exit 1
fi
sed -n 's/^PUSH_TOKENS_BEFORE_ISOLATION|/push device tokens as captured (count|content md5): /p' "$restore_out"
rm -f "$restore_out"
echo "restore committed in $(( $(date +%s) - start ))s"

# The preflight was a snapshot. Check again now that the data is in: if the target lost its isolation meanwhile (a
# container re-attached to a network with a route out, a port re-published), stop every container of it at once.
if ! python3 "$HERE/restore-target-isolation.py" guard-status --project-dir "$TARGET" \
   || ! python3 "$HERE/restore-target-isolation.py" verify --project-dir "$TARGET" --quiet; then
  echo "EMERGENCY STOP: the target lost its network isolation (or its guard) during the restore. Stopping it..." >&2
  python3 "$HERE/restore-target-isolation.py" emergency-stop --project-dir "$TARGET" >&2 || true
  echo "Destroy it (PRODUCTION_BACKUP_RECOVERY_RUNBOOK.md, 'Restore isolation') and tell the owner." >&2
  exit 1
fi

# A backup taken INSIDE a maintenance window carries the window with it: roles.sql keeps the PostgREST gate on
# authenticator, schema.sql keeps ops_maintenance, and cron.sql records every job paused. (The database-level
# read-only default is not dumped.) Report it as captured, before outbound isolation changes cron; clearing it is a
# deliberate step from the backup runbook, resuming only the jobs that were active BEFORE the window.
gate="$(docker exec "$CONTAINER" psql -X -U postgres -tA -c "select count(*) from pg_db_role_setting where array_to_string(setconfig, ' ') ~ 'pgrst\.db_pre_request'")"
paused="$(echo "$captured_paused" | paste -sd, - | sed 's/,/, /g')"
schema="$(docker exec "$CONTAINER" psql -X -U postgres -tA -c "select count(*) from pg_namespace where nspname = 'ops_maintenance'")"
if [ "$gate" != "0" ] || [ -n "$paused" ] || [ "$schema" != "0" ]; then
  echo "MAINTENANCE RESIDUE as captured (expected for a backup taken inside the window):"
  if [ "$gate" != "0" ]; then echo "  - PostgREST gate set on authenticator: every REST/RPC write will be refused"; fi
  if [ "$schema" != "0" ]; then echo "  - schema ops_maintenance present"; fi
  if [ -n "$paused" ]; then echo "  - cron jobs captured paused: $paused"; fi
  echo "  Clear it per PRODUCTION_BACKUP_RECOVERY_RUNBOOK.md section 6 ('Maintenance residue')."
fi

if [ "$KEEP_CRON" -ne 1 ]; then
  echo "cron: every job disabled inside the restore transaction (active as captured: ${captured_active:-none}); now active: $(docker exec "$CONTAINER" psql -X -U postgres -tA -c 'select count(*) from cron.job where active')"
fi
tokens="$(docker exec "$CONTAINER" psql -X -U postgres -tA -c "select case when to_regclass('public.push_device_tokens') is null then 'n/a' else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.push_device_tokens', false, true, '')))[1]::text end")"
queued="$(docker exec "$CONTAINER" psql -X -U postgres -tA -c "select case when to_regclass('net.http_request_queue') is null then 'n/a (pg_net not installed)' else (xpath('/row/n/text()', query_to_xml('select count(*) as n from net.http_request_queue', false, true, '')))[1]::text end")"
echo "push device tokens in the copy now: $tokens; pg_net requests queued: $queued"

if [ -n "$VAULT_FROM" ]; then
  names_sql="$(echo "$VAULT_NAMES" | sed "s/[a-z0-9_]*/'&'/g")"
  docker exec "$VAULT_FROM" psql -X -U postgres -tA -v ON_ERROR_STOP=1 -c \
    "select format('select vault.create_secret(%L, %L, %L);', decrypted_secret, name, coalesce(description, '')) from vault.decrypted_secrets where name in ($names_sql) order by name" \
    | docker exec -i "$CONTAINER" psql -X -U postgres -q -v ON_ERROR_STOP=1 --single-transaction -o /dev/null
  echo "vault: $(docker exec "$CONTAINER" psql -U postgres -tA -c 'select count(*) from vault.secrets') secret(s) copied (values not shown)"
fi
echo "Next: verify (fingerprints, suites, HTTP), then copy Storage files separately."
