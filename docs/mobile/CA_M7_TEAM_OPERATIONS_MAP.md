# CA-M7 — Team Operations: forensic map of HEAD `2341aaa`, and what the slice built

One platform, two clients. This map records every Team capability as the repository actually holds it at
the CA-M7 checkpoint, and the native destination each one converges on. Nothing here is a second Team
domain: every mobile destination reads the same tables, views and operations the website reads, through
`packages/contracts`, and the server decides every write.

**Statuses.** `NATIVE PARITY` — the job is done natively through the shared contract. `SHARED /
CONVERGED` — one shared module now serves both clients (web re-exports it). `WEB-FIRST BY DESIGN` — the
job stays on the website, and the app says so and hands off. `NOT APPLICABLE` — not a team job. `BLOCKED —
OWNER DECISION REQUIRED` — a new authority semantic would be needed.

## 1. Cross-cutting facts

| | |
|---|---|
| Authority engine | `internal.capability_decision` via `internal.can`; clients read `public.my_capabilities(p_scope_type, p_club_id, p_team_id)`. Mobile: **one probe at team scope**, `readTeamAuthority` (`packages/contracts/src/team/authority.ts`), re-asked on every context change and focus, never cached. |
| Role = default bundle | `bundle_capabilities` for `CO` (Coach), `TM` (Team Manager), `TA` (Team Administration, retired at the presentation layer), `PL`, `PG`. CA-M4 Allow / Withhold / Restore semantics untouched; `set_capability_override` / `revoke_capability_override` decide on top. No client compares a role name. |
| Team context | `SwitchableContext.kind = "team"` from `role_assignments` (`team_permissions` is a view over them); `view_only` is a parent context, never a team one. Selecting a context is a preference, not a permission. |
| Team identity | `teams.display_name` derived by `internal.canonical_team_presentation`; no crest, kit or colour on `teams` — kit is `club_kits`, crest is `clubs.logo_storage_path` → Club Directory → initials. Mobile draws the team name in words, the club crest in the header, the kit as a `RugbyKit`. `ClubCrest` cannot take a kit. |
| Classification | `fixtures.game_type` check constraint, `GAME_TYPE_OPTIONS` in `packages/contracts/src/fixtures/game-type.ts`. Now rendered on the Fixtures row, the Next Fixture card, the Calendar card, the Match Centre strip and the Team Home. Add Fixture offers the canonical four (it hard-coded three). |
| Club-only mass tools | `fixture.planner.use`, `fixture.import.run`, `fixture.fixture.bulk_edit`, `fixture.fixture.delete`, `competition.creator.use` — `valid_scopes = {club}`; `internal.guard_bundle_capability` refuses them on any team bundle. Not asked for at team scope by any mobile file (`team_operations_ca7.test.mts`). |

## 2. Capability map

| Capability | Web surface | Canonical domain | Table / view / RPC | Capability key | Scope | Shared contract | Mobile destination | Mobile actions | Authority source | Parity | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Team overview | `/dashboard` (`TeamOperationsPanel`) | team | `loadAgenda` (fixtures, training_sessions), `player_team_memberships`, `team_permissions`, `fixture_requests`, `fixtures` amendment columns, `fixture_player_call_up`, `team_age_grade_attention`, `fixture_availability_summary` | `team.team.view` (+ each item's key) | team | `team/overview.ts` (`loadTeamOverview`, moved from `lib/teams/team-overview.ts`, web re-exports) | Home tab in a team context (`src/team/home.tsx`) | open Next Up, register, People, Requests, Settings | RLS + `readTeamAuthority` | SHARED / CONVERGED | Web dashboard renders the same read; its `outstanding` became `awaiting`. |
| Needs Attention | `/dashboard` panel (two items) | team | derived, see above | per item: `team.attendance.view`, `fixture.fixture.edit`, `fixture.request.respond`, `team.roster.manage`, `fixture.callup.request`, `finance.subscription.view`, `fixture.result.record` | team | `team/attention.ts` (`projectTeamAttention`, pure) | Home → `NeedsAttention` rows, each a destination | open the place the job is done | capability-aware projection; server refuses regardless | SHARED / CONVERGED | Nine kinds (was two). Canonical web hrefs; mobile routes them (`src/team/routes.ts`). READ ≠ RESOLVED. |
| Next Up | `TeamWhatsNext`, Calendar | agenda | `loadAgenda` | `fixture.fixture.view`, `training.session.view` | team | `packages/contracts/src/agenda` | Home `NextFixtureCard` + Who's In strip | open fixture (console for staff, Match Centre otherwise) / Training Centre | `get_match_centre_capabilities` per fixture | NATIVE PARITY | Match → `/fixtures/<id>` (authority-aware); Training → `/calendar/training/<id>`. Staff never routed through parent presentation. |
| Fixtures list | `/agenda`, `/fixtures` | fixtures | `loadAgenda` | `fixture.fixture.view` | team | agenda contract | Fixtures tab | Add / Request (one journey), Fixture Requests row | `loadFixtureAuthority` | NATIVE PARITY | Requests row shows the count waiting, for `fixture.request.respond` holders. |
| Add fixture | `/fixtures/new`, calendar dialog | fixtures | `create_fixture(...)` | `fixture.fixture.create` | team | `apps/mobile/src/agenda/mutations.ts` (thin RPC pass) | `/fixtures/new` | Club Directory first; external → recorded; Ovalball club → request | server re-checks | NATIVE PARITY | Canonical classification list now. |
| Edit fixture | `/fixtures/editor` | fixtures | `update_fixture_details`, `update_fixture_kickoff`, `_schedule`, `_pitch`, `_meet_time`, `_venue`, `fixture_editable_fields` | `fixture.fixture.edit` (either side, via `internal.can_edit_fixture_schedule`) | team | mutations.ts | Fixture Console (inside `/fixtures/<id>`) | tap-the-value editing | server re-checks at save | NATIVE PARITY | Stale authority proved (TO-B5, TO-B7). Every scheduling change asks `fixture.fixture.edit` since CA-M7.1 (H24 closed). |
| Cancel fixture | lifecycle panel | fixtures | `cancel_fixture(p_fixture_id, p_reason)` | `fixture.fixture.cancel` | team | mutations.ts | Console → Cancel sheet | reason required; never deletes | server re-checks | NATIVE PARITY | Mirror fixture told; TO-B9–B12. |
| Request fixture | `/fixtures/new` | fixture requests | `fixture_request_groups` + `fixture_requests` inserts; `compatible_opponent_teams(p_team_id, p_opponent_club_id)` | `fixture.request.create` | team | mutations.ts | `/fixtures/new` (Ovalball opponent) | send | `internal.identities_can_play_fixture` + `fixture_requests_age_eligibility` trigger | NATIVE PARITY | Compatibility is canonical age grade / code / gender; never a name match. |
| Respond to request | `/fixtures` register | fixture requests | `accept_fixture_request(p_request_id)`; decline = policy-covered status update | `fixture.request.respond` | team | `team/requests.ts` | `/team/requests` | Accept / Decline / Withdraw; open thread | RLS + operation | NATIVE PARITY (new) | Mobile loaded `requestRespond` and rendered nothing before. No opposition DM route added. |
| Calendar | `/calendar` | agenda | `loadAgenda`, `marksByDay` | view keys | team | agenda contract | Calendar tab | Month / List / Season; event → centre | RLS | NATIVE PARITY | Approved design unchanged; classification on cards. |
| Availability (staff) | Match Centre participant list; Training Centre register | attendance | `fixture_availability_summary(p_fixture_ids[])`, RLS rows on `player_fixture_attendance`, `get_training_register` | `team.attendance.view` | team | `src/match-centre/load.ts` `loadRegister` (now exported), `src/agenda/training.ts` | `/team/availability`, `/team/availability/[kind]/[eventId]` | counts as filters; remind those awaiting (`send_fixture_communication`) | summary is the authority probe; absent, not zero | NATIVE PARITY (new) | No staff override exists (`response_source='staff'` unwritten) — not faked; no staff notification on a response — ledger H26. |
| Attendance response (participant) | Match Centre, Training Centre, agenda | attendance | `respond_to_attendance`, `respond_to_training_attendance`, `get_my_players_for_*` | relationship-resolved (`internal.resolve_attendance_response_source`) | — | availability contract | Match Centre / Training Centre (unchanged) | I'm Available / Not Available / Unsure | server | NATIVE PARITY | Staff cannot falsify (TO-I1). |
| People | `/teams/[teamId]/people` | roster | `team_people(p_team_id)`, `my_team_relationship` | `team.roster.view` / `team.roster.manage` | team | `team/people.ts` | `/team/people`, `/team/people/[kind]/[id]` | archive / restore / approve / decline; remove staff assignment | RLS + operations | NATIVE PARITY (new) | Names and roles only; no contact, DOB, medical or safeguarding column (TO-F4). Player detail reads `player_staff_view` (age grade, adult flag). |
| Join requests | team People page | roster | `approve_pending_team_membership`, `reject_pending_team_membership` | `team.roster.manage` | team | `team/people.ts` | `/team/settings/requests` (+ Needs Attention) | approve; decline with reason | operations | NATIVE PARITY (new) | Kept out of primary navigation. |
| Player requests (call-ups) | `/teams/[teamId]/player-requests` | player movement | `fixture_player_call_up`, `decide_player_call_up`, `request_player_call_up`, `preview_player_movement_eligibility` | `fixture.callup.request` | team | `team/requests.ts` | `/team/settings/player-requests` | approve / decline (source team decides) | RLS + operation | NATIVE PARITY (decide) / WEB-FIRST BY DESIGN (raise) | Raising needs sibling sides and an eligibility preview — handed off honestly. |
| Join codes | team page section | invitations | `issue_invitation('TEAM_JOIN_CODE')`, `revoke_invitation`, `invitations_admin_view` | `team.join_code.manage` | team | `team/requests.ts` | `/team/settings/join-codes` | issue (plain code once), revoke with reason | operation | NATIVE PARITY (new) | A code never grants access; it creates a join request. |
| Staff (assign) | team page / `/people` | memberships | `set_team_access`, `remove_team_access` | `people.role.assign_team`; assigning needs `people.member.view` | team / club | `club/people.ts` | remove: `/team/people/coach/[id]`; assign: Admin Centre / web | remove | operation | NATIVE PARITY (remove) / WEB-FIRST BY DESIGN (assign) | Team staff do not hold the club member directory. |
| Team details | team page (alias) | teams | `set_team_alias`, `clear_team_alias`, `fold_team` | `team.team.manage` (club), `team.lifecycle.manage` (club) | club | `club/teams.ts` | `/admin/teams/[teamId]` from Team Settings for a `team.team.manage` holder | alias | operation | NATIVE PARITY (CA-M2) | Folding, handover, club settings stay club jobs. |
| Messages | `/messages` | messaging | `getMessengerRows`, `my_direct_message_candidates`, `internal.may_direct_message` | `messaging.*` | team / club | messenger contracts | header Messages (unchanged) | canonical inbox and threads | server | NATIVE PARITY (M3/M4) | Team workspace adds no recipient route; `team_conversations` has no client on either side — ledger H26. |
| Announce to the squad | Match Centre / Training Centre | fixture communications | `send_fixture_communication` | `fixture.communication.send` | team | `src/match-centre/announce.ts` | Match Centre; register's "Remind the N still awaiting" | send | operation | NATIVE PARITY | Broadcast is distinct from News & Announcements. |
| News & Announcements | `/teams/[teamId]/news` | club content (CA-M5) | `club_publishing_scopes`, `save_club_article`, `save_club_announcement` | `team.news.manage` | team | `club/content.ts` | Home preview + `/news`; publish via `/admin/news` from Team Settings | read; compose | operation | NATIVE PARITY (CA-M5) | Not rebuilt. |
| Subscriptions (team) | `/teams/[teamId]/subscriptions` | finance | **`team_subscription_status(p_team_id)`** (new, 20270548) over `membership_obligations`, `player_subscription_payers`, `club_subscription_programmes` | `finance.subscription.view` at team (20270531) or club | team / club | `team/subscriptions.ts` (web `lib/teams/team-subscriptions.ts` re-exports) | `/subscriptions` in a team context; Home card; Needs Attention | none (status only) | operation asks the capability; row policies untouched | SHARED / CONVERGED | Fixes the silent empty page for a team-scoped holder. No bank, mandate, payment, payer identity. Withhold cannot reach a Team Manager — ledger H25. |
| GoCardless | `/club/settings/subscriptions`, parent subscription | finance | provider-hosted | club / family keys | club / self | — | family card → website; nothing in team context | — | — | NOT APPLICABLE | Not touched. |
| Rugby Hub | `/rugby-hub` | hub | CA-M6 | — | — | rugby-hub contracts | fourth tab; Team Home links Coaching | read | — | NATIVE PARITY (CA-M6) | No Team Rugby Hub. |
| Notifications | bell | notifications | `my_bell_notifications`, `notificationHref` | self | — | notifications contract | `/notifications` | tap → intent; `/teams/<id>/...` now resolves natively and switches into a held team context (`teamContextKeyFor`) | server | NATIVE PARITY | READ ≠ RESOLVED. Call-up notifications still resolve to the club web page. |
| Context switching | context switcher | session | `listSwitchableContexts` (shared) | — | — | active-context-rules | header / More / deep link | select a held context | client preference | NATIVE PARITY | A link can select, never grant. |
| Fixture Control Centre, Planner, Import, Bulk edit, Competition Creator | `/fixtures/management`, `/fixtures/planner`, `/fixtures/import`, `/fixtures/competitions` | fixtures (club) | — | club-only keys | club | — | none | none | catalogue guard | NOT APPLICABLE | Absent from the team context by construction and by test. |
| Season handover, folding, club settings | `/club/rollover`, team lifecycle | club | — | `team.handover.*`, `team.lifecycle.manage` | club | — | Team Home footnote → website | — | — | WEB-FIRST BY DESIGN | |
| Safeguarding | `/club/settings/safeguarding` | safeguarding | — | `safeguarding.*` | club | — | none in the team workspace | — | — | NOT APPLICABLE | No case data reaches any team screen. |

**Totals:** 21 NATIVE PARITY (6 new in CA-M7), 3 SHARED / CONVERGED, 3 WEB-FIRST BY DESIGN, 4 NOT APPLICABLE, 0 BLOCKED — OWNER DECISION REQUIRED. Two authority findings were recorded: H24 (scheduling mutations gated on the result key) was closed by CA-M7.1 with migration 20270549 and `fixture_schedule_edit_authority.sql`; H25 remains open with the finance slice.

## 3. The Team IA, as locked

The active team's canonical display name is the workspace identity. The five global tabs are unchanged
(Home, Fixtures, Calendar, Rugby Hub, More). In a team context: **Home** is the team operational overview;
**Fixtures** is the team fixture experience with Add / Request and the requests row; **Calendar** is the
team calendar; **Rugby Hub** is Rugby Hub; **More** carries the team group — Availability, People, Fixture
Requests, Subscriptions (where authorised), Team Settings — above Your Rugby and Your Account. The team
route group (`app/(tabs)/team/**`) is declared to the router with no bar cell. Join Requests, Player
Requests, Join Codes, Staff, publishing and Team Details live under Team Settings; pending items reach the
person through Needs Attention and the bell, not through primary navigation.

## 4. Shared contracts extracted or reused

| Module | Was | Now |
|---|---|---|
| `packages/contracts/src/team/players.ts` | `lib/players/staff-players.ts` (server-only) | shared; web re-exports |
| `packages/contracts/src/team/overview.ts` | `lib/teams/team-overview.ts` (server-only, two attention items) | shared; nine attention kinds; web dashboard renders it |
| `packages/contracts/src/team/attention.ts` | — | pure projection, both clients |
| `packages/contracts/src/team/subscriptions.ts` | `lib/teams/team-subscriptions.ts` reading tables under RLS | shared; reads `team_subscription_status` |
| `packages/contracts/src/team/authority.ts` | `apps/mobile/src/agenda/authority.ts` (fixture keys only) | one team-scope probe for every key the workspace draws with |
| `packages/contracts/src/team/people.ts`, `requests.ts` | web server actions | shared readers and operation wrappers |
| `packages/contracts/src/fixtures/game-type.ts` | shared already | now rendered on every mobile surface |

## 5. Migration

`20270548000000_a_team_reads_its_squads_subscription_state.sql` — one read operation,
`public.team_subscription_status(uuid)`, forward-only. It adds no capability, scope, bundle row or
policy change; it enforces the team-scoped sentence migration 20270531 already declared and refuses
everybody else. Self-checks: asks `finance.subscription.view`, reaches no provider table or payer identity,
and no other finance key holds team scope. Applied locally; not pushed.
