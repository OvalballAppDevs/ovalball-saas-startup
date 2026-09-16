# Identity/Auth Slice 4 — contract extraction and plan

**Banked unit implemented: SLICE 4A — FAMILY / PLAYERS** (plus the cross-cutting Slice 4 harness). 4b–4i NOT STARTED. The Slice 4 programme is NOT COMPLETE. Verdicts in this document refer to Slice 4A only.

Source: `scratchpad/phase2/IDENTITY_AUTH_PHASE2_IMPLEMENTATION_DESIGN.md` (2,711 lines, read in full for the sections below).
Starting point: HEAD = origin/main = `b44aef0`; working tree = the two protected logos only (hashes `be2bef0c…`, `bdd32248…`); local migrations 445, tip `20270351000000`.

## 1. Exact title and objective (AK, Slice 4)

**"Slice 4 — Domain-by-domain authority migration."** It is NOT invitations/joining (that is Slice 5, AK "Unified invitations, codes, claims").

| AK field | Phase 2 text (verbatim intent) |
|---|---|
| Sub-slices | 4a family/players, 4b teams/roster, 4c fixtures/requests/results/Planner/Import, 4d competitions/tournaments, 4e calendar/venues/pitches/training, 4f messaging/notifications, 4g safeguarding/dispensations, 4h club admin/finance, 4i documents/partners/referrals/handover (AA.3) |
| Migrations | Per domain: replace policies and RPC guards with `can_*`; remove direct client writes (Z-5 shrink); retire the legacy helper references for that domain |
| Code | Domain server actions → `requireCapability` + single RPC; UI capability reads |
| Compatibility | Legacy helpers remain for untouched domains; AA.4 shadow comparison in tests |
| Tests | Domain matrix suites (AJ); `authority_helper_retirement` shrink; cross-club and family isolation matrices (complete after 4i) |
| Clean boot / UAT | Each sub-slice; domain browser suites + `51-role-negative-smoke` extended per domain |
| **Banking** | **One commit series and one production release per sub-slice** |
| **Release** | **Per sub-slice, in AA.3 order** |
| Rollback | Per sub-slice forward-fix; app rollback safe (policies stay stricter or equal, never looser) |
| Acceptance | Per domain: matrix green; zero legacy references in that domain; shadow mismatches equal only the intended-change list; production smoke per role identity |

AL.1 production order: `… 3 → 4a…4i → 5 → 6 (T0) → 7a …`. AL.2 expand/contract: every migration must work with the deployed app and the new app (else split A/B).

## 2. Work packages (AA.3 domain migration map) — each "one banked unit: policies + RPCs + server actions + UI capability reads + domain matrix green + legacy references for that domain gone"

| Sub-slice | Domain | Legacy removed (AA.3 / J.15) | Matrix test (AA.3 / AJ.1) | Other Phase 2 assignments |
|---|---|---|---|---|
| 4a | Family and players (highest risk) | `can_manage_player`, guardian branches of `is_site_admin` | `family_authority_matrix.sql` | AN-7 guardian safeguarding-hold UI (state exists since Slice 2); W boundary; Z-12 `avatars` private + signed URLs for players/minors (Slice 1 manifest exception "until Slice 4") |
| 4b | Teams and roster | `team.view` club default, `can_manage_team` roster uses, `team_permissions` writes | `roster_authority_matrix.sql` | AI #70 (FS cannot read rosters/family graph); Y.7 "the app's legacy writes [to team_permissions] are removed in Slice 4" |
| 4c | Fixtures, requests, results, Planner, Import | `can_manage_club_fixtures`, `can_manage_fixture_side`, direct fixture writes | extend `fixture_management_authority`, `fixture_bulk_planning_authority` | AN-11 (FS may not invite people); U boundary (FS team inheritance, rollover apply not available to FS) |
| 4d | Competitions and tournaments | `can_organise_competition` role checks, `calendar.manage` tournament use | `competition_authority_matrix.sql` | U boundary (FS competition keys) |
| 4e | Calendar, venues, pitches, training | role-string RPC checks, public training plans | `venue_training_authority_matrix.sql` | U "venues RLS/RPC mismatch" closure; V presets (pitch allocation / calendar) |
| 4f | Messaging and notifications | `staffs_team`, `is_messaging_staff`, Site Admin conversation read | `messaging_authority_matrix.sql` | T "Reports" (club SO queue + Ovalball moderation, one row per report) |
| 4g | Safeguarding and dispensations | per-officer override dependence, Site Admin thread read | extend `safeguarding_officer_security` | T appointment (CA nominates R → nominee redeems SO invitation → PENDING_CONFIRMATION → Site confirm `safeguarding.officer.confirm`); AN-6; AN-9 ("Reviewed by Ovalball"); AI #68, #69 (`site_safeguarding_review` RPC with reason + `safeguarding.thread_reviewed`); dispensation separation of duties; guardian mandatory notification of call-ups/dispensations; transitional `club.safeguarding.view/message` (Slice 3 kept at legacy parity "until 4g") |
| 4h | Club administration and finance | `is_club_admin` (24 policies) | `club_admin_authority_matrix.sql` | S boundary (incl. `club.reporting.export` with R and event) |
| 4i | Documents, partners, referrals, handover | `can_manage_document_library` role checks | `club_misc_authority_matrix.sql` | Z-12 `club-documents` delete policy (`club.documents.manage`); U (`team.handover.apply` not FS) |

Cross-cutting Slice 4 artefacts (AJ.1, AJ.3, AA.4, AA.5, Z.4):
- `cross_club_isolation_matrix.sql`, `family_isolation_matrix.sql` — generated over all CLUB/TEAM/FAMILY tables and read RPCs; "complete after 4i".
- `authority_helper_retirement.sql` — shrink test (legacy helper reference counts may only fall). J.15: "Slice 4 cannot remove a helper while a CI cross-reference test still finds a reference to it."
- AA.4 shadow comparison: `ovalball.authority_shadow = on` in the runner; `internal.can` also evaluates the legacy helper and records mismatches; each matrix asserts mismatches ⊆ its intended-changes table. Never enabled in production.
- AA.5 server-action standard: `requireSession()` first; one RPC per mutation; `scripts/verify-no-client-table-writes.mjs` (allow-list = manifest `client_write`); `scripts/verify-no-role-literals.mjs` shrink list (reaches 0 at Slice 10). AJ.2 Node suites `no_role_literals.test.mts`, `no_client_table_writes.test.mts` (slice not stated; required by the Slice 4 "remove direct client writes" work).
- AJ.1 domain-matrix definition: "every bundle role (CA, SO, FS, VO, MB, CO, TM, TA, PL, PG, anon, other-club CA, other-team CO, other parent, suspended user, AAL1) × every capability in the domain × direct table write + RPC".
- Browser `51-role-negative-smoke` (AJ.3): Volunteer, Team Manager, Fixtures Secretary, Safeguarding Officer, Parent A/B call server actions directly for out-of-bundle operations → refused; extended per domain.
- Perimeter: Z-5 (authenticated DML only manifest `client_write`), PG-15/16 shrink (policies / definer bodies referencing `is_site_admin`, `is_full_site_admin`, `is_club_admin`). Site-side `is_site_admin()` removal is Slice 7 (AA.3 last line).

Contract items not assigned to Slice 4 (for the boundary): AAL enforcement / `session_ok_required` RESTRICTIVE policy (Slice 6), invitations/codes/claims (5), master control + Users & Access + `is_site_admin` policy removal (7), People & Access + effective-access editing (8), impersonation (9), compatibility-column drops (10).

- Races assigned to Slice 4 (AH): none are Slice-4-specific by name; R19/R20 already exist. Domain RPCs that take locks keep Slice 2/3 lock order.
- Attacks assigned (AI): #68, #69 (4g), #70 (4b) plus Phase 1 #1–35 "updated to can()" per domain.
- Performance gates: K.5 (`capability_decision` p95 < 2 ms; list pages +15% max) applies to every policy moved to `can_*`.
- AAL: none enforced in Slice 4 (rule-0 hook stays); capability AAL metadata unchanged.
- Audit/events: existing catalogue covers 4a (`guardian.*`, `player_team.*`), 4g (`safeguarding.thread_reviewed`, `safeguarding.welfare_viewed`), 4h (`payment.refunded`, `export.generated`), 4c (`fixture.deleted`). No new event types are named for Slice 4.

## 3. Footprint (local = production for these objects; Slice 3 digest parity)

| Legacy reference | RLS policies | Function bodies |
|---|---|---|
| `has_capability` (Slice 3 wrapper) | 104 | 133 |
| `is_site_admin` | 134 | 163 |
| `can_manage_club_fixtures` (+ `_or_any_team`) | 22 | 57 |
| `is_full_site_admin` | 15 | 48 |
| `can_manage_team` | 9 | 29 |
| `is_club_admin` | 23 | 25 |
| `team_permissions` | – | 24 |
| `can_organise_edition` / `can_organise_competition` | 8 | 3 |
| `can_manage_document_library` | 6 | 2 |
| `can_manage_player` | 3 | 1 |
| `can_manage_fixture_side` | 3 | 6 |
| `staffs_team` | – | 3 |

Also: 68 function bodies with role-string literals; 220 public tables; 144 public write policies; 29 tables with authenticated DML. None of the cross-cutting Slice 4 artefacts exist yet (no shadow mode, no helper-retirement shrink test, no isolation matrices, no role-literal or client-write scripts, no browser suite 51).

## 4. Boundary classification of tempting adjacent work

| Item | Classification |
|---|---|
| Invitations, team codes, `/join`, signup entry, claim club | LATER — Slice 5 |
| Password / TOTP / MFA / AAL enforcement / social login | LATER — Slice 6 |
| Site Admin Users & Access, master control, `is_site_admin` policy removal | LATER — Slice 7 |
| People & Access, Effective Access editing, TA member picker | LATER — Slice 8 |
| Context switcher UX | LATER (no slice owns a new switcher; Slice 3 proved the model) |
| Impersonation | LATER — Slice 9 |
| Dropping compatibility columns/views, legacy helpers themselves | LATER — Slice 10 |
| Transitional `club.safeguarding.view/message` | SLICE 4 (4g) |
| `avatars` bucket private + signed URLs | SLICE 4 (Z-12; 4a by data) |
| Guardian safeguarding-hold UI (AN-7) | SLICE 4 (4a) |
| SO appointment with Site confirmation (AN-6) | SLICE 4 (4g) — but see conflict C2 |
| ZeptoMail rotation, second Full Site Admin, leaked-password protection, search_path, pg_trgm | UNRELATED / operational — carry forward |

## 5. Conflicts and decisions needed before coding

- **C1 — Banking/release granularity.** Phase 2 AK/AA.3 make each of 4a–4i "one banked unit" with "one commit series and one production release per sub-slice, in AA.3 order". The Slice 4 command asks for the whole of Slice 4 in one implementation cycle and one report, with no release. Building all nine locally before any is released is possible (separable migration series per sub-slice) but departs from the design's banking, stacks nine unreleased domains (each later sub-slice rehearsed only on top of unreleased earlier ones), and is by footprint larger than Slices 1–3 combined. Safest resolution: implement and verify **4a (family/players) plus the cross-cutting harness** as the first banked unit, release it, then proceed 4b… in order. Owner decision.
- **C2 — 4g depends on Slice 5.** T appointment step 2 ("nominee redeems the SAFEGUARDING_OFFICER invitation, email-bound") needs Slice 5's `access_invitations`, but AL.1 orders 4g before 5. Safest resolution: in 4g implement nomination → PENDING_CONFIRMATION → Site confirmation for an existing ACTIVE member, and defer the invitation redemption step to Slice 5 (recorded as an intra-design dependency, not redesign).
- **C3 — Production reality vs design (no material contradiction found yet).** Production has 1 club, 1 Club Admin (also the Full Site Admin and guardian of 2), no coaches/FS/SO/VO, no team permissions and no overrides, so domain migrations change no live authority other than the documented bypass removals. To be re-checked per sub-slice in its preflight.

## 6. Owner decisions (recorded before coding)

- **D-S4-1 (resolves C1).** This cycle implements **4a (family and players) plus the cross-cutting Slice 4 harness** as the first banked unit, reported and released on its own; 4b, 4c … follow in AA.3 order, each banked and released separately.
- **D-S4-2 (resolves C2), banked for 4g — not implemented now.** Keep 4g in AA.3 position before Slice 5.
  - **4G IMPLEMENTED (when reached):** Safeguarding appointment authority/state machine: nomination of an EXISTING ACTIVE club member only (server-proven; wrong club / PENDING / SUSPENDED / REVOKED / DECLINED / EXPIRED / non-member refused, non-member = INVITATION_REQUIRED; no membership manufactured); PENDING_CONFIRMATION confers zero SO / `club.safeguarding.*` / thread / dispensation / transfer / sensitive-notification authority; AN-6 confirmation through canonical site capabilities (no `is_site_admin()`), explicit, server-authorised, scope-bound, audited, race-safe; reviewed-by-Ovalball; thread transfer; `club.safeguarding.*` migration; one internal canonical nomination transition as the Slice 5 seam.
  - **SLICE 5 DEFERRED:** email-bound SAFEGUARDING_OFFICER invitation and redemption entry path, which must call the same 4g transition (no second state machine) and cannot bypass PENDING_CONFIRMATION, AN-6, minor prohibitions, account/membership state, scope binding or capability rules. External nominees fail closed until then.
  - 4g must not build a temporary invitation table, token, code, redemption RPC or email-binding mechanism.
  - 4g test contract (owner list, 19 items) and the Slice 5 end-to-end external-nominee acceptance test are banked.
  - 4g may be READY without Slice 5 only if the non-invitation contract is complete, external nominees fail closed, no temporary invitation architecture exists and the Slice 5 seam is proven.

## 7. 4a design (family and players) — traced to Phase 2

### 7.1 Scope of the domain (what 4a owns)
Tables: `players`, `guardians`, `guardian_link_requests`, `guardian_player_permissions`, `player_account_invitations`, `player_duplicate_reviews`, `guardian_invitations` (family authority only; issuance redesign is Slice 5), storage `player-avatars`, `avatars` (Z-12).
Not 4a (recorded for their sub-slice): `player_team_memberships` + roster reads (4b), `player_club_join_requests` (club.roster.manage → 4b), call-ups/dispensations (4c/4g), rollover/graduation (4i handover), `player_subscription_payers` / payer RPCs (4h), team conversations (4f), attendance (4c).

### 7.2 Capability mapping (J.6 keys; all already ACTIVE in the Slice 3 catalogue)
| Consumer (today) | Legacy authority | 4a authority |
|---|---|---|
| `players_select` | `is_site_admin`, own, `is_active_player_guardian`, `can_manage_player` | own/child via `can_player('player.profile.view')`; site via `has_site_capability('site.users.view')`; staff rows removed from the base table |
| staff player reads | `can_manage_player` → full row incl. DOB | `player_staff_view` (security_invoker view over a definer row function): `player.profile.view` at TE/CL of an ACTIVE team place, minimal columns, no DOB (age grade only) — J.6 |
| `guardians_select` | `is_site_admin`, own, `can_manage_player` | own; `family.relationship.approve` (CL/TE) or `family.relationship.remove` (CL) at the child's club/team; `site.family.manage` |
| `guardian_link_requests_select_approver`, `can_decide_guardian_link_request`, `approve_/reject_guardian_link_request`, `guardian_link_requests_for_approval` | `club.guardians.manage` (CA) **or an existing active guardian of the child** (FIRST_CHILD) | `family.relationship.approve`: CL, or TE of the matched child's team for FIRST_CHILD; ADDITIONAL_GUARDIAN CL only; requester never (N.1). Existing-guardian branch removed (intended change) |
| `remove_guardian_relationship`, `transition_guardian_relationship` REVOKED | `club.guardians.manage` at an arbitrary club of the child (`limit 1`), self, `is_full_site_admin` | self via `can_player('family.relationship.remove')` (child); CL `family.relationship.remove` at any club where the child holds an ACTIVE place (deterministic); `site.family.manage` |
| hold / lift hold | `is_full_site_admin` | `site.family.manage` + reason (AN-7: Site Admin, on request from the club's SO) + confidential flag |
| `set_guardian_player_permission`, `guardian_player_permissions` insert/select | active guardian (`status='active'`) | `family.permission.manage` (child); select: own, co-guardian of ACTIVE child, player self, `site.family.manage` |
| `get_player_permission_summary` | `is_site_admin`, guardian, self | `family.permission.manage` (child) or `player.profile.view` (self) or `site.family.manage` |
| `set_player_playing_pathway` | `may_complete_player_profile` (+ `is_full_site_admin` correction) | `player.profile.edit_protected` (self/child, set-once); correction of a recorded value: `site.users.identity.correct` (J.6 site master equivalent) |
| `request_player_playing_pathway` | `can_manage_player`, `is_site_admin` | `player.pathway.request` at TE/CL of the player's ACTIVE team place |
| `create_own_player_profile` | signed in | `player.self_register` (SELF) + adult age gate 18+ (J.6 "KEEP + age gate") |
| `add_child_for_guardian` | accepted invite / guardian at club / **active club member** | `family.child.add` (SELF): PG with an ACTIVE relationship at the club or an accepted guardian invitation at the club; relationship **PENDING_APPROVAL** unless invitation-sourced (J.6 NEW behaviour, N.1) with an approval queue entry |
| `create_player_for_guardian`, `link_guardian_to_existing_player` | accepted guardian invitation | unchanged binding (invitation-sourced → ACTIVE, N.1); capability `family.child.add` self |
| `request_child_link` / `request_additional_guardian` / `respond_to_additional_guardian_request` / `cancel_guardian_link_request` | signed in / active guardian | `family.relationship.request` (SELF / child) |
| `invite_player_account` | active guardian | `player.account.invite` (child); legacy table kept until Slice 5 |
| `accept_player_account_invitation` | Phase 0 email binding | `player.account.link` (SELF) + Phase 0 binding kept (Slice 5 replaces) |
| `resolve_player_duplicate_review_as_*`, `player_duplicate_reviews` select/update | `team.guardians.invite` (team or club) | `family.duplicate.resolve` (CL, CA); requester sees own review |
| `send_replacement_guardian_invitation`, `get_team_guardian_directory` | `club.guardians.manage`, `is_site_admin` | `family.relationship.approve` at CL (equal authority; issuance redesign is Slice 5); `site.family.manage` |
| `guardian_invitations` policies | `team.guardians.invite`, `is_site_admin` | `family.invitation.create` (TE inherits), inviter own, `site.invitations.manage` |
| `player_account_invitations` select | `is_site_admin`, guardian, inviter | `player.account.invite` (child), inviter own, `site.family.manage` |
| `can_access_player_avatar`, `set_player_avatar`, `player-avatars` storage | guardian, self, `club.guardians.manage` | view: `player.profile.view` (self/child/TE/CL); write: `player.profile.edit` (self/child) |

### 7.3 Harness (cross-cutting, built now and reused by 4b–4i)
H1 shadow comparison (AA.4, test-time only): matrix suites evaluate the retained legacy helper and the new wrapper for the same persona × resource and assert mismatches ⊆ an intended-changes table. H2 `authority_helper_retirement.sql` (frozen counts, may only fall; 4a domain objects at zero). H3 PG-15/16 shrink checks in `security_perimeter_guard`. H4 `family_isolation_matrix.sql` + `cross_club_isolation_matrix.sql` framework (family tables now). H5 `family_authority_matrix.sql` (AJ.1 persona list × J.6 keys × direct table write + RPC). H6 `scripts/verify-no-role-literals.mjs` (shrink) and `scripts/verify-no-client-table-writes.mjs` (manifest) + Node tests. H7 browser `51-role-negative-smoke` (Parent A/B and staff personas, family server actions) + 4a family journey.

### 7.4 Recorded deferrals inside 4a
- `requireSession()` (AA.5) does not exist; it carries AAL semantics (AJ.2 `require_session`, Slice 6). 4a server actions use `requireCapability` + one RPC.
- AAL1 persona in the matrix behaves as authenticated (rule-0 hook, D4 Slice 3).
- SO-requested hold routing and SO+CA joint hold: AN-7 resolves to Site Admin on request; the SO request channel belongs to 4g.
- Guardian invitation issuance/redemption redesign (`issue_invitation` GUARDIAN / PLAYER_ACCOUNT): Slice 5.
- Legacy helper functions are kept (zero 4a references) until Slice 10 drops them.

### 7.5 Open product questions (ask before implementing the affected parts)
- FR-6 adult child: "relationship rows confer only what the adult player's consent settings allow", but no adult consent types exist (all consent types end at 17).
- Z-12 visibility rule for private `avatars` (who may see an adult's / a minor's account avatar).

## 8. Owner decisions for 4a (recorded before coding)
- **D-S4-3 (FR-6).** From a player's 18th birthday, parent/guardian child-scope authority stops applying, decided at request time in the canonical decision function. Relationship rows and history stay. An adult-consent model to re-share access is a later product decision.
- **D-S4-4 (Z-12 avatars).** `avatars` becomes private with signed URLs. Any signed-in user may see an adult's account avatar; a minor's account avatar is visible only to the minor, their ACTIVE guardians and staff holding `player.profile.view` for them. Never public or anonymous.

## 9. 4a implementation decisions (recorded during coding)
- **D-4a-1 staff player projection.** J.6 routes staff player reads through `player_staff_view` (no date of birth, age grade only). Phase 2 U keeps the Phase 0 behaviour that "FS sees team lists through fixtures, not the family graph", while AI #70 denies the FS rosters and the family graph. The projection therefore shows a player (names, age grade, adult flag, picture paths; never date of birth, login id, recorded gender, contacts or guardians) to holders of `player.profile.view` at the player's team or club, or of the canonical keys that act on a named player in team operations (`fixture.callup.request`, `fixture.callup.approve`, `fixture.dispensation.request`, `team.graduation.place`, `team.handover.prepare`). Pending places and pending club join requests are shown to `team.roster.manage` / `team.join_request.review`. `site.users.view` sees all. The base `players` table serves only the player, their ACTIVE guardians and `site.users.view`. The family graph (`guardians`) stays with the family authorities.
- **D-4a-2 consumer shape.** PostgREST cannot embed a projection over a function, so staff surfaces that embedded `players(first_name, surname)` fetch the rows they list first, then names from `player_staff_view` by id (`lib/players/staff-players.ts`).
- **D-4a-3 release order (expand/contract, AL.2).** 20270352000000 (expand: RPC authority, FR-6, staff projection) → application release → 20270353000000 (policies) + 20270354000000 (private avatars). To be proven by the compatibility matrix.
- **D-4a-4 season gap.** `player_staff_view` shows no age grade (never an error) while the canonical season register has no season covering today. Found by the clean boot from empty; the previous shape made the whole staff projection raise "Season not found" between seasons. Guarded by FA1i and a mutant.
- **D-4a-5 replayed server actions.** The AJ.1 browser 51-role-negative-smoke captures each server action from the authorised UI and replays the exact request from refused sessions; a final authorised replay proves the request was valid.
- **D-4a-6 mutation-found tests.** FA14a–d added after four mutants survived: a Club Admin never decides their own added child; authority at another of my clubs never answers for this club's player; an adult player's guardian cannot change consent; a minor account cannot self-register with an adult date of birth.
- **D-4a-7 re-runnable expand.** `transition_guardian_relationship` is `create or replace` after dropping the three-argument form, so 352 re-applies cleanly in a rehearsal (each migration is one transaction either way).

## 10. Verification ledger (4a)
- Browser 46 family authority: 27/27 ×3. Browser 51 role-negative smoke: 12/12 ×3. Regression browser 19, 20, 24, 25, 27, 30, 31, 39, 40, 42, 43, 44, 45 all green.
- Clean boot from empty: 445 base 2836 passed / 41 seed-dependent failures; 448 working tree 3114 passed / the same 41, none new.
- Rehearsal (production-shaped): 352 → 353 → 354 one at a time, no errors, no data change, probes steady (rehearsal/stage-*.json).
- Mutation: 17/17 SQL mutants killed (round 1 13/17), 3/3 JS guard mutants killed.
- Preflight (read only): preflight-prod.json.
- **D-4a-8 list performance (K.5).** `player_staff_rows` decides once per team (materialised) rather than once per place; the players, consent, account-invitation and guardian-invitation policies order the cheap prefilter before the decision with CASE; `guardians_select` reads a once-per-query set `internal.administered_guardian_player_ids()`. Old-vs-new at 17 teams / 595 players (perf-5/6, perf-coach): CA club list 205→18 ms, FS 362→25 ms, coach team list 21.1→23.3 ms (+10%), parent players 351→0.4 ms, CA guardians 190→1 ms, coach guardians 335→3 ms, parent guardians 341→0.3 ms.
- Races: js/family_authority_races.test.mts F1a/F1b/F2/F3 (hold vs removal both orders, double approval, self-ending vs hold); ×3 green on the clean-boot DB.
- Compatibility (D-4a-3 proven): OLD@445 10/10, NEW@445 8/10 (staff names need 352), OLD@352 10/10, NEW@352 10/10, OLD@354 7/10 (staff names, account picture), NEW@354 10/10.

## 11. Slice 4A contract closure (owner closure brief)
- **Naming.** The banked unit is SLICE 4A — FAMILY / PLAYERS; the verdict is "IDENTITY/AUTH SLICE 4A — …"; 4b–4i not started; Slice 4 not complete.
- **Client legacy checks.** Player Access (`ctx.guardianRelationships` + `ctx.isSiteAdmin`) and Player Details (`ctx.guardianRelationships` + `ctx.siteAdminRole === "full"`) were presentation only (class A: the actions refused through require*Capability and the RPCs decide), but AA.3 puts "UI capability reads" inside the 4a banked unit, AA.1 says the UI renders from capability answers, and AA.5 bans those literals; and the session list answered a different question (team-place product). Replaced with the canonical answers the actions refuse with: Access → `hasPlayerCapability(family.permission.manage)`; Details → `mayRecordPlayerGender` (player.profile.edit_protected for the child or self, or site.users.identity.correct), also used by `setPlayerGender` (restoring the Full Site Admin completion route my 4a early check had narrowed). Guard: `migratedDomainUiViolations` + `js/migrated_domain_ui_authority.test.mts`; role-literal baseline shrinks by the two pages; 4/4 guard mutants killed.
- **No-team-place guardian.** Inside 4a: Phase 2 J.6 grants PG `player.profile.edit_protected` and `family.permission.manage` "for each ACTIVE linked child", and "visibility derives from the child, not from membership". Fixed by the change above; browser 46 J1–J7, 51 N2 now captured from a child with no team place.
- **Z-12.** Rehearsal storage probes at 445/352/353/354 (rehearsal/z12-*.json). Note: D-S4-4 makes an adult's account picture visible to any signed-in person; the closure brief's "unrelated authenticated user cannot access it" holds for minors only — raised with the owner.
- **Release.** release/prepare-stage.sh builds stage-352/353/354 linked work directories; release/verify-stage.sql + EXPECTED.md for read-only verification after each step.
