#!/usr/bin/env bash
# Start a DISPOSABLE local Supabase project as an ISOLATED restore target, prove it, and keep it guarded.
#
#   scripts/ops/restore/start-isolated-restore-target.sh --target-project-dir DIR [--relay-port N]
#   scripts/ops/restore/start-isolated-restore-target.sh --target-project-dir DIR --destroy
#
# 1. Refuses the persistent project, an unclean project_id, and a target .env whose Auth URLs are not loopback.
# 2. Runs `supabase start` THROUGH docker-loopback-proxy.py (every published port bound to 127.0.0.1), with only the
#    services a restore needs: no vector (it mounts the Docker socket), analytics, Studio, Meta, Edge runtime,
#    imgproxy or pooler.
# 3. `restore-target-isolation.py isolate`: every container -- Kong included -- on an internal network only. No
#    container has a route out; Docker Desktop forwards none of their ports.
# 4. `verify` must pass; then starts, detached, the loopback API relay (127.0.0.1:<relay port> -> docker exec into
#    Kong's own loopback) and the isolation GUARD (stops the whole target on any structural change), and verifies
#    again through the relay.
#
# Never `supabase stop`/`start` a target that holds production data: --destroy it and start afresh. --destroy stops
# the guard and the relay, removes the target's containers, volumes and internal network, and touches nothing else.
set -euo pipefail

PERSISTENT_PROJECT_ID="ovalball-saas-startup"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXCLUDE="vector,logflare,studio,postgres-meta,edge-runtime,imgproxy,supavisor"
TARGET=""; RELAY_PORT=""; DESTROY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --target-project-dir) TARGET="$2"; shift 2 ;;
    --relay-port) RELAY_PORT="$2"; shift 2 ;;
    --destroy) DESTROY=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
refuse() { echo "REFUSED: $*" >&2; exit 2; }

[ -n "$TARGET" ] && [ -f "$TARGET/supabase/config.toml" ] || refuse "--target-project-dir must hold supabase/config.toml"
TARGET="$(cd "$TARGET" && pwd)"
[ "$(grep -c '^[[:space:]]*project_id[[:space:]]*=' "$TARGET/supabase/config.toml")" = "1" ] || refuse "config.toml must define project_id exactly once"
PID="$(sed -n 's/^[[:space:]]*project_id[[:space:]]*=[[:space:]]*"\([a-z0-9-]*\)"[[:space:]]*$/\1/p' "$TARGET/supabase/config.toml")"
[[ "$PID" =~ ^[a-z0-9][a-z0-9-]*$ ]] || refuse "project_id must be a plain double-quoted id"
[ "$PID" != "$PERSISTENT_PROJECT_ID" ] || refuse "that is the persistent local project"

stop_pidfile() {  # kill the process recorded in $1 only if its command line is what we started
  local f="$TARGET/$1" pat="$2" p
  [ -f "$f" ] || return 0
  p="$(awk '{print $1}' "$f")"
  # Only if that process is still OUR process for THIS target: a recycled PID or another target's relay is left alone.
  local cmd; cmd="$(ps -p "$p" -o command= 2>/dev/null || true)"
  # Exact token: "--project-dir <TARGET>" followed by a space or the end -- never a sibling such as "<TARGET>-other".
  if [[ "$p" =~ ^[0-9]+$ ]] && [[ "$cmd" == *"$pat"* ]] && { [[ "$cmd" == *"--project-dir $TARGET "* ]] || [[ "$cmd" == *"--project-dir $TARGET" ]]; }; then kill "$p" 2>/dev/null || true; fi
  rm -f "$f"
}

if [ "$DESTROY" -eq 1 ]; then
  stop_pidfile .isolation-guard.pid "restore-target-isolation.py guard"   # the guard trips on this and destroys the target itself
  stop_pidfile .api-relay.pid "loopback-api-relay.py"
  rm -f "$TARGET/.isolation-guard.heartbeat"
  sleep 1
  # Scope-aware, never the persistent project, and confirmed object by object; non-zero if anything is left.
  python3 "$HERE/restore-target-isolation.py" destroy --project-dir "$TARGET"
  exit $?
fi

# A live guard means a guarded target already exists: it is destroyed, never restarted. And ANY container or volume
# left of this target (a guard that died, a stop that kept the volumes) is refused too: the CLI would bring retained
# data back up on its own network before it could be isolated.
if python3 "$HERE/restore-target-isolation.py" guard-status --project-dir "$TARGET" >/dev/null 2>&1; then
  refuse "a guarded target already exists for $PID; --destroy it first (a target is never restarted)"
fi
existing_ctrs="$(docker ps -aq --filter "label=com.supabase.cli.project=$PID")" || refuse "could not list Docker containers"
existing_names="$(docker ps -a --format '{{.Names}}')" || refuse "could not list Docker containers"
# Also by NAME: an unlabelled leftover such as supabase_db_<id> would otherwise be reused before isolation.
if [[ $'\n'"$existing_names"$'\n' == *"_${PID}"$'\n'* ]]; then existing_ctrs="$existing_ctrs named"; fi
existing_vols="$(docker volume ls -q)" || refuse "could not list Docker volumes"
# Matched in the shell, not through a pipe: a pipe closed early (grep -q) would fail the producer under pipefail and
# read as "absent".
if [ -n "$existing_ctrs" ] || [[ $'\n'"$existing_vols"$'\n' == *"_${PID}"$'\n'* ]]; then
  refuse "containers or volumes of $PID already exist; --destroy it first (a target is never restarted)"
fi
rm -f "$TARGET/.isolation-guard.pid"

# The CLI reads env(...) values from the target's own .env: Auth's links must point at this Mac, never at a LAN address.
[ -f "$TARGET/.env" ] || refuse "the target needs its own .env (see PRODUCTION_BACKUP_RECOVERY_RUNBOOK.md, 'Restore isolation'); never copy the repository's"
for key in SUPABASE_AUTH_EXTERNAL_URL SUPABASE_SITE_URL; do
  value="$(sed -n "s/^${key}=//p" "$TARGET/.env" | tail -1)"
  [[ "$value" =~ ^https?://(127\.0\.0\.1|localhost)(:[0-9]+)?(/.*)?$ ]] || refuse "$key in the target .env must be a loopback URL"
done
if [ -z "$RELAY_PORT" ]; then
  api_port="$(awk '/^\[api\]/{f=1;next} /^\[/{f=0} f && /^port[[:space:]]*=/{gsub(/[^0-9]/,"");print;exit}' "$TARGET/supabase/config.toml")"
  RELAY_PORT=$((api_port + 20))
fi

SOCKDIR="$(mktemp -d /tmp/ovb-dlp.XXXXXX)"   # short path: a Unix socket path must stay under 104 bytes
chmod 700 "$SOCKDIR"
SOCK="$SOCKDIR/d.sock"
python3 "$HERE/docker-loopback-proxy.py" --listen "$SOCK" 2> "$SOCKDIR/proxy.log" &
PROXY=$!
STARTED_OK=0
cleanup() {
  kill "$PROXY" 2>/dev/null || true; rm -rf "$SOCKDIR"
  # Anything short of a fully guarded, verified target is destroyed: never left running half-isolated.
  if [ "$STARTED_OK" -ne 1 ]; then echo "start did not complete; destroying the target" >&2; "$0" --target-project-dir "$TARGET" --destroy >&2 || true; fi
}
trap cleanup EXIT
for _ in $(seq 1 50); do [ -S "$SOCK" ] && break; sleep 0.1; done
[ -S "$SOCK" ] || refuse "the loopback proxy did not start"

echo "Starting $PID through the loopback proxy (excluding $EXCLUDE)..."
(cd "$TARGET" && DOCKER_HOST="unix://$SOCK" npx supabase start -x "$EXCLUDE" > "$SOCKDIR/start.log" 2>&1) || { tail -20 "$SOCKDIR/start.log" >&2; refuse "supabase start failed"; }
grep '^\[docker-loopback-proxy\] \(create\|REFUSED\)' "$SOCKDIR/proxy.log" | sed 's/^/  /' || true
kill "$PROXY" 2>/dev/null || true; wait "$PROXY" 2>/dev/null || true

python3 "$HERE/restore-target-isolation.py" isolate --project-dir "$TARGET"
sleep 3
python3 "$HERE/restore-target-isolation.py" verify --project-dir "$TARGET" --quiet

stop_pidfile .api-relay.pid "loopback-api-relay.py"
nohup python3 "$HERE/loopback-api-relay.py" --project-dir "$TARGET" --port "$RELAY_PORT" > "$TARGET/.api-relay.log" 2>&1 &
echo $! > "$TARGET/.api-relay.pid"
nohup python3 "$HERE/restore-target-isolation.py" guard --project-dir "$TARGET" > "$TARGET/.isolation-guard.log" 2>&1 &
for _ in $(seq 1 50); do [ -f "$TARGET/.isolation-guard.heartbeat" ] && break; sleep 0.2; done
# A target is never left running without a live guard and a proven relay: if either fails, it is destroyed.
if ! python3 "$HERE/restore-target-isolation.py" guard-status --project-dir "$TARGET" \
   || ! python3 "$HERE/restore-target-isolation.py" verify --project-dir "$TARGET" --quiet --api-port "$RELAY_PORT"; then
  refuse "the guard or the relay did not come up healthy; the target is being destroyed"
fi
STARTED_OK=1
echo "API (loopback only): http://127.0.0.1:$RELAY_PORT   guard log: $TARGET/.isolation-guard.log"
