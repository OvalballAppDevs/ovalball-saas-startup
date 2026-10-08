#!/usr/bin/env bash
# Rehearse an Ovalball logical restore into a DISPOSABLE, EMPTY local Supabase project.
#
#   scripts/ops/restore/rehearse-logical-restore.sh --backup-dir DIR --target-project-dir DIR
#       [--vault-from-container NAME [--vault-names a,b]] [--keep-cron-active] [--execute]
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
# OUTBOUND ISOLATION. A restored copy of real data can act on the outside world: pg_cron jobs call HTTP endpoints
# through pg_net, and any write that raises a notification posts to Expo's push service for REAL device tokens.
# So every cron job is left DISABLED after the restore unless --keep-cron-active is given, and the script reports
# how many push device tokens the copy holds. Before any write test on a copy of PRODUCTION data, also remove the
# push tokens in the copy (or block egress from the target) -- see the backup runbook.
set -euo pipefail

PERSISTENT_PROJECT_ID="ovalball-saas-startup"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP=""; TARGET=""; VAULT_FROM=""; VAULT_NAMES="invitation_code_pepper,recovery_code_pepper"; KEEP_CRON=0; EXECUTE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --backup-dir) BACKUP="$2"; shift 2 ;;
    --target-project-dir) TARGET="$2"; shift 2 ;;
    --vault-from-container) VAULT_FROM="$2"; shift 2 ;;
    --vault-names) VAULT_NAMES="$2"; shift 2 ;;
    --keep-cron-active) KEEP_CRON=1; shift ;;
    --execute) EXECUTE=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

refuse() { echo "REFUSED: $*" >&2; exit 2; }

[ -n "$BACKUP" ] && [ -d "$BACKUP" ] || refuse "--backup-dir must name a directory"
[ -n "$TARGET" ] && [ -f "$TARGET/supabase/config.toml" ] || refuse "--target-project-dir must hold supabase/config.toml"
# Exactly one project_id line, a plain double-quoted lowercase id (no escapes, no second definition).
[ "$(grep -c '^[[:space:]]*project_id[[:space:]]*=' "$TARGET/supabase/config.toml")" = "1" ] || refuse "config.toml must define project_id exactly once"
PID="$(sed -n 's/^[[:space:]]*project_id[[:space:]]*=[[:space:]]*"\([a-z0-9-]*\)"[[:space:]]*$/\1/p' "$TARGET/supabase/config.toml")"
[[ "$PID" =~ ^[a-z0-9][a-z0-9-]*$ ]] || refuse "project_id must be a plain double-quoted id of lowercase letters, digits and hyphens"
[ "$PID" != "$PERSISTENT_PROJECT_ID" ] || refuse "that is the persistent local project"
CONTAINER="supabase_db_${PID}"
docker ps --format '{{.Names}}' | grep -qx "$CONTAINER" || refuse "container $CONTAINER is not running"
[[ "$VAULT_NAMES" =~ ^[a-z0-9_]+(,[a-z0-9_]+)*$ ]] || refuse "--vault-names must be a comma-separated list of plain names"
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
  isolate=(-c "select cron.alter_job(jobid, active := false) from cron.job where active")
fi

start=$(date +%s)
docker exec "$CONTAINER" psql -X -U postgres -d postgres --single-transaction -v ON_ERROR_STOP=1 -q \
  -f "$stage/roles.sql" -f "$stage/align.sql" -f "$stage/schema.sql" -f "$stage/managed.sql" -f "$stage/defer.sql" \
  -c 'SET session_replication_role = replica' -f "$stage/data.sql" -c 'SET session_replication_role = origin' \
  -f "$stage/recheck.sql" -f "$stage/cron.sql" -f "$stage/ledger.sql" "${isolate[@]}" > /dev/null
echo "restore committed in $(( $(date +%s) - start ))s"

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
tokens="$(docker exec "$CONTAINER" psql -X -U postgres -tA -c "select case when to_regclass('public.push_device_tokens') is null then 'n/a' else (select count(*)::text from public.push_device_tokens) end")"
echo "push device tokens in the copy: $tokens (a notification-raising write posts to Expo for each)"

if [ -n "$VAULT_FROM" ]; then
  names_sql="$(echo "$VAULT_NAMES" | sed "s/[a-z0-9_]*/'&'/g")"
  docker exec "$VAULT_FROM" psql -X -U postgres -tA -v ON_ERROR_STOP=1 -c \
    "select format('select vault.create_secret(%L, %L, %L);', decrypted_secret, name, coalesce(description, '')) from vault.decrypted_secrets where name in ($names_sql) order by name" \
    | docker exec -i "$CONTAINER" psql -X -U postgres -q -v ON_ERROR_STOP=1 --single-transaction -o /dev/null
  echo "vault: $(docker exec "$CONTAINER" psql -U postgres -tA -c 'select count(*) from vault.secrets') secret(s) copied (values not shown)"
fi
echo "Next: verify (fingerprints, suites, HTTP), then copy Storage files separately."
