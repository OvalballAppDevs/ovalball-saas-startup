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
  capability_defaults_architecture
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
  club_kits
  club_activation_setup
  structured_venue_address
  venue_pitch_team_integrity
  safeguarding_officer_foundation
  safeguarding_officer_dispensation_notifications
  safeguarding_officer_security
  directory_public_profile
  constituent_bodies
  directory_admin_verification_status
  admin_referral_administration
  referral_intelligence_accounting
  match_centre_capabilities
  regulatory_content_administration
  referral_reward_semantics
  email_delivery_foundation
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

# ---------------------------------------------------------------------------
# TypeScript suites.
#
# Template escaping, safe URLs and plain-text generation cannot be asserted in
# SQL -- they are properties of the rendering layer. Node 24 runs TypeScript
# and ships its own test runner, so these need no test framework; the loader
# supplies nothing but path resolution. See scripts/email-test-loader.mjs for
# why a dependency was not added.
# ---------------------------------------------------------------------------
js_pass=0
js_suites=0
if [[ -d "$TEST_DIR/js" ]]; then
  for js_file in "$TEST_DIR"/js/*.test.mts; do
    [[ -e "$js_file" ]] || continue
    js_suites=$((js_suites + 1))
    js_name=$(basename "$js_file" .test.mts)
    js_output=$(NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL:-http://localhost:3000}" \
      node --import ./scripts/email-test-loader.mjs --experimental-strip-types \
      --test "$js_file" 2>&1)
    js_ok=$(sed -n 's/^.*# pass \([0-9]*\).*$/\1/p' <<<"$js_output" | tail -1)
    [[ -z "$js_ok" ]] && js_ok=$(grep -oE 'pass [0-9]+' <<<"$js_output" | tail -1 | grep -oE '[0-9]+')
    js_bad=$(grep -oE 'fail [0-9]+' <<<"$js_output" | tail -1 | grep -oE '[0-9]+')
    js_ok=${js_ok:-0}
    js_bad=${js_bad:-0}
    total_pass=$((total_pass + js_ok))
    total_fail=$((total_fail + js_bad))
    if [[ "$js_bad" -gt 0 ]]; then
      failed_suites+=("$js_name")
      printf '  FAIL  %-34s %s passed, %s failed\n' "$js_name" "$js_ok" "$js_bad"
      grep -E 'AssertionError|✖' <<<"$js_output" | head -12 | sed 's/^/          /'
    else
      printf '  ok    %-34s %s passed\n' "$js_name" "$js_ok"
    fi
  done
fi

echo
if [[ ${#failed_suites[@]} -gt 0 ]]; then
  echo "$total_pass passed, $total_fail failed — ${failed_suites[*]}"
  exit 1
fi

echo "$total_pass passed, 0 failed across $(( ${#SUITES[@]} + js_suites )) suites."
