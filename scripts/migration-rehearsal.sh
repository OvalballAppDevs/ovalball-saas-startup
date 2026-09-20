#!/usr/bin/env bash
# =====================================================================================================
# PRODUCTION-SHAPED REHEARSAL -- any step's migrations, from any baseline tip
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
#   scripts/migration-rehearsal.sh <baseline-tip> <migration.sql> [migration.sql ...]
#
# e.g.  scripts/migration-rehearsal.sh 20270503000000 20270504000000_site_search_users.sql ...
#
# Generalised at Convergence Step 6. It was written for Slice 7e with its four migrations hard-coded,
# and Step 6 needed the same thing for six -- so rather than a second copy that would drift from the
# first, the baseline and the list became arguments. Nothing else about it changed.
# =====================================================================================================
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANONICAL_ID="$(grep -E '^project_id' "$REPO/supabase/config.toml" | head -1 | sed -E 's/.*"(.*)".*/\1/')"
BOOT_ID="${CANONICAL_ID}-rehearsal"
WORKDIR="${TMPDIR:-/tmp}/ovalball-migration-rehearsal"

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <baseline-tip> <migration.sql> [migration.sql ...]" >&2
  echo "  baseline-tip   the migration version production is currently at" >&2
  exit 2
fi
BASELINE_TIP="$1"; shift
STEP_MIGRATIONS=("$@")

for m in "${STEP_MIGRATIONS[@]}"; do
  if [ ! -f "$REPO/supabase/migrations/$m" ]; then
    echo "REFUSING: $m is not in supabase/migrations" >&2
    exit 2
  fi
done

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
      || '|' || (select count(*) from public.clubs)
      || '|' || (select count(*) from public.venues)
      || '|' || (select count(*) from public.club_pitches)
      || '|' || (select count(*) from public.teams)
      || '|' || (select count(*) from public.fixtures)
      || '|' || (select count(*) from public.fixture_requests)
      || '|' || (select count(*) from public.competitions)
      || '|' || (select count(*) from public.competition_matches)
      || '|' || (select coalesce((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='internal' and p.proname='is_site_admin'),0))"
}

BEFORE="$(measure)"
# Convergence Step 7 added fixture_requests, competitions and competition_matches: this is the fixture
# step, and §45 names them as the tables whose counts have to be seen not to move.
echo "-- baseline measured: site_* fns|policies|capabilities|profiles|memberships|role_assignments|site_admins|clubs|venues|pitches|teams|fixtures|fixture_requests|competitions|competition_matches|is_site_admin"
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
# Convergence Step 7 added the last three before internal.is_site_admin. The
# length guard below caught this list being out of step with measure() the
# moment they were added, which is exactly what it was written for.
labels = ["site_* functions","policies","capabilities","profiles","club_memberships","role_assignments",
          "site_admins","clubs","venues","club_pitches","teams","fixtures",
          "fixture_requests","competitions","competition_matches","internal.is_site_admin"]
before = sys.argv[1].split("|"); after = sys.argv[2].split("|")
if len(before) != len(labels) or len(after) != len(labels):
    print(f"   FAIL: the measure emits {len(before)} values and there are {len(labels)} labels -- "
          f"a misaligned report is worse than none")
    sys.exit(1)
bad = []
for label, b, a in zip(labels, before, after):
    mark = "" if b == a else f"   <-- {int(a) - int(b):+d}"
    print(f"   {label:<24} {b:>5} -> {a:>5}{mark}")
    # NOBODY'S ACCESS CHANGES. A schema migration that moves a membership, a role or an
    # administrator is doing something it did not say it was doing.
    # People's access AND the canonical club/venue/pitch/team/fixture records. A schema migration that
    # creates or removes one of these is doing something it did not say it was doing.
    if label in ("profiles","club_memberships","role_assignments","site_admins",
                 "clubs","venues","club_pitches","teams","fixtures",
                 "fixture_requests","competitions","competition_matches") and b != a:
        bad.append(label)
if bad:
    print("   FAIL: these are people's access or canonical club data and must not move: " + ", ".join(bad))
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
  echo "REHEARSAL: PASS -- ${#STEP_MIGRATIONS[@]} migration(s) applied one at a time from $BASELINE_TIP, each"
  echo "           dry-run first, and no membership, role, profile, administrator, club, venue, pitch,"
  echo "           team or fixture moved."
else
  echo "REHEARSAL: FAIL"
fi
exit $STATUS
