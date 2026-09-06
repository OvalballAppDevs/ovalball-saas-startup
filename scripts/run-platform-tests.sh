#!/usr/bin/env bash
#
# Runs every commercial-platform SQL suite against the LOCAL database and
# fails if any assertion does not read PASS.
#
# Each suite is wrapped in begin/rollback, so running this leaves the local
# database exactly as it found it. It never touches a remote project: the
# container name below is the local Supabase stack and nothing else.
#
#   ./scripts/run-platform-tests.sh
#
set -uo pipefail

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_ovalball-saas-startup}"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../supabase/tests" && pwd)"

SUITES=(
  invite_only_onboarding
  platform_release_and_mode
  platform_trials
  platform_plans_entitlements
  platform_club_subscriptions
  platform_gocardless
  platform_referrals
  platform_activation
  platform_rls_sweep
  referral_attribution_integrity
  site_admin_dashboard
  support_messaging
  site_admin_dashboard_phase_b
)

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "Local Supabase container '$CONTAINER' is not running. Start it with: npx supabase start" >&2
  exit 2
fi

total_pass=0
total_fail=0
failed_suites=()

for suite in "${SUITES[@]}"; do
  file="$TEST_DIR/$suite.sql"
  if [[ ! -f "$file" ]]; then
    echo "MISSING  $suite.sql" >&2
    failed_suites+=("$suite (missing)")
    continue
  fi

  output=$(docker exec -i "$CONTAINER" psql -U postgres -d postgres -q -f - < "$file" 2>&1)
  pass=$(grep -c 'NOTICE:  PASS' <<<"$output" || true)
  fail=$(grep -c 'NOTICE:  FAIL' <<<"$output" || true)
  errors=$(grep -c '^ERROR:\|psql:.*ERROR:' <<<"$output" || true)

  total_pass=$((total_pass + pass))
  total_fail=$((total_fail + fail))

  if [[ "$fail" -gt 0 || "$errors" -gt 0 ]]; then
    failed_suites+=("$suite")
    printf '  FAIL  %-34s %s passed, %s failed\n' "$suite" "$pass" "$fail"
    grep -E 'NOTICE:  FAIL|ERROR' <<<"$output" | sed 's/^/          /'
  else
    printf '  ok    %-34s %s passed\n' "$suite" "$pass"
  fi
done

echo
if [[ ${#failed_suites[@]} -gt 0 ]]; then
  echo "$total_pass passed, $total_fail failed — ${failed_suites[*]}"
  exit 1
fi

echo "$total_pass passed, 0 failed across ${#SUITES[@]} suites."
