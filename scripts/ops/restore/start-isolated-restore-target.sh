#!/usr/bin/env bash
# Start a DISPOSABLE local Supabase project as an ISOLATED restore target, then prove it.
#
#   scripts/ops/restore/start-isolated-restore-target.sh --target-project-dir DIR
#
# 1. Refuses the persistent project, an unclean project_id, and a target .env whose Auth URLs are not loopback.
# 2. Starts docker-loopback-proxy.py on a private socket and runs `supabase start` THROUGH it, so every published port
#    of every container binds 127.0.0.1. Only the services a restore needs are started: no vector (it mounts the
#    Docker socket), no analytics, Studio, Meta, Edge runtime, imgproxy or pooler.
# 3. Stops the proxy (only container creation needs it) and runs `restore-target-isolation.py isolate` (internal
#    network; only Kong keeps a route to the host).
# 4. Runs `restore-target-isolation.py verify`; exits non-zero unless every check passes.
#
# Run it again after ANY `supabase stop`/`start` of the target: the CLI recreates containers on its own network, and
# the restore tooling refuses the target until this has been run and has passed. It changes nothing outside the
# target's own containers and networks; it never touches the persistent project.
set -euo pipefail

PERSISTENT_PROJECT_ID="ovalball-saas-startup"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXCLUDE="vector,logflare,studio,postgres-meta,edge-runtime,imgproxy,supavisor"
TARGET=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target-project-dir) TARGET="$2"; shift 2 ;;
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
# The CLI reads env(...) values from the target's own .env: Auth's links must point at this Mac, never at a LAN address.
[ -f "$TARGET/.env" ] || refuse "the target needs its own .env (see PRODUCTION_BACKUP_RECOVERY_RUNBOOK.md, 'Restore isolation'); never copy the repository's"
for key in SUPABASE_AUTH_EXTERNAL_URL SUPABASE_SITE_URL; do
  value="$(sed -n "s/^${key}=//p" "$TARGET/.env" | tail -1)"
  [[ "$value" =~ ^https?://(127\.0\.0\.1|localhost)(:[0-9]+)?(/.*)?$ ]] || refuse "$key in the target .env must be a loopback URL"
done

SOCKDIR="$(mktemp -d /tmp/ovb-dlp.XXXXXX)"   # short path: a Unix socket path must stay under 104 bytes
chmod 700 "$SOCKDIR"
SOCK="$SOCKDIR/d.sock"
python3 "$HERE/docker-loopback-proxy.py" --listen "$SOCK" 2> "$SOCKDIR/proxy.log" &
PROXY=$!
cleanup() { kill "$PROXY" 2>/dev/null || true; rm -rf "$SOCKDIR"; }
trap cleanup EXIT
for _ in $(seq 1 50); do [ -S "$SOCK" ] && break; sleep 0.1; done
[ -S "$SOCK" ] || refuse "the loopback proxy did not start"

echo "Starting $PID through the loopback proxy (excluding $EXCLUDE)..."
(cd "$TARGET" && DOCKER_HOST="unix://$SOCK" npx supabase start -x "$EXCLUDE" > "$SOCKDIR/start.log" 2>&1) || { tail -20 "$SOCKDIR/start.log" >&2; refuse "supabase start failed"; }
grep '^\[docker-loopback-proxy\] \(create\|REFUSED\)' "$SOCKDIR/proxy.log" | sed 's/^/  /' || true
kill "$PROXY" 2>/dev/null || true; wait "$PROXY" 2>/dev/null || true

python3 "$HERE/restore-target-isolation.py" isolate --project-dir "$TARGET"
sleep 5
python3 "$HERE/restore-target-isolation.py" verify --project-dir "$TARGET" --quiet
