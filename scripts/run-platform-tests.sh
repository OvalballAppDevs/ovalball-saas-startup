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

if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-authority-guards.mjs"; then
  exit 1
fi

# The content standard: one spelling per destination, protected acronyms, and
# Title Case on navigation labels and page metadata. Deliberately not a lint
# rule over English prose -- see CLAUDE.md.
if ! node "$(dirname "${BASH_SOURCE[0]}")/verify-content-standard.mjs"; then
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
  email_template_registry
  email_brand_assets
  recipient_audience_engine
  email_delivery_policy
  calendar_match_centre_link
  add_child_flow
  guardian_link_requests
  player_avatars
  fixture_meet_time
  match_centre_core
  fixture_communications
  fixture_attendance_invitations
  fixture_message_moderation
  regulatory_coverage
  union_girls_dual_age_bands
  rugby_code_girls_identities
  league_age_grade_and_colts
  season_handover_progression
  player_age_resolver
  handover_player_placement
  handover_apply_idempotency
  handover_staged_commit_model
  person_name_normalisation
  canonical_team_directory_propagation
  rugby_code_isolation
  training_centre_visibility
  training_communication
  club_event_foundation
  tournament_centre
  canonical_recipient_safeguarding
  notification_catalogue
  unread_truth
  announcement_privacy
  message_communication_policy
  audience_resolution
  announcement_fanout
  announcement_replies
  team_conversation_activation
  announcement_unread_surfaces
  announcement_recipient_picker
  personal_block_product
  direct_messaging_security
  adult_messaging_age_fallback
  fixture_opposition_contacts
  communication_policy_authority
  conversation_channel_authority
  fixture_management_authority
  fixture_bulk_planning_authority
  fixture_publish_asks_ovalball_clubs
  competition_matches
  competition_creator_conformance
  fixture_editor_authority
  competition_authority_matrix
  venue_training_authority_matrix
  messaging_authority_matrix
  safeguarding_authority_matrix
  club_admin_authority_matrix
  club_misc_authority_matrix
  age_eligibility_matrix
  invitation_authority_matrix
  invitation_team_list
  aal_enforcement
  recovery_codes
  # Slice 6b.1: both ends of the password reset journey leave a mark, and asking
  # for one never reveals who has an account.
  password_reset_journey
  # Slice 6b.2: Phase 2 D.2 enforcement layer 2, driven through every state a real
  # session can be in -- including the one that must NOT refuse, T0 with AAL1.
  session_boundary
  definer_rpc_session_contract
  email_delivery_result_authority
  users_and_permissions_authority
  invitation_joining_closure
  auth_flow_state_authority
  club_claim_authority_matrix
  fixture_staging_fidelity
  notification_mandatory_and_preferences
  hub_content_schema
  hub_content_applicability
  hub_content_relationships
  hub_content_rls
  hub_search_and_recommendations
  hub_game_knowledge
  hub_glossary_explorer
  hub_officiating
  hub_rules_law_of_the_game
  hub_teams_competitions
  hub_international_rugby
  hub_people_and_legends
  hub_famous_clubs
  hub_player_development
  hub_coaching_knowledge
  hub_parents_and_guardians
  scheduling_buffer_fallback
  team_people_roster
  registration_allocation
  adult_player_self_registration
  handover_prepare_idempotency
  handover_squads_and_aliases
  graduation_placement_safety
  fixture_season_identity
  mini_rugby_handover
  handover_security_matrix
  handover_automation_and_privacy
  union_u18_free_agent
  master_site_admin_authority
  fixture_cohort_isolation
  season_source_of_truth
  rollover_player_placement
  handover_successor_teams
  player_playing_pathway
  pathway_allocation_safety

  # Release portability. Three migrations used to assert against the season
  # register and one group used to install pg_cron unconditionally, so neither
  # could be installed into a database that had no seasons yet or was not the
  # cluster's cron database. Those migrations now stand aside in exactly those
  # two cases -- and these two suites are what stops "stands aside" quietly
  # becoming "is never checked".
  season_register_boot_invariants
  pg_cron_portability

  # Production hygiene. Two Hub migrations minted themselves an author on a
  # test domain in every environment including production, and two finance
  # functions carried PostgreSQL's default PUBLIC EXECUTE grant. The forward
  # fixes are 20270301000000 and 20270302000000; this holds both, and in
  # particular proves the auth.users cleanup guard stays narrow.
  production_hygiene_scaffold_and_finance

  # Identity and authorisation containment. Each check runs a direct attack as
  # the real database role -- anonymous, a member, staff, a parent, the server
  # -- and the perimeter guard stops a later migration quietly reopening a
  # grant, an unconditional write policy or an anonymous definer function.
  identity_security_containment
  security_perimeter_guard

  # Club Digital Home: club and team news, announcements, Welcome to Ovalball.
  club_digital_home

  # Identity/Auth Slice 1: every auth identity has exactly one profile, and the
  # database/API perimeter is explicit. The matching drift guard is
  # js/perimeter_manifest.test.mts, which compares the live grants with
  # supabase/security/perimeter-manifest.json.
  identity_foundation_and_perimeter
  # audit_log and security_events are append-only, server-attributed and
  # redacted; identity changes emit their security events.
  audit_immutability
  security_events_no_secrets
  # The signed-out Club Digital Home names each fixture's team as it is in
  # that fixture's season, through a public projection scoped to public
  # fixtures, without widening teams.
  public_team_season_identity
  # Identity/Auth Slice 2: canonical memberships, roles, family relationships
  # and team places are state machines with provenance; every transition is a
  # checked function with its event, and nothing removed comes back. The race
  # outcomes are js/membership_races.test.mts.
  membership_state_machine
  role_assignment_state_machine
  role_assignment_ceilings
  minor_prohibitions
  family_relationship_state_machine
  guardian_additional_requires_acceptance
  backfill_verification
  # Identity/Auth Slice 3: one capability catalogue, one resolver with the
  # Phase 2 K precedence, explicit Site Admin profiles, levelled allows and
  # withholds, and the adapters over them. The concurrent R19 outcome is
  # js/capability_override_races.test.mts.
  capability_catalogue_integrity
  capability_precedence_truth_table
  explain_access_matches_enforcement
  bundle_legacy_parity
  site_admin_profile_matrix
  capability_scope_isolation
  capability_override_ceilings
  capability_adapters
  capability_attack_matrix
  family_authority_matrix
  family_isolation_matrix
  cross_club_isolation_matrix
  roster_authority_matrix
  authority_helper_retirement
  site_master_control
  # Slice 7c: a Site Admin grant takes two people by every route, and the last
  # Full Site Admin cannot be revoked, deleted or quietly demoted.
  site_admin_grant_and_lockout
  # Slice 7e: the closure -- AB.3's search exists and authorises first, the roster
  # a Site Admin can change is one it can read without widening the policy, and
  # is_site_admin is retired including where the counting guards do not look.
  site_admin_users_access_closure
  # Convergence Step 6: a fixture's pitch must be at the fixture's ground (the rule
  # training already had), a venue address has exactly one writer, and L17 -- a
  # session is not authority over every club's private directory columns.
  club_venue_pitch_integrity
  club_directory_privacy
  # Slice 7, AI #36/#37/#41: the master-control surface is discovered from the
  # catalogue, so an RPC added later without the preamble fails this by default.
  site_admin_profile_matrix
  # Convergence Step 7: how many have answered, counted only over the squads the
  # caller may actually read -- and ABSENT, never zero, where they may not; and
  # Fixture Search privacy plus the venue/pitch writers' refusals, asked of the
  # functions themselves rather than of the screen that usually calls them.
  fixture_availability_summary
  fixture_search_and_venue_authority
  # Convergence Step 8: the server side of operational access management --
  # one spelling for one role, presets as exact capability deltas, removing one
  # role leaving the rest standing, suspension defeating a grant that still
  # exists, the club timeline's scope, and a Site Admin who administers a club
  # without becoming a member of it.
  step8_operational_access
  # Convergence Step 9: who may answer availability and who may not, one truth
  # per player and fixture, the adult boundary proved AT the boundary with a
  # supplied date, an adult ending a Guardian's access without anything else
  # moving, family IDOR in both directions, and a family relationship conferring
  # no club, team or fixture authority.
  step9_family_and_availability
  # Convergence Step 10: what a person is to a team, as a list rather than one
  # invented primary role; a badge that cannot outlive a revoked role or a
  # suspended membership; team IDOR in both directions; team staff who do not
  # become club administrators; and a Site Admin who inspects without joining.
  step10_team_experience
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
