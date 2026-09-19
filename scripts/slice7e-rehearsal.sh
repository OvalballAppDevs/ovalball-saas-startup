#!/usr/bin/env bash
# =====================================================================================================
# PRODUCTION-SHAPED REHEARSAL -- Convergence Step 5 / Slice 7e
#
# WHY THIS IS NOT THE CLEAN BOOT. `scripts/isolated-clean-boot.sh` proves the whole chain installs from
# EMPTY. That is a different question from the one a release asks, which is: applied to a database that
# is already at the current production tip, in the order and one at a time, do these four migrations do
# what they claim and nothing else?
#
# Two of Slice 7e's four are the kind where the difference matters:
#
#   20270506000000  recreates a VIEW and then DROPS a function. On an empty chain the view is created
#                   fresh moments earlier by its own original migration; here it already exists, with
#                   dependents, exactly as it does in production.
#   20270507000000  REPLACES the bodies of three existing functions. From empty, "replace" and "create"
#                   are indistinguishable.
#
# WHAT THIS IS HONEST ABOUT. It rehearses production's SHAPE -- the same tip, the same order, one at a
# time, a dry run before each -- not production's DATA. Nothing here reads or touches the production
# project, and the report says so rather than implying a fidelity it does not have.
#
# WHAT IT CREATES AND DESTROYS: one disposable Supabase project, on its own ports, destroyed at the end.
# It refuses to run if the derived project id has not actually changed.
#
#   scripts/slice7e-rehearsal.sh
# =====================================================================================================
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANONICAL_ID="$(grep -E '^project_id' "$REPO/supabase/config.toml" | head -1 | sed -E 's/.*"(.*)".*/\1/')"
BOOT_ID="${CANONICAL_ID}-rehearsal"
WORKDIR="${TMPDIR:-/tmp}/ovalball-slice7e-rehearsal"
BASELINE_TIP="20270503000000"
STEP_MIGRATIONS=(
  20270504000000_site_search_users.sql
  20270505000000_site_admin_can_read_the_roster_it_can_change.sql
  20270506000000_retire_is_site_admin.sql
  20270507000000_the_timelines_can_see_their_own_events.sql
)

if [ "$BOOT_ID" = "$CANONICAL_ID" ]; then
  echo "REFUSING: the disposable project id is identical to the canonical one ($CANONICAL_ID)." >&2
  exit 1
fi

cleanup() {
  echo "-- destroying the disposable project"
  (cd "$WORKDIR" 2>/dev/null && npx supabase stop --project-id "$BOOT_ID" --no-backup >/dev/null 2>&1)
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "== production-shaped rehearsal: $BOOT_ID =="
echo "   baseline tip: $BASELINE_TIP, then ${#STEP_MIGRATIONS[@]} migrations one at a time"
rm -rf "$WORKDIR"
mkdir -p "$WORKDIR/supabase/migrations"

python3 - "$REPO/supabase/config.toml" "$WORKDIR/supabase/config.toml" "$CANONICAL_ID" "$BOOT_ID" <<'PY'
import re, sys
src, dst, canonical, boot = sys.argv[1:5]
text = open(src).read()
text = text.replace(f'project_id = "{canonical}"', f'project_id = "{boot}"')
# 543xx -> 563xx. A different offset from the clean boot's, so the two can never collide.
text = re.sub(r'\b543(\d\d)\b', lambda m: f"563{m.group(1)}", text)
open(dst, "w").write(text)
PY

# THE BASELINE. Everything up to and including the current production tip, and nothing after it.
copied=0
for f in "$REPO"/supabase/migrations/*.sql; do
  name="$(basename "$f")"
  version="${name%%_*}"
  if [[ "$version" < "$BASELINE_TIP" || "$version" == "$BASELINE_TIP" ]]; then
    cp "$f" "$WORKDIR/supabase/migrations/$name"
    copied=$((copied + 1))
  fi
done
echo "-- baseline: $copied migrations"
[ -f "$REPO/supabase/seed.sql" ] && cp "$REPO/supabase/seed.sql" "$WORKDIR/supabase/seed.sql"
[ -d "$REPO/supabase/seeds" ] && cp -R "$REPO/supabase/seeds" "$WORKDIR/supabase/seeds"

echo "-- starting the baseline stack (this takes a couple of minutes)"
if ! (cd "$WORKDIR" && npx supabase start >/tmp/ovalball-rehearsal-start.log 2>&1); then
  echo "FAILED to start the baseline stack. Last lines:" >&2
  tail -20 /tmp/ovalball-rehearsal-start.log >&2
  exit 1
fi

CONTAINER="supabase_db_${BOOT_ID}"
docker inspect "$CONTAINER" >/dev/null 2>&1 || { echo "FAILED: $CONTAINER is not running" >&2; exit 1; }
psql_boot() { docker exec -i "$CONTAINER" psql -U postgres -d postgres -Atq "$@"; }

measure() {
  psql_boot -c "select
      (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'site\\_%')
      || '|' || (select count(*) from pg_policies)
      || '|' || (select count(*) from public.capabilities)
      || '|' || (select count(*) from public.profiles)
      || '|' || (select count(*) from public.club_memberships)
      || '|' || (select count(*) from public.role_assignments)
      || '|' || (select count(*) from public.site_admins)
      || '|' || (select coalesce((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='internal' and p.proname='is_site_admin'),0))"
}

BEFORE="$(measure)"
echo "-- baseline measured: site_* fns|policies|capabilities|profiles|memberships|role_assignments|site_admins|is_site_admin"
echo "   $BEFORE"

STATUS=0
for m in "${STEP_MIGRATIONS[@]}"; do
  echo ""
  echo "-- $m"
  # THE DRY RUN. Applied inside a transaction that is rolled back, so a migration that would fail is
  # found before anything is written -- the same discipline as `db push --dry-run`, done where a real
  # rollback is possible.
  if ! { echo "begin;"; cat "$REPO/supabase/migrations/$m"; echo "rollback;"; } \
       | docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q >/tmp/ovalball-rehearsal-dry.log 2>&1; then
    echo "   DRY RUN FAILED:"
    sed 's/^/     /' /tmp/ovalball-rehearsal-dry.log | tail -8
    STATUS=1
    continue
  fi
  echo "   dry run: clean"

  if ! docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f - \
       < "$REPO/supabase/migrations/$m" >/tmp/ovalball-rehearsal-apply.log 2>&1; then
    echo "   APPLY FAILED:"
    sed 's/^/     /' /tmp/ovalball-rehearsal-apply.log | tail -8
    STATUS=1
    continue
  fi
  grep -o 'NOTICE:.*' /tmp/ovalball-rehearsal-apply.log | sed 's/^/     /'
  echo "   applied.  $(measure)"
done

AFTER="$(measure)"
echo ""
echo "-- delta"
python3 - "$BEFORE" "$AFTER" <<'PY'
import sys
labels = ["site_* functions","policies","capabilities","profiles","club_memberships","role_assignments","site_admins","internal.is_site_admin"]
before = sys.argv[1].split("|"); after = sys.argv[2].split("|")
bad = []
for label, b, a in zip(labels, before, after):
    mark = "" if b == a else f"   <-- {int(a) - int(b):+d}"
    print(f"   {label:<24} {b:>5} -> {a:>5}{mark}")
    # NOBODY'S ACCESS CHANGES. A schema migration that moves a membership, a role or an
    # administrator is doing something it did not say it was doing.
    if label in ("profiles","club_memberships","role_assignments","site_admins") and b != a:
        bad.append(label)
if bad:
    print("   FAIL: these are people's access and must not move: " + ", ".join(bad))
    sys.exit(1)
PY
[ $? -ne 0 ] && STATUS=1

echo ""
echo "-- the estate's own assertions, against the rehearsed database"
for suite in site_admin_users_access_closure authority_helper_retirement security_perimeter_guard definer_rpc_session_contract; do
  out=$(docker exec -i "$CONTAINER" psql -U postgres -d postgres -q -f - < "$REPO/supabase/tests/$suite.sql" 2>&1)
  fails=$(printf '%s' "$out" | grep -c "FAIL" || true)
  passes=$(printf '%s' "$out" | grep -c "PASS" || true)
  echo "   $suite: $passes passed, $fails failed"
  [ "$fails" != "0" ] && STATUS=1
done

echo ""
if [ "$STATUS" = "0" ]; then
  echo "REHEARSAL: PASS -- four migrations applied one at a time from the production tip, each dry-run first,"
  echo "           and no membership, role, profile or administrator moved."
else
  echo "REHEARSAL: FAIL"
fi
exit $STATUS
