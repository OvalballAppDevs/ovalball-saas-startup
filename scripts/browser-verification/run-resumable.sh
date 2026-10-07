#!/usr/bin/env bash
#
# RESUMABLE BROWSER RUN — the gate's browser suites, one at a time, into a run directory that survives an
# interruption.
#
#   scripts/browser-verification/run-resumable.sh <run-dir> [suite ...]
#
# The whole gate (scripts/run-platform-tests.sh) is the release evidence. This exists for the long sweeps
# where the gate cannot run in one sitting -- a two-hour job limit, a stop between suites -- and it must
# never be able to disagree with the gate about a suite. So it borrows everything that decides a result
# rather than restating it:
#
#   * the suite list is the gate's BROWSER_SUITES, in the gate's order (or the suites named on the line);
#   * each suite is run exactly as the gate runs it: `node scripts/browser-verification/<suite>.mjs`;
#   * assertions are counted exactly as the gate counts them: lines beginning PASS and FAIL;
#   * the outcome comes from classify_suite_outcome in suite-exit-truth.sh, the one function that decides.
#
# THE VERDICT IS THE ASSERTIONS AND THE EXIT STATUS TOGETHER. A suite that prints FAIL lines and exits 0 is
# FAIL. A suite that exits 0 having proved nothing is EMPTY. A suite still running after SUITE_TIMEOUT
# seconds (default 900) is stopped and is CRASH: a hang is not a pass, however many PASS lines came first.
# The run passes only when every suite asked for has a result and every result is `ok`.
#
# Each suite's whole output is kept in <run-dir>/<suite>.log, passing or not, so a later doubt is settled
# by reading rather than re-running. <run-dir>/results.tsv holds one line per finished suite:
#   suite  outcome  passed  failed  exit-status  seconds
# Running again with the same directory resumes: suites that already have a line are skipped, unless
# RERUN=1 (all) or they are named on the command line.
#
# Like the gate, it needs the local stack (dev server, Supabase, Mailpit) and SUPABASE_SERVICE_ROLE_KEY in
# the environment; it loads .env.local for that when the variable is not already set, and prints no value.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BV_DIR="$ROOT/scripts/browser-verification"
# shellcheck source=suite-exit-truth.sh
. "$BV_DIR/suite-exit-truth.sh"

RUN_DIR="${1:-}"
if [[ -z "$RUN_DIR" ]]; then
  echo "usage: $0 <run-dir> [suite ...]" >&2
  exit 2
fi
shift
mkdir -p "$RUN_DIR"
RESULTS="$RUN_DIR/results.tsv"
touch "$RESULTS"
SUITE_TIMEOUT="${SUITE_TIMEOUT:-900}"

if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" && -f "$ROOT/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env.local"
  set +a
fi

named=0
if [[ $# -gt 0 ]]; then
  suites=("$@")
  named=1
else
  # bash 3.2 (macOS): no mapfile. The list is the gate's, comments removed, in its order.
  suites=($(awk '/^BROWSER_SUITES=\(/{f=1;next} f&&/^\)/{exit} f' "$ROOT/scripts/run-platform-tests.sh" \
    | sed 's/#.*//' | tr -s ' \t' '\n' | grep -E '^[0-9]{2}-'))
fi
if [[ ${#suites[@]} -eq 0 ]]; then
  echo "No suites found to run." >&2
  exit 2
fi

blocked=""
if [[ ! -e "$ROOT/node_modules/playwright-core" ]]; then
  blocked="playwright-core is not linked into node_modules (see scripts/browser-verification/README.md)"
elif [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  blocked="SUPABASE_SERVICE_ROLE_KEY is not set"
elif ! curl -sf -o /dev/null --max-time 10 "${APP_URL:-http://localhost:3000}/login"; then
  blocked="no dev server answering on ${APP_URL:-http://localhost:3000}"
elif ! curl -sf -o /dev/null --max-time 5 "${MAILPIT_URL:-http://127.0.0.1:54324}"; then
  blocked="no mail catcher answering on ${MAILPIT_URL:-http://127.0.0.1:54324}"
fi
if [[ -n "$blocked" ]]; then
  echo "BROWSER SUITES NOT RUN -- $blocked. No browser evidence was produced." >&2
  exit 3
fi

has_result() { grep -q "^$1	" "$RESULTS"; }

# ---------------------------------------------------------------------------------------------------------
# A LOANED PASSWORD, ALWAYS GIVEN BACK (opt-in: LEASE_PERSONAS="a@ovalball.test b@ovalball.test").
#
# The suites sign the persistent uat.* personas in with the shared UAT_BROWSER_PASSWORD. A persona whose
# password has been changed by a person -- uat.team.manager was reset through recovery on 2026-10-02 --
# cannot be signed in, and its owner may rely on the password it has now, so it is never overwritten for
# good. Named here, such a persona is lent the shared password for this run only: its stored hash is saved
# to a mode-600 file in the run directory, the shared password is set, and on exit (or on the next start,
# if this run was killed) the saved hash is written back, compared, and the file deleted. Nothing is
# printed but the address. A persona that already has the shared password is left alone.
# ---------------------------------------------------------------------------------------------------------
CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_ovalball-saas-startup}"
LEASE_FILE="$RUN_DIR/.persona-lease"
db() { docker exec -i "$CONTAINER" psql -U postgres -d postgres -Atq -v ON_ERROR_STOP=1; }
sq() { printf "%s" "$1" | sed "s/'/''/g"; }

lease_return() {
  [[ -f "$LEASE_FILE" ]] || return 0
  local all_back=1 email hash matched
  while IFS='	' read -r email hash; do
    [[ -z "$email" ]] && continue
    matched=$(printf "update auth.users set encrypted_password = '%s' where email = '%s';
select (encrypted_password = '%s')::text from auth.users where email = '%s';\n" \
      "$(sq "$hash")" "$(sq "$email")" "$(sq "$hash")" "$(sq "$email")" | db 2>/dev/null | tail -1)
    if [[ "$matched" == "true" ]]; then
      echo "  password lease returned: $email (its own password is back, checked)"
    else
      echo "  PASSWORD LEASE NOT RETURNED for $email -- the saved hash is still in $LEASE_FILE" >&2
      all_back=0
    fi
  done <"$LEASE_FILE"
  if [[ $all_back -eq 1 ]]; then rm -f "$LEASE_FILE"; fi
  [[ $all_back -eq 1 ]]
}

lease_take() {
  local email shared matches hash
  shared="${UAT_BROWSER_PASSWORD:-}"
  if [[ -z "$shared" ]]; then
    echo "LEASE_PERSONAS is set but UAT_BROWSER_PASSWORD is not." >&2
    return 1
  fi
  for email in $LEASE_PERSONAS; do
    matches=$(printf "select coalesce((select (encrypted_password = extensions.crypt('%s', encrypted_password))::text from auth.users where email = '%s'), 'missing');\n" \
      "$(sq "$shared")" "$(sq "$email")" | db 2>/dev/null | tail -1)
    if [[ "$matches" == "true" ]]; then
      echo "  password lease not needed: $email already has the shared password"
      continue
    fi
    if [[ "$matches" != "false" ]]; then
      echo "  password lease refused: $email is not a local account" >&2
      return 1
    fi
    hash=$(printf "select encrypted_password from auth.users where email = '%s';\n" "$(sq "$email")" | db 2>/dev/null | tail -1)
    if [[ -z "$hash" ]]; then
      echo "  password lease refused: could not read the stored password of $email" >&2
      return 1
    fi
    (umask 077; printf "%s\t%s\n" "$email" "$hash" >>"$LEASE_FILE")
    printf "update auth.users set encrypted_password = extensions.crypt('%s', extensions.gen_salt('bf', 10)) where email = '%s';\n" \
      "$(sq "$shared")" "$(sq "$email")" | db >/dev/null 2>&1
    echo "  password lease taken: $email (its own password is saved and comes back when this run ends)"
  done
}

if [[ -f "$LEASE_FILE" ]]; then
  echo "A previous run ended without giving a password back; returning it first."
  lease_return || exit 4
fi
if [[ -n "${LEASE_PERSONAS:-}" ]]; then
  if [[ -z "${UAT_BROWSER_PASSWORD:-}" && -f "$ROOT/.env.local" ]]; then
    UAT_BROWSER_PASSWORD=$(sed -n 's/^UAT_BROWSER_PASSWORD=//p' "$ROOT/.env.local" | head -1)
  fi
  trap 'lease_return' EXIT
  trap 'exit 130' INT TERM
  lease_take || exit 4
fi

# Runs the suite with a ceiling on how long it may take. Prints nothing; the exit status is the suite's,
# or 124 when the ceiling stopped it (TERM first, then KILL), which classify_suite_outcome reads as CRASH.
run_suite() {
  local suite="$1" log="$2" pid watcher status
  ( cd "$ROOT" && exec node "$BV_DIR/$suite.mjs" ) >"$log" 2>&1 &
  pid=$!
  (
    sleep "$SUITE_TIMEOUT"
    if kill -0 "$pid" 2>/dev/null; then
      echo "TIMEOUT -- still running after ${SUITE_TIMEOUT}s; stopped by run-resumable.sh" >>"$log"
      touch "$log.timeout"
      kill -TERM "$pid" 2>/dev/null
      sleep 5
      kill -KILL "$pid" 2>/dev/null
    fi
  ) 2>/dev/null &
  watcher=$!
  # Not this shell's job any more, so stopping it below is not reported as a job that was "Terminated".
  disown "$watcher" 2>/dev/null
  wait "$pid"
  status=$?
  pkill -P "$watcher" 2>/dev/null
  kill "$watcher" 2>/dev/null
  if [[ -e "$log.timeout" ]]; then
    rm -f "$log.timeout"
    return 124
  fi
  return "$status"
}

for suite in "${suites[@]}"; do
  if [[ ! -f "$BV_DIR/$suite.mjs" ]]; then
    printf '%s\tMISSING\t0\t0\t-\t0\n' "$suite" >>"$RESULTS"
    printf '  MISSING %s (no such suite file)\n' "$suite"
    continue
  fi
  if has_result "$suite"; then
    if [[ "${RERUN:-0}" == "1" || "$named" == "1" ]]; then
      grep -v "^$suite	" "$RESULTS" >"$RESULTS.tmp" || true
      mv "$RESULTS.tmp" "$RESULTS"
    else
      continue
    fi
  fi

  log="$RUN_DIR/$suite.log"
  started=$(date +%s)
  run_suite "$suite" "$log"
  status=$?
  seconds=$(( $(date +%s) - started ))
  passes=$(grep -c '^PASS' "$log")
  failures=$(grep -c '^FAIL' "$log")

  # A CRASH IN SUITE N MUST NOT POISON SUITE N+1 (the gate's own rule): an orphaned browser from a killed
  # suite is this harness's browser build, never a browser a person is using. ORPHANED ONLY -- a harness
  # browser whose parent has gone (re-parented to launchd, ppid 1). A browser some other run still owns is
  # left alone: killing every Playwright browser here used to crash any suite running alongside this one.
  # The MAIN browser binary only: on macOS Chromium double-forks chrome_crashpad_handler, so a LIVE browser's
  # crash handlers always have parent PID 1 -- matching them killed every running browser's handlers.
  orphans=$(ps -axo pid=,ppid=,command= 2>/dev/null \
    | awk '$2 == 1 && /ms-playwright/ && !/crashpad/ && (/Contents\/MacOS\/Chromium( |$)/ || /headless_shell( |$)/ || /chrome-linux\/chrome( |$)/) { print $1 }')
  if [[ -n "$orphans" ]]; then
    for orphan in $orphans; do
      pkill -P "$orphan" 2>/dev/null || true
      kill "$orphan" 2>/dev/null || true
    done
    sleep 1
  fi

  outcome=$(classify_suite_outcome "$status" "$passes" "$failures")
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$suite" "$outcome" "$passes" "$failures" "$status" "$seconds" >>"$RESULTS"
  printf '  %-5s %-44s %s passed, %s failed (exit %s, %ss)\n' "$outcome" "$suite" "$passes" "$failures" "$status" "$seconds"
  if suite_outcome_is_failure "$outcome"; then
    grep '^FAIL' "$log" | head -8 | sed 's/^/          /'
  fi
done

# THE VERDICT: every suite asked for has a result, and every result is ok.
ok=0; not_ok=0; missing=0
for suite in "${suites[@]}"; do
  line=$(grep "^$suite	" "$RESULTS" | tail -1)
  if [[ -z "$line" ]]; then
    missing=$((missing + 1))
    continue
  fi
  outcome=$(cut -f2 <<<"$line")
  if suite_outcome_is_failure "$outcome"; then not_ok=$((not_ok + 1)); else ok=$((ok + 1)); fi
done
echo
echo "VERDICT: $([[ $not_ok -eq 0 && $missing -eq 0 ]] && echo PASS || echo FAIL) -- $ok ok, $not_ok not ok, $missing without a result, of ${#suites[@]} suites. Results: $RESULTS"
[[ $not_ok -eq 0 && $missing -eq 0 ]]
