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
