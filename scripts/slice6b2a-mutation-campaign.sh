#!/usr/bin/env bash
#
# SLICE 6b.2a MUTATION CAMPAIGN
#
# A test suite that has never failed has not been shown to work. This
# deliberately reintroduces each defect 6b.2a fixed -- and each one it could
# plausibly acquire -- and requires that a PERMANENT test notices. A mutant
# that survives means the gate is decorative.
#
# RESTORATION IS BY SNAPSHOT, NEVER BY GIT. The first version of this script
# ended with `git checkout -- app lib`, which looked safe because the script had
# only just edited those files. It was not: git checkout restores to HEAD, and
# it silently destroyed every UNCOMMITTED change made earlier in the same
# session. "Restore" here means "put back exactly what I changed", so each file
# is copied aside before it is mutated and copied back afterwards, and each
# database function is captured with pg_get_functiondef and replayed. The script
# ends by proving every file is byte-identical to its snapshot.
#
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_ovalball-saas-startup}"
PASS=0; SURVIVED=0; SURVIVORS=()

sql() { docker exec -i "$CONTAINER" psql -U postgres -d postgres -Atq -c "$1"; }

# Snapshot a function's EXACT definition before mutating it, and put that back afterwards.
# Re-running the owning migration was the first approach and it is fragile: a migration is a script
# with guards and side effects, not a definition. pg_get_functiondef is the definition.
SNAP_DIR="$(mktemp -d)"
snapshot_fn() { # snapshot_fn <schema> <name>
  docker exec -i "$CONTAINER" psql -U postgres -d postgres -Atq -c \
    "select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='$1' and p.proname='$2' limit 1" > "$SNAP_DIR/$1.$2.sql"
  test -s "$SNAP_DIR/$1.$2.sql"
}
restore_fn() { docker exec -i "$CONTAINER" psql -U postgres -d postgres -q -f - < "$SNAP_DIR/$1.$2.sql" >/dev/null; }

# Run a permanent gate. Returns 0 if it PASSES.
# Node prints "ℹ fail N" with a multibyte prefix, so anchoring on '^.' does not match and would have
# made EVERY mutant look killed -- a false green that is worse than a survivor. Match the number.
gate_js() {
  local out
  out="$(node --import ./scripts/email-test-loader.mjs --experimental-strip-types --test "$1" 2>&1)"
  grep -qE '(^|[^a-z])fail 0$' <<<"$out"
}
gate_sql() {
  local out
  out="$(docker exec -i "$CONTAINER" psql -U postgres -d postgres -q -f - < "$1" 2>&1)"
  if grep -q 'FAIL' <<<"$out"; then return 1; fi
  return 0
}

# kill <name> <gate-command...>  -- the gate must FAIL while the mutant is live.
kill_check() {
  local name="$1"; shift
  if "$@"; then
    echo "  SURVIVED  $name"
    SURVIVED=$((SURVIVED+1)); SURVIVORS+=("$name")
  else
    echo "  killed    $name"
    PASS=$((PASS+1))
  fi
}

# File snapshot/restore. Keyed by a flattened path so nested files cannot collide.
snap_key() { echo "$1" | tr '/' '_'; }
snapshot() { for f in "$@"; do cp "$f" "$SNAP_DIR/$(snap_key "$f")"; done; }
restore()  { for f in "$@"; do cp "$SNAP_DIR/$(snap_key "$f")" "$f"; done; }
verify_restored() {
  local bad=0
  for f in "$@"; do
    cmp -s "$f" "$SNAP_DIR/$(snap_key "$f")" || { echo "  NOT RESTORED: $f"; bad=1; }
  done
  return $bad
}

# Everything this campaign is allowed to touch, snapshotted before anything is mutated.
MUTATED=(
  "app/(app)/layout.tsx"
  "lib/auth/require-session.ts"
  "lib/auth/session-decision.ts"
  "app/(app)/account/security/recovery-actions.ts"
  "app/api/gocardless/oauth/start/route.ts"
  "app/signup/steps/account-step.tsx"
  "lib/auth/challenge-state.ts"
)
snapshot "${MUTATED[@]}"

echo "=== Slice 6b.2a mutation campaign ==="
echo "snapshotted ${#MUTATED[@]} files into $SNAP_DIR"

# ---------------------------------------------------------------- M1
echo "M1 remove the (app) layout's requireSession"
perl -0pi -e 's/const decision = await requireSession\(\{\}, supabase\)/const decision = { ok: true, user: (await supabase.auth.getUser()).data.user } as never/' "app/(app)/layout.tsx"
kill_check "M1 layout boundary removed" gate_js supabase/tests/js/session_boundary_coverage.test.mts
restore "app/(app)/layout.tsx"

# ---------------------------------------------------------------- M2
echo "M2 make session liveness always true"
snapshot_fn internal session_live_only || { echo "  ABORT: could not snapshot session_live_only"; exit 1; }
sql "create or replace function internal.session_live_only() returns boolean language sql stable security definer set search_path='' as \$\$ select true \$\$;" >/dev/null
kill_check "M2 session liveness disabled" gate_sql supabase/tests/session_boundary.sql
restore_fn internal session_live_only

# ---------------------------------------------------------------- M3
echo "M3 ignore suspended/disabled account state"
snapshot_fn internal is_account_active || { echo "  ABORT: could not snapshot is_account_active"; exit 1; }
# The parameter is p_user_id. Naming it anything else makes CREATE OR REPLACE fail, the mutant never
# goes live, and the run reports a survivor that was never alive -- which is how this line was found.
sql "create or replace function internal.is_account_active(p_user_id uuid) returns boolean language sql stable security definer set search_path='' as \$\$ select true \$\$;" >/dev/null
kill_check "M3 account state ignored" gate_sql supabase/tests/session_boundary.sql
restore_fn internal is_account_active

# ---------------------------------------------------------------- M4
echo "M4 make allowAalElevation globally true"
perl -0pi -e 's/if \(!options\.allowAalElevation &&/if (true \|\| !options.allowAalElevation \&\&/' lib/auth/session-decision.ts
# Deliberately NOT the structural coverage guard. That one asserts which FILES may pass the option,
# and it survived this mutant on the first run because the option was still only passed by the two
# legitimate surfaces -- it had simply stopped meaning anything. The decision table is what notices.
kill_check "M4 assurance gate globally stood down" gate_js supabase/tests/js/session_decision.test.mts
restore lib/auth/session-decision.ts

# ---------------------------------------------------------------- M5
echo "M5 remove one protected Server Action guard"
perl -0pi -e 's/const gate = await guardAction\(\{\}, supabase\)\n\s*if \(!gate\.ok\) return \{ ok: false, error: gate\.error \}\n//' "app/(app)/account/security/recovery-actions.ts"
kill_check "M5 Server Action guard removed" gate_js supabase/tests/js/session_boundary_coverage.test.mts
restore "app/(app)/account/security/recovery-actions.ts"

# ---------------------------------------------------------------- M6
echo "M6 remove one protected route-handler guard"
perl -0pi -e 's/const decision = await requireSession\(\{\}, supabase\)/const decision = { ok: true } as never/' app/api/gocardless/oauth/start/route.ts
kill_check "M6 route handler guard removed" gate_js supabase/tests/js/session_boundary_coverage.test.mts
restore app/api/gocardless/oauth/start/route.ts

# ---------------------------------------------------------------- M7
echo "M7 treat a valid session as capability authority"
snapshot_fn internal has_site_capability || { echo "  ABORT: could not snapshot has_site_capability"; exit 1; }
sql "create or replace function internal.has_site_capability(p_key text) returns boolean language sql stable security definer set search_path='' as \$\$ select auth.uid() is not null \$\$;" >/dev/null
kill_check "M7 session treated as capability" gate_sql supabase/tests/session_boundary.sql
restore_fn internal has_site_capability

# ---------------------------------------------------------------- M8
echo "M8 restore the social-signup hardcoded null token"
perl -0pi -e 's/turnstileToken=\{turnstileToken\}/turnstileToken={null}/' app/signup/steps/account-step.tsx
kill_check "M8 social signup null token" gate_js supabase/tests/js/turnstile_challenge_state.test.mts
restore app/signup/steps/account-step.tsx

# ---------------------------------------------------------------- M9
echo "M9 permit humanPassed=true beside a null token"
perl -0pi -e 's/  if \(!required\) return true\n  return state\.passed && state\.token !== null/  if (!required) return true\n  return state.passed/' lib/auth/challenge-state.ts
kill_check "M9 passed-without-token permitted" gate_js supabase/tests/js/turnstile_challenge_state.test.mts
restore lib/auth/challenge-state.ts

# ---------------------------------------------------------------- M10
echo "M10 return the raw database error from cancelRecovery"
perl -0pi -e 's/    console\.error\("cancelRecovery refused:", error\.code \?\? error\.message\)\n    return \{ ok: false, error: toPublicSubmissionError\(\) \}/    return { ok: false, error: error.message }/' "app/(app)/account/security/recovery-actions.ts"
kill_check "M10 raw DB error to the browser" gate_js supabase/tests/js/session_boundary_coverage.test.mts
restore "app/(app)/account/security/recovery-actions.ts"

echo
echo "=== proving every mutated file is byte-identical to its snapshot ==="
if verify_restored "${MUTATED[@]}"; then
  echo "all ${#MUTATED[@]} mutated files restored exactly"
  DIRTY=0
else
  DIRTY=1
fi
rm -rf "$SNAP_DIR"

echo
echo "killed: $PASS    survived: $SURVIVED"
if [ "$SURVIVED" -gt 0 ]; then printf '  SURVIVOR: %s\n' "${SURVIVORS[@]}"; fi
[ "$SURVIVED" -eq 0 ] && [ "$DIRTY" -eq 0 ]
