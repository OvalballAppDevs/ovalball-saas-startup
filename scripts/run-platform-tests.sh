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

# CA-M11.2 incidental fix, out of this slice's own scope: FAILED was read at
# `FAILED=$((FAILED + 1))` below without ever being initialised, so `set -u`
# made the FIRST such increment a hard, silent exit before a single SQL suite
# ran -- discovered only because this slice needed a genuine whole-gate run
# for its own acceptance evidence. Purely mechanical; no suite's pass/fail
# semantics change.
FAILED=0

# Repository-level guard: the ONE CANONICAL TEAM DIRECTORY invariant. Runs
# before the SQL suites because a second hardcoded catalogue is an
# architectural regression, not a data one.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-one-team-catalogue.mjs"; then
  echo "  FAIL  one_canonical_team_directory"
  exit 1
fi

# Identity/Auth Slice 4 (Phase 2 AA.5): authority role literals stay within their shrink list outside
# lib/auth/**, and a browser-session client writes a table only where the perimeter manifest lists it.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-legacy-invitation-token-readers.mjs"; then
  FAILED=$((FAILED + 1))
fi

if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-redemption-callers.mjs"; then
  FAILED=$((FAILED + 1))
fi

# Identity/Auth Slice 10 (Convergence Step 17): the compatibility estate is a ratchet. Every reference
# count may fall and none may rise, and no browser role may reach a plaintext legacy invitation secret.
# Slice 10's own acceptance is "zero references in CI" -- this is what measures it.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-slice10-retirement.mjs"; then
  FAILED=$((FAILED + 1))
fi

if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-authority-guards.mjs"; then
  exit 1
fi

# The content standard: one spelling per destination, protected acronyms, and
# Title Case on navigation labels and page metadata. Deliberately not a lint
# rule over English prose -- see CLAUDE.md.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-content-standard.mjs"; then
  exit 1
fi

# A club is never represented by its kit, and a person is never represented by a
# club's mark. Added by the owner-directed Team Operations correction, which
# found the Club Desk hero showing a shirt illustration for a club with no crest.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-identity-presentation.mjs"; then
  exit 1
fi

# Every post-authentication redirect target goes through one validator. Added at
# Convergence Step 19, which found a third consumer reading `next` straight off
# the query string into window.location.assign on the MFA continuation -- the
# same open redirect Slice 5 had already fixed on the password path.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-redirect-targets.mjs"; then
  exit 1
fi

# Match Centre is one shared role-aware surface. See the script's own header
# for why this is structural rather than a visual snapshot.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-match-centre-shared.mjs"; then
  exit 1
fi

# Training Centre carries the same invariant, for the same reason.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-training-centre-shared.mjs"; then
  exit 1
fi

# AVAILABILITY IS ONE PRODUCT. The two guards above keep Match Centre and
# Training Centre each to one implementation; this one keeps the QUESTION they
# both ask to one vocabulary, across both clients. Availability is described on
# at least six surfaces twice over -- once per client -- and every one of them is
# a place somebody can write "Can't make it" while the others say "Can't attend".
# It has happened repeatedly: the register words drifted three ways before
# lib/attendance/vocabulary.ts existed, the Agenda's own control then grew a
# second set of ANSWER words ("Can Attend / Can't Attend / Maybe") beside the
# shared control's, and the mobile agenda row a third ("Going / Can't go"). Each
# file was internally consistent, which is why none of it was noticed. This also
# asserts that both clients write through the canonical mutations and that the
# shared contract imports no renderer.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-availability-one-product.mjs"; then
  exit 1
fi

# MOBILE MESSENGER SCOPE. The attach menu is Club Documents, Take Photo, Choose
# Photo and Contact Card -- a standing product decision, not an unfinished list.
# Guarded structurally because both excluded features are the kind a later session
# would restore on reasonable-sounding grounds: "the platform accepts PDFs anyway",
# or "an entry point that explains itself is friendlier than none". It checks the
# shipped action union, the rendered labels, the dependency list and the routes.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-mobile-messenger-scope.mjs"; then
  exit 1
fi

# FIXTURE CONSOLE SCOPE. One console with inline editing -- no availability strip (it belongs to Match
# Centre), no Club Documents projection (it belongs to the Club Documents product), no separate Edit
# destination, and Cancel at the bottom in the danger tone. Guarded structurally because each removal
# is one a later session would undo on reasonable-sounding grounds: "just a small availability
# summary", "the visitor guide is obviously relevant here".
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-fixture-console-scope.mjs"; then
  exit 1
fi

# SQL SUITE GOVERNANCE. Every .sql suite in supabase/tests must be declared in
# suite-registry.json with a disposition and an owner, this runner must derive its
# gate list from that one source, and no suite may be registered twice. Batch A
# found the old hand-maintained array listing one suite twice; this is what stops
# the second one.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-sql-suite-registry.mjs"; then
  exit 1
fi

# A permanent browser suite cannot exist outside this file's BROWSER_SUITES
# without a written declaration, and no suite may resolve axe-core or any
# absolute path for itself. Step 7 found twenty-seven suites nobody was
# running; this is what stops the twenty-eighth.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-browser-suite-registry.mjs"; then
  exit 1
fi

# Event Centre is the third of the same family, and carries the same rule --
# plus the one-row-per-event property its whole span model rests on.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-event-centre-shared.mjs"; then
  exit 1
fi

# Two fixture authorities on purpose: single-fixture team authority (Calendar,
# Request a Fixture) and club/site bulk planning authority (Season Planner,
# Import, Competition Creator). Team staff never reach bulk tools, and opening a
# planner cell is never a request. See the script's own header.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-fixture-bulk-authority.mjs"; then
  exit 1
fi

# Pitch Allocation is one shared scheduling surface, with ONE occupancy
# calculation. The duplication this guards against had already happened five
# times over before it was written.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-pitch-allocation-shared.mjs"; then
  exit 1
fi

# Tournament Centre is the fourth of the family, and carries three more
# invariants of its own: one canonical tournament model (never a club_event,
# never one fixture per festival game), opponents that belong to a TEAM's
# participation rather than to a flat list on the parent, and a
# same-tournament overlap exception scoped by parent identity alone.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-tournament-centre-shared.mjs"; then
  exit 1
fi

# Rugby Hub general knowledge: Training Centre/Training Knowledge stay
# separate, general content cannot escape-hatch around regulatory
# provenance controls, one applicability architecture, published-only RLS
# by default, no role-branched Hub implementation. See the script's own
# header.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-hub-content-architecture.mjs"; then
  exit 1
fi

# The email catalogue, its editable contracts and its wiring must agree. See
# the script's own header for the quiet failure this exists to catch.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-email-wiring.mjs"; then
  exit 1
fi

# No direct player-email shortcut, and no second copy of the guardian/consent
# eligibility predicate. See the script's own header.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-recipient-audience-boundary.mjs"; then
  exit 1
fi

# One Dynamic Data catalogue, every contracted variable and structured block
# resolves to a registered key. See the script's own header.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-dynamic-data-catalogue.mjs"; then
  exit 1
fi

# The on/off switch stays wired: the dead template.enabled column is not
# resurrected, the send boundary checks policy before recipient resolution,
# and usage stays set-based from the ledger. See the script's own header.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-email-delivery-policy.mjs"; then
  exit 1
fi

# One canonical message/notification store, server-issued ids, email/in-app
# channel independence, stable notification destinations. Audit-as-code for
# the existing Main Project Messenger/Notifications architecture -- SP4
# does not modify these files, only pins what the audit found true. See the
# script's own header.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-messenger-notifications-architecture.mjs"; then
  exit 1
fi

# Every emitted notification type is registered, every registered type has a
# destination, and every destination is exercised by the deep-link matrix.
# The database's foreign key holds the first of those at runtime; this holds
# all three at build time, and reads the emitters the hand audit could not --
# the ones whose type is assembled in a variable or handed to a fan-out helper
# as a parameter. It found two live paths the audit missed. See the script's
# own header.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-notification-catalogue.mjs"; then
  exit 1
fi

# Club Digital Home: one theme engine fed by the home kit, one article
# renderer and no HTML, authority consumed through the capability adapters
# rather than role strings, and no private fixture fields in a public loader.
# See the script's own header.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-club-digital-home.mjs"; then
  exit 1
fi

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_ovalball-saas-startup}"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../supabase/tests" && pwd)"

# ---------------------------------------------------------------------------
# THE GATE LIST IS DERIVED, NEVER RETYPED.
#
# It used to be a hand-maintained array here, and Batch A found it listing
# `site_admin_profile_matrix` TWICE -- running that suite twice and counting its
# assertions twice, in the total acceptance rests on. The declaration now lives in
# supabase/tests/suite-registry.json, where every SQL suite in the repository has a
# disposition and an owner, and a JSON object cannot hold the same key twice.
#
# scripts/verify-sql-suite-registry.mjs fails this gate if a suite file is
# undeclared, a declared path has gone, a disposition is invalid, or this runner
# stops deriving its list from that one source.
# ---------------------------------------------------------------------------
SUITE_REGISTRY="$(cd "$(dirname "${BASH_SOURCE[0]}")/../supabase/tests" && pwd)/suite-registry.json"
# Read into the array with a portable loop: `mapfile` is bash 4+, and this repository is developed on
# a machine whose /bin/bash is 3.2. A gate that cannot start is worse than a gate with a hand list.
SUITES=()
while IFS= read -r suite_name; do
  [ -n "$suite_name" ] && SUITES+=("$suite_name")
done < <(node -e '
  const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const names = Object.entries(r.suites)
    .filter(([, e]) => e.disposition === "CANONICAL_GATE")
    .map(([n]) => n)
    .sort();
  process.stdout.write(names.join("\n") + "\n");
' "$SUITE_REGISTRY")

if [ "${#SUITES[@]}" -eq 0 ]; then
  echo "The suite registry yielded no CANONICAL_GATE suites -- refusing to report a green gate over nothing." >&2
  exit 1
fi

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

# ---------------------------------------------------------------------------
# Identity/Auth browser journeys.
#
# SLICE 6b: a login page cannot be accepted by SQL and TypeScript alone. The
# production incident that opened this slice -- an owner locked out by a
# boolean that outlived the token it stood for -- was invisible to every
# assertion in this file, because it lived in a React component's state
# between two clicks. The suites below are the only evidence of that class of
# defect, so they belong to the release runner rather than to somebody's
# memory of having run them once.
#
# They need things this script otherwise does not: a dev server, the local
# mail catcher, a service-role key and a linked playwright-core (which is
# deliberately not a project dependency -- see the suites' README). When any
# of that is absent the journeys are NOT RUN and say so loudly; they are
# never quietly skipped and never counted as passing. A release claim that
# rests on them is only true if this section actually ran.
#
# SKIP_BROWSER_JOURNEYS=1 opts out for a fast inner-loop run. It still prints
# the notice, because the point is that nobody discovers afterwards that the
# browser evidence was never produced.
# ---------------------------------------------------------------------------
# Suite 66 drives no browser -- it speaks HTTP straight at GoTrue, PostgREST and a route handler --
# but it needs exactly the same live stack, so it is gated and reported here with the others.
BROWSER_SUITES=(
  # CONVERGENCE STEP 7 WIRED THE FIXTURE-OPERATIONS SUITES IN.
  #
  # Twenty-seven of them existed and not one was in this list, which began at
  # 62 -- so every fixture-operations browser claim in the programme rested on
  # somebody having run a suite by hand at some point. When Step 7 ran them,
  # twelve were failing: nine because they read records that had silently gone
  # from the automated UAT club, two because they asserted a Control Centre
  # column model that a redesign had replaced (while suite 19 asserted the
  # replacement, so two permanent tests disagreed about one screen), and one
  # because its cleanup died on an append-only table and left competitions
  # behind for the next suite to trip over. None of that was visible, because
  # nothing ran them.
  #
  # They are ordered as they are grouped below, and they run sequentially like
  # the rest: heavy infrastructure is never run concurrently with itself here.
  10-fixture-opposition
  14-training-cancellation
  15-fixture-planner
  16-planner-editing
  17-mass-planner-clipboard
  18-mass-planner-routes-in
  19-control-centre
  20-planner-persona-matrix
  # 21 and 28 assert no wall-clock threshold -- every timing line is recorded as
  # OBSERVED and always passes, so they cannot fail the gate for a busy machine.
  # What they still catch is a crash, and the runner flags a suite that records
  # nothing, which is the failure mode they are worth having for.
  21-planner-performance
  22-planner-lookups-and-routes
  23-fixture-ops-viewports
  26-planner-spreadsheet
  27-planner-shared-team-universe
  28-planner-grid-performance
  29-fixture-editor
  30-import-wizard
  31-competition-creator
  # Scale correctness rather than wall-clock: a competition with many
  # participants still generates the right matches.
  32-competition-scale
  33-knockout-draw
  34-planner-away-ground-request
  35-competition-match-editing
  36-public-competition
  37-competition-quick-create-isolation
  38-fixture-operations-accessibility
  53-fixture-authority
  54-competition-authority
  55-venue-training-authority
  # Step 7's own: the return path out of Match Centre, the period stepper,
  # match type, the availability summary, and the three end-to-end journeys.
  78-fixture-operations-journey
  79-match-community-journey
  80-safeguarding-age-grade-journey
  81-batch-a-integration-journey
  82-impersonation-journey
  83-governing-body-foundation
  84-governing-body-product-journey
  85-competition-governing-closure
  86-legacy-estate-unreachable
  87-shell-coherence
  88-entrance-journeys
  89-team-operations
  90-team-fixture-authority
  # SLICE 7e wired this one. It is Slice 7's own browser evidence -- S7-07 is what
  # the reconciliation cites for AN-8, "the setup link is never shown" -- and it
  # had never been in the release runner, so that evidence rested on somebody's
  # memory of having run it once. Convergence Step 5 changed the journey it walks
  # (Create User became AB.4's three steps, a person's record became AB.1's
  # thirteen tabs) and the suite caught both, which is the argument for wiring it.
  62-site-admin-master-control
  63-turnstile-login-recovery
  64-password-recovery-journey
  65-session-boundary-and-signup-challenge
  66-direct-invocation-boundary
  67-club-desk-hierarchy
  68-users-and-permissions
  69-invitations-and-joining
  70-production-csp
  71-recent-aal2-authority
  72-totp-enrolment-journey
  73-users-access-detail-tabs
  # Convergence Step 6: a venue address entered as structure in the real form,
  # read back from the canonical columns, at 1440 / 390 / 320.
  74-club-venue-and-address
  # Convergence Step 6 §52: the first-time club setup journey end to end, the
  # entry-authority matrix, resume, server-authoritative completion, 390 and 320.
  75-first-club-setup-journey
  # Convergence Step 6 §57: one canonical branding change, every surface that
  # displays the club identity, plus the fallback and the theme.
  76-branding-propagation
  # Convergence Step 6 §59: axe, keyboard, focus and semantics on every surface
  # this step materially changed, with pre-existing violations declared not hidden.
  77-step6-accessibility
  # CONVERGENCE STEP 8 / SLICE 8. The contract names browser 47 and 48 by
  # number: 47 is the Club People & Access lifecycle in a real browser, 48 is
  # the acceptance boundary -- "a Club Admin cannot reach site controls or other
  # clubs, directly or via UI; delegation ceilings proven". They are wired in
  # with the commit that writes them, which is what verify-browser-suite-registry
  # now enforces.
  47-club-people-and-access
  48-club-access-boundary
  # L25 DISPOSITIONS MADE BY STEP 8, for the three suites in its own domain
  # that its archaeology proved still describe the product. 58 and 59 were
  # green on the first run (30 and 48 assertions). 52 was green on its
  # assertions and its TEARDOWN was broken -- it died on a foreign key after
  # reporting success, the same shape Step 7 found in suite 37 -- so it was
  # fixed and now cleans up what it creates. The other six suites in this
  # domain are declared UNVERIFIED or SUPERSEDED with their measurements in
  # scripts/browser-verification/suite-registry.json; none was registered
  # without being run.
  # CONVERGENCE STEP 9. The family journey end to end: a parent answers on the
  # agenda row, the server's answer survives a reload, one child's answer is
  # independent of the other's, Match Centre is the same record, and the
  # operational availability summary a club reads moves because of it. That
  # last assertion is the Step 7 -> Step 9 integration proof.
  49-family-availability-journey
  # CONVERGENCE STEP 10. The team home as a place rather than a settings form:
  # a Team Manager sees what they are to the team and what is next, opens the
  # canonical fixture and comes back to THE TEAM, and cannot reach a mass
  # fixture tool from any of it; a guardian reaches the same team through their
  # child, is shown as a parent rather than as the player, and answers on the
  # team's own row into the same canonical record.
  50-team-home-journey
  52-roster-authority
  58-club-admin-authority
  59-club-misc-authority
)

browser_blocked=""
if [[ -n "${SKIP_BROWSER_JOURNEYS:-}" ]]; then
  browser_blocked="SKIP_BROWSER_JOURNEYS is set"
elif [[ ! -e "$(dirname "${BASH_SOURCE[0]}")/../node_modules/playwright-core" ]]; then
  browser_blocked="playwright-core is not linked into node_modules (see scripts/browser-verification/README.md)"
elif [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  browser_blocked="SUPABASE_SERVICE_ROLE_KEY is not set"
elif ! curl -sf -o /dev/null --max-time 10 "${APP_URL:-http://localhost:3000}/login"; then
  browser_blocked="no dev server answering on ${APP_URL:-http://localhost:3000}"
elif ! curl -sf -o /dev/null --max-time 5 "${MAILPIT_URL:-http://127.0.0.1:54324}"; then
  browser_blocked="no mail catcher answering on ${MAILPIT_URL:-http://127.0.0.1:54324}"
fi

echo
if [[ -n "$browser_blocked" ]]; then
  echo "  BROWSER JOURNEYS NOT RUN -- $browser_blocked"
  for b in "${BROWSER_SUITES[@]}"; do
    printf '        not run  %s\n' "$b"
  done
  echo "        No browser evidence was produced by this run. Do not report it as if there were."
else
  BV_DIR="$(dirname "${BASH_SOURCE[0]}")/browser-verification"
  # shellcheck source=browser-verification/suite-exit-truth.sh
  . "$BV_DIR/suite-exit-truth.sh"

  # RESOURCE PREFLIGHT.
  #
  # Step 7's gate was killed by the kernel three times and the output looked
  # like a gate that stopped for no reason. A reader could not tell an
  # application failure from a machine that had nothing left before the first
  # suite started. This states which one it is, in advance, and does NOT
  # refuse to run: a gate that silently declined would be worse.
  node -e '
    import("./scripts/browser-verification/resource.mjs").then((r) => {
      console.log(r.preflightReport())
    })
  ' || true

  for b in "${BROWSER_SUITES[@]}"; do
    b_output=$(node "$BV_DIR/$b.mjs" 2>&1)
    b_status=$?
    b_ok=$(grep -c '^PASS' <<<"$b_output")
    b_bad=$(grep -c '^FAIL' <<<"$b_output")
    total_pass=$((total_pass + b_ok))
    total_fail=$((total_fail + b_bad))

    # A CRASH IN SUITE N MUST NOT POISON SUITE N+1.
    #
    # Playwright kills its own browser when the node process exits cleanly,
    # but a suite killed by the kernel takes its browser's parent away without
    # taking the browser. One orphan holds hundreds of megabytes and makes the
    # NEXT suite look like the one with the problem, which is how a resource
    # fault gets reported as an application defect. Only this gate's own
    # browser build is ever touched -- never a browser a person is using.
    b_orphans=$(pgrep -f 'ms-playwright' 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$b_orphans" -gt 0 ]]; then
      pkill -f 'ms-playwright' 2>/dev/null || true
      sleep 1
    fi

    # WHAT HAPPENED IS DECIDED IN ONE PLACE, AND THE EXIT STATUS IS ASKED
    # FIRST. See scripts/browser-verification/suite-exit-truth.sh for why the
    # order matters; the short version is that `ok` must mean the process
    # exited zero, and it used not to.
    b_class=$(classify_suite_outcome "$b_status" "$b_ok" "$b_bad")

    case "$b_class" in
      KILL)
        # The kernel stopped it. Counting this as an assertion failure sends
        # somebody looking for a defect that does not exist, so it is named
        # and counted separately from FAIL -- but it still fails the gate.
        failed_suites+=("$b (OOM KILL -- the kernel stopped it; not a test result)")
        total_fail=$((total_fail + 1))
        printf '  KILL  %-34s OOM KILL after %s assertions -- the machine, not the product\n' "$b" "$b_ok"
        node -e '
          import("./scripts/browser-verification/resource.mjs").then((r) => {
            console.log("          " + r.formatResources(r.readResources()))
          })
        ' || true
        ;;
      FAIL)
        # The suite finished and said which assertions about the product were
        # false. Its own FAIL lines are already in total_fail.
        failed_suites+=("$b")
        printf '  FAIL  %-34s %s passed, %s failed\n' "$b" "$b_ok" "$b_bad"
        grep '^FAIL' <<<"$b_output" | head -12 | sed 's/^/          /'
        ;;
      CRASH)
        # Any other non-zero exit. The suite did not finish and did not say
        # why in its own assertions, whatever its pass count happened to be.
        failed_suites+=("$b (exited $b_status after $b_ok assertions without finishing)")
        total_fail=$((total_fail + 1))
        printf '  CRASH %-34s exited %s after %s assertions\n' "$b" "$b_status" "$b_ok"
        tail -6 <<<"$b_output" | sed 's/^/          /'
        ;;
      EMPTY)
        # Exited cleanly having proved nothing. Assertion accounting is an
        # ADDITIONAL invariant to exit status, not a replacement for it, and
        # this is the half exit status cannot see.
        failed_suites+=("$b (recorded no assertions)")
        total_fail=$((total_fail + 1))
        printf '  EMPTY %-34s exited 0 having recorded no assertions\n' "$b"
        ;;
      *)
        printf '  ok    %-34s %s passed\n' "$b" "$b_ok"
        grep '^NOTE' <<<"$b_output" | sed 's/^/          /'
        ;;
    esac

    if [[ -n "${BROWSER_RESOURCE_TRACE:-}" ]]; then
      node -e '
        import("./scripts/browser-verification/resource.mjs").then((r) => {
          console.log("          " + r.formatResources(r.readResources()))
        })
      ' || true
    fi
  done
fi

echo
if [[ ${#failed_suites[@]} -gt 0 ]]; then
  echo "$total_pass passed, $total_fail failed — ${failed_suites[*]}"
  exit 1
fi

echo "$total_pass passed, 0 failed across $(( ${#SUITES[@]} + js_suites )) suites."
