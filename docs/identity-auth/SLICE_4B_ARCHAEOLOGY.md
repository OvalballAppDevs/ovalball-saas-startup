# Slice 4B — Teams and Roster — Inventory (BEFORE state)

## Phase 2 AA.3 contract (verbatim, line 1848)
| 4b | Teams and roster | `team.view` club default, `can_manage_team` roster uses, `team_permissions` writes | `roster_authority_matrix.sql` |

Banked unit definition (AA.3 preamble): policies + RPCs + server actions + UI
capability reads + domain matrix green + legacy references for that domain gone
(PG-15/16 and authority_helper_retirement shrink).

## Capability keys (J.6 lines 418-429) — all ACTIVE in catalogue
team.team.view (C), team.team.manage, team.lifecycle.manage, team.roster.view (T),
team.roster.manage (T), team.join_request.review (T), team.join_code.manage (T),
team.attendance.view, team.handover.prepare, team.handover.apply,
team.graduation.place, team.mini_rugby_group.manage

Bundles already correctly seeded:
- team.team.view: CA,CO,FS,MB,PG,PL,SO,TM,VO   (FS included — names only)
- team.roster.view: CA(club),SO(club),CO(team),TM(team)  (FS ABSENT = AI #70)
- team.roster.manage: CA(club),TA(team),TM(team)
- team.view (legacy): NO bundle rows

## BEFORE numbers (canonical: authority_helper_retirement counting)
can_manage_team = 9 policies / 29 function bodies
PG15 = 140 policies; PG16 = 159 SECURITY DEFINER bodies
Retired at 4A and must stay 0: can_manage_player, may_complete_player_profile

## can_manage_team 9 policies — domain split
4B-owned (roster/team):
  public.player_team_memberships :: player_team_memberships_select
  public.team_season_identity    :: team_season_identity_select
Ambiguous (see OPEN-1):
  public.player_team_dispensation :: player_team_dispensation_select
4C (fixtures): fixture_player_call_up, fixture_requests x3, fixture_result_submissions
4F (messaging): team_conversations

## can_manage_team 29 function bodies — domain split
4C fixtures (11): caller_fixture_club_id, can_create_team_fixture,
  can_edit_fixture_details, can_manage_fixture_side, can_submit_fixture_result,
  accept_fixture_request, claim_external_fixture_result, list_restorable_fixtures,
  swap_fixture_home_away, update_fixture_opposition, update_fixture_owning_team
4D competitions (11): tournament_visible_row, check_tournament_participant_target,
  claim_tournament_host, create_tournament, get_tournament_centre,
  invite_tournament_participant, propose_tournament_at_host,
  reconcile_tournament_participant, remove_tournament_participant,
  respond_tournament_invitation, update_tournament_venue
4F messaging (4): can_access_conversation, can_access_fixture_conversation,
  can_send_team_conversation, can_view_team_conversation
4B-owned (3): internal.group_has_visible_request, internal.regulatory_context_for_team,
  internal.can_manage_player (DANGLING — see OPEN-2)

## Legacy `team.view` club default — located
`public.role_capability_defaults` rows at club scope:
  CLUB_ADMIN/team.view, CLUB_MEMBER/team.view, FIXTURE_SECRETARY/team.view
Table has ZERO real consumers (internal.has_capability does NOT read it; the only
textual hit, public.block_user_from_club_messages, is a stale COMMENT).
Live adapter is public.capability_key_map:
  team.view@club -> team.team.view@club ; team.view@team -> team.team.view@team
internal.may_view_club_member_content ALREADY uses canonical team.team.view.
role_capability_defaults is a Slice 10 drop target (Phase 2 line 2565).

## team_permissions
Compatibility VIEW over role_assignments (Y.7 line 1482) + INSTEAD OF trigger
`legacy_team_permission_write`. App has 14 references, ALL READS — zero
insert/update/delete/upsert. Base table retained as team_permissions_legacy.

## App-side 4B surface
Legacy capability call sites (3, all one file):
  app/(app)/teams/[teamId]/page.tsx:58  hasCapability "team.view" team
  app/(app)/teams/[teamId]/page.tsx:75  hasCapability "team.manage" team
  app/(app)/teams/[teamId]/page.tsx:76  hasCapability "club.teams.manage" club
Canonical team.* keys used in app: ZERO (all still go through legacy adapter)

Role-literal shrink list, team/roster files (13 of 78 tracked):
  people/actions.ts 3, people/invite-form.tsx 2, people/page.tsx 4,
  people/pending-invitation-row.tsx 2, people/person-row.tsx 2,
  teams/[teamId]/actions.ts 1, teams/[teamId]/page.tsx 4,
  teams/[teamId]/player-requests/page.tsx 1, teams/[teamId]/team-people.tsx 2,
  lib/app-context/my-teams.ts 2, lib/fixtures/fixture-team-authority.ts 4 (4C),
  lib/ovie/team-authorization.ts 1, lib/ovie/team-authorization.verify.ts 6

## RPCs named in J.6 that DO NOT EXIST yet (4B must build)
  add_player_to_team            (team.roster.manage)
  decide_player_team_membership (team.roster.manage)
  decide_team_join_request      (team.join_request.review)
  issue_team_join_code          (team.join_code.manage)
Existing: team_people, archive_player_team_membership, place_graduating_player

## Baselines banked pre-4B
verify-legal-routes: PRODUCTION 151/151 pass, 0 fail.
  LOCAL 134/17 — all 17 are the same `has no localhost link` check; the only
  localhost string is og:url metadata, which correctly IS localhost locally.
  Harness limitation, NOT a product defect. Not repaired (unrelated baseline).
verify-admin-nav:     25 pass / 1 fail "parent and player resolve to personal settings"
verify-auth-security: 63 pass / 1 fail "repeat submission is idempotent"
  Both reproduce identically at HEAD 909f5be = the 4A recorded baseline.
verify-authority-guards: ok
Protected logos (raw sha1, the convention the 4A report used):
  be2bef0c978869aaa73e474cd5abdf5aec1fff6c  Ovalball Square Logo.png
  bdd3224871f0561d971f93f519764f0502092504  Overball Logo Low Res.png
  (git blob sha1 differs: aca33ffc…, 1a4f1675… — same unchanged files)
Repo: HEAD = origin/main = 909f5be. Disk ledger 448 / 20270354000000.
Local DB 448 / 20270354000000 == production.

## OPEN QUESTIONS (resolve before coding)
OPEN-1 player_team_dispensation_select: AA.3 puts "dispensations" in 4g
  (Safeguarding and dispensations), but the policy is a can_manage_team roster
  use. Decide owner; default = leave to 4g, do not touch.
OPEN-2 internal.can_manage_player still EXISTS as a definition with 0 references
  (4A retired references, not the definition) and its BODY calls can_manage_team,
  so it contributes 1 to the 29. Dropping can_manage_team roster uses must
  account for it. Not a 4A reopen (step 9) — it is a can_manage_team consumer.
OPEN-3 4A avatar risk (instruction 8): does 4B make
  internal.can_view_account_avatar's "owner whose age cannot be established"
  state reachable? To determine.

---

# RESOLUTIONS

## OPEN-3 RESOLVED — instruction 8 answer is YES
internal.person_is_minor wraps its DOB comparison in coalesce(..., false), so an
account with no profiles.date_of_birth and no players.date_of_birth is classified
identically to an adult. Proven empirically on the local database at 448:

  person_is_minor(unknown-age) = f   (same as a 40-year-old)
  person_is_minor(12yo)        = t
  person_is_minor(40yo)        = f

internal.capability_decision rule 1 reads that predicate:
  if c.minor_prohibited and internal.person_is_minor(p_subject) -> MINOR_PROHIBITED

With TEAM_MANAGER (minor_prohibited) granted at a team, asking team.roster.manage
(minor_prohibited, safeguarding_sensitive):

  UNKNOWN-AGE as TEAM_MANAGER -> allowed=t rule=6 reason=ROLE_BUNDLE   <-- BYPASS
  MINOR-12yo  as TEAM_MANAGER -> allowed=f rule=1 reason=MINOR_PROHIBITED

Reachability is real, not theoretical: Phase 2 ID-5 (line 122) and the signup
form (line 1952) make Date of Birth OPTIONAL unless the person is a Player, so
every non-player account carries NULL DOB by default. Local: 26 of 30 profiles.
4B is the slice that assigns COACH / TEAM_MANAGER / TEAM_ADMINISTRATION, all
minor_prohibited, so 4B is what makes this reachable.

Other consumers of the same predicate: internal.grant_role,
public.transition_role_assignment, public.set_capability_override,
internal.apply_planned_team, and internal.can_view_account_avatar (the 4A risk).

## D-4b-1 (owner decision, this session) — "Prohibit new, flag existing"
- grant / transition / override of a minor-prohibited role or capability REFUSES
  when the subject's age cannot be established. Fail closed at the write path.
- internal.capability_decision rule 1 is NOT changed, so existing ACTIVE holders
  keep working and no Club Admin can be locked out of their own club.
- Existing unknown-age holders of a minor-prohibited role raise NEEDS_ATTENTION
  naming the missing Date of Birth, following the established Ovalball pattern
  (review_state READY / NEEDS_ATTENTION / BLOCKED, and the existing DOB_REQUIRED
  allocation_status in the rollover surface).
- internal.can_view_account_avatar stays on person_is_minor UNCHANGED, so
  D-S4-4 stays locked (adults = authenticated visibility; minors =
  relationship/authority-scoped) and 4A semantics are not reopened.
- Accepted gap, recorded by the owner: an existing unknown-age holder keeps
  authority until the Date of Birth is supplied.

## OPEN-1 RESOLVED — player_team_dispensation stays with 4g
AA.3 assigns "Safeguarding and dispensations" to 4g. player_team_dispensation_select
is left untouched by 4B and its can_manage_team reference is carried in the 4g
footprint, not the 4B one.

## OPEN-2 RESOLVED — internal.can_manage_player is a can_manage_team consumer
4A retired all REFERENCES to can_manage_player (0/0) but left the DEFINITION in
place, and that definition's body calls can_manage_team, contributing 1 of the 29.
Removing can_manage_team roster uses must account for it. This is not reopening
4A (step 9): it is a can_manage_team consumer and therefore 4B footprint.
