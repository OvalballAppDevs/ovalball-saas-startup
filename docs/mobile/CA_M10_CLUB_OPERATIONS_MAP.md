# CA-M10 — Club Operations: forensic map of HEAD `5b2bb92`, and what the slice built

One platform, two clients. This map records every club-context operational surface as the repository
holds it at the CA-M10 checkpoint, and where each converges on the phone. The club workspace is not the
desktop Admin Centre on a phone: it is what a Club Admin, a Fixture Secretary, a coach or a volunteer
needs away from a desk. Authority is one probe of canonical keys at club scope
(`readClubAuthority`); no role label decides anything; the server refuses regardless.

**Statuses.** `NATIVE PARITY` — done natively through the shared contract. `SHARED / CONVERGED` — one
shared module serves both clients. `WEB-FIRST BY DESIGN` — desk work, and the app says so.
`INTENTIONAL HANDOFF` — the app names the job and opens the canonical web page. `NOT APPLICABLE` — not
a club job. `BLOCKED` — a new authority semantic would be needed.

## 1. Cross-cutting facts

| | |
|---|---|
| Club context | `SwitchableContext.kind = "club"` for `SWITCHABLE_CLUB_ROLES` (`CLUB_ADMIN`, `FIXTURES_SECRETARY`, `SAFEGUARDING_OFFICER`, `VOLUNTEER`). A plain member gets no club context (the fallback context). |
| Authority | `CLUB_AUTHORITY_KEYS` (`packages/contracts/src/club/overview.ts`): 22 canonical keys read once with `my_capabilities('club', clubId)`. The web still gates several club pages on role names (`canManageClubFixturesAnywhere`, `activeManageableClubId`, `clubRoleKey === 'CLUB_ADMIN'`) — recorded, not copied. |
| Desk tools | `fixture.planner.use`, `fixture.import.run` (R), `competition.creator.use`, `fixture.fixture.bulk_edit`, `fixture.fixture.delete` (R) are club-scope-only; a team context never holds them (CO-CA-6). The phone offers the Fixture Control Centre (`/fixtures/management`) as a hand-off from the club context only. |
| Edit ≠ result | `fixture.fixture.edit` and `fixture.result.record` are independent both ways at club scope (CO-ER-1…5). CA-M7.1 kept. |
| Cancel ≠ delete | `cancel_fixture(id, reason)` keeps the record; deletion is its own R-gated club key nothing on the phone offers (CO-CN). |
| Pitch allocation | `venue.pitch_allocation.manage` is its own authority (CO-VP); the board stays on the website, offered from Grounds & Pitches behind that key alone. |
| Events | `club_events` read under `internal.club_event_visible_row`; managed by `calendar.event.manage`; no notification emitter (H29 untouched, CO-EV-7). |
| Crest / kit / avatar | The club is its crest (`ClubCrest`), a side wears a kit, a person is their avatar. Club Home draws no kit and no person as the club. |

## 2. Surface map

| Web surface | Canonical domain | Table / view / RPC | Capability | Scope | Shared contract | Mobile surface (after CA-M10) | Mobile value | Decision | Security class | Parity | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `/dashboard` (club) | club overview | `fixtures`, `fixture_requests`, `teams`, agenda | role-name on web | club | **`club/overview.ts`** | Club Home (`src/club/home.tsx`) | high | NATIVE | none | NATIVE PARITY | Identity → Needs Attention → Today/Next Up → fixture snapshot → teams → club voice → From Here. |
| Needs Attention | attention | CA-M8 `attention/club.ts` | per queue | club | shared | `HomeAttention` on Club Home | high | NATIVE | none | SHARED / CONVERGED | Only held queues; READ ≠ RESOLVED. |
| Today / Next Up | agenda | `loadAgenda` club scope (every side) | RLS | club | shared | Club Home | high | NATIVE | none | NATIVE PARITY | Fixtures and training today, events today, then next. |
| Fixture snapshot | fixtures | agenda + attention + requests | per key | club | overview | Club Home stats | medium | NATIVE | none | NATIVE PARITY | Today / next 14 days / need action (edit or result holders) / requests (respond holders). No KPI without a canonical count. |
| `/fixtures` (list) | fixtures | agenda club scope | `fixture.fixture.view` | club | shared | Fixtures tab (club: every side, team filter chips) | high | NATIVE | none | NATIVE PARITY | Unchanged reader. |
| `/fixtures/new` | fixtures | `create_fixture`, `compatible_opponent_teams` | `fixture.fixture.create` / `fixture.request.create` | team-or-club | mobile `agenda/mutations.ts` | Add Fixture with a **side chooser** in a club context | high | NATIVE | none | NATIVE PARITY (fixed) | Before CA-M10 the club id was passed as the team id and the server refused. |
| `/fixtures/[id]` console | fixtures | `update_fixture_*`, `cancel_fixture`, `fixture_editable_fields` | `fixture.fixture.edit` / `.cancel` | team-or-club | mobile console | Fixture console (authority-aware) | high | NATIVE | none | NATIVE PARITY | Unchanged; CA-M7.1 semantics. |
| Result recording | fixtures | `submit_fixture_result` | `fixture.result.record` | team-or-club | none on mobile | none | medium | WEB-FIRST (recorded) | none | WEB-FIRST BY DESIGN | No mobile result entry at HEAD; independence pinned. |
| `/fixtures` requests register | requests | `fixture_requests`, `accept_fixture_request`, policy-covered decline | `fixture.request.respond` | club | **`club/requests.ts`** | `/club/requests` | high | NATIVE | none | NATIVE PARITY (new) | Across every side, naming ours; the request's conversation opens natively. Withdraw = the sending side's decline (web too). |
| `/fixtures/management` (Control Centre) | fixtures | the shared management view | `fixture.planner.use` etc. | club | — | hand-off row on Fixtures and Club Home | medium | INTENTIONAL HANDOFF | none | INTENTIONAL HANDOFF | Never in a team context. |
| `/fixtures/planner`, `/import`, `/competitions/*` | fixtures | bulk RPCs | planner / import (R) / creator | club | — | none | low | WEB-FIRST | none | WEB-FIRST BY DESIGN | Not rebuilt smaller. |
| `/calendar` (club) | agenda + events | `loadAgenda`, **`agenda/events.ts`** | `fixture.fixture.view`, `calendar.event.view` | club | shared | Calendar tab with **club event cards** (amber accent) | high | NATIVE | none | NATIVE PARITY (events new) | Multi-day events mark every day. |
| `/events/[id]` | events | `get_club_event_card` | RLS rule | club | — | `/calendar/event/[id]` | medium | NATIVE (read) + HANDOFF (respond/register) | none | NATIVE PARITY (read) | Attendance and the register stay on the website pending H29. |
| `/club/events` (manage) | events | `save_club_event`, `cancel_club_event` | `calendar.event.manage` | club | — | none | low | WEB-FIRST | none | WEB-FIRST BY DESIGN | A form with an address lookup: desk work. |
| `/teams` | teams | `readClubTeams`, counts, agenda | `team.team.view` | club | overview | `/club/teams` | high | NATIVE | none | NATIVE PARITY (new) | Name, age grade, players, staff, next fixture. Directory administration stays in the Admin Centre. |
| `/teams/[id]` | teams | as above + `teamContextKeyFor` | club keys | club | overview | `/club/teams/[id]` with **Enter Team Context** | high | NATIVE | none | NATIVE PARITY (new) | Explicit switch only where the person holds the team; CA-M7 then owns it. Club-scoped inspection otherwise. |
| `/people` | people | `club_people`, `list_pending_club_join_requests`, `decide_club_join_request` | `people.member.view`, `people.role.assign_club` | club | `club/people.ts` | `/admin/people` (CA-M3/M4) | high | NATIVE | contact under `view_contact` | SHARED / CONVERGED | Unchanged; reached from Club Home and More. |
| `/people` invitations | invitations | `issue_invitation` (CLUB_STAFF), `resend_invitation`, `revoke_invitation`, `invitations_admin_view` | `people.invitation.create` (R), `.revoke` | club | **`club/invitations.ts`** | Invite Staff sheet; Resend / Revoke on invited rows | medium | NATIVE | secret never on the client | NATIVE PARITY (new) | Issuing steps up through the CA-M4 pending-intent path. |
| `/people/[id]` | people | membership operations | `people.membership.*`, `people.role.*` | club | `club/people.ts` | `/admin/people/[id]` | high | NATIVE | R step-up | SHARED / CONVERGED | Unchanged. |
| `/club/permissions` | permissions | CA-M4 | `people.capability.manage` | club | `club/permissions.ts` | `/admin/permissions` | medium | NATIVE | R | SHARED / CONVERGED | Unchanged. |
| `/club/join-requests` (players) | roster | `player_club_join_requests`, approve/decline | `club.roster.manage` | club | — | attention item → web | medium | INTENTIONAL HANDOFF | child data | INTENTIONAL HANDOFF | Needs a team choice per player; web. |
| `/club/player-moves` | call-ups, dispensations | `decide_player_call_up`, dispensation RPCs | `fixture.callup.*`, dispensation (R) | club | — | team-side call-up decisions (CA-M7); club side web | low | WEB-FIRST | safeguarding (dispensations) | WEB-FIRST BY DESIGN | Dispensations excluded from the phone. |
| `/club/venues` | venues | `save_club_venue`, pitch RPCs | `venue.venue.manage`, `venue.pitch.manage` | club | `club/venues.ts` | `/admin/venues` | medium | NATIVE | none | SHARED / CONVERGED | Unchanged; now offers Pitch Allocation behind `venue.pitch_allocation.manage`. |
| `/calendar/pitch-allocation` | allocation | `update_fixture_schedule(..., 'PITCH_ALLOCATION')`, proposals | `venue.pitch_allocation.view/manage` | club | — | hand-off row | medium | INTENTIONAL HANDOFF | none | INTENTIONAL HANDOFF | A day board at desk width. |
| `/club` profile, branding | club identity | `update_club_profile`, `upsert_club_kit`, crest bucket | `club.profile.edit` | club | `club/profile.ts`, `branding.ts` | `/admin/club-profile`, `/admin/branding` | medium | NATIVE | none | SHARED / CONVERGED | Unchanged; crest is the header control. |
| `/club/settings/news`, `/teams/[id]/news` | publishing | CA-M5 | `club.news.manage`, `team.news.manage` | club / team | `club/content.ts` | `/admin/news`; "Publish" on Club Home and More | high | NATIVE | none | SHARED / CONVERGED | Unchanged. |
| Messages | messaging | canonical inbox | `may_direct_message` | — | — | Messages | high | NATIVE | U18 absolute | SHARED / CONVERGED | No broadcast invented. |
| Notifications | notifications | CA-M8 | — | — | — | Notifications | high | NATIVE | none | SHARED / CONVERGED | Club types deep-link where a native screen exists; `/people`, `/partner-clubs`, `/club/*` open the web. |
| `/club/finance/*`, `/club/settings/subscriptions`, `/club/settings/ovalball-billing` | finance | — | `finance.*` | club | — | none | low | WEB-FIRST | finance | WEB-FIRST BY DESIGN | H20/H25 untouched; no bank or provider secret on the phone. |
| `/club/settings/safeguarding`, `/club/settings/guardians` | safeguarding | — | `safeguarding.*`, `family.relationship.approve` | club | — | none | — | WEB-FIRST | **safeguarding** | WEB-FIRST BY DESIGN | Nothing on any club screen. |
| `/club/rollover` | handover | — | `team.handover.prepare` | club | — | Admin Centre "On the Web Today" | low | WEB-FIRST | none | WEB-FIRST BY DESIGN | |
| Support, Rugby Hub | — | — | — | — | — | unchanged | — | — | — | SHARED / CONVERGED | Club context presentation only. |

## 3. Counts

| Status | Count |
|---|---|
| NATIVE PARITY | 12 |
| SHARED / CONVERGED | 10 |
| WEB-FIRST BY DESIGN | 8 |
| INTENTIONAL HANDOFF | 4 |
| NOT APPLICABLE | 0 |
| BLOCKED | 0 |

## 4. Personas

`uat.coach` (Club Admin at Ovalball UAT RUFC, also a coach), `uat.manyhats` (Club Admin), `uat.team.manager`
(team context only: proves the Control Centre never appears there), `uat.preston.admin` (another club).
The review world has no `VOLUNTEER` or `FIXTURES_SECRETARY` club role; the read-only club persona and
the Fixture Secretary are proved in `club_operations_ca10.sql` with self-seeded identities.

## 5. Recorded gaps (ledger H30)

Web club pages still gate on role names (listed in §1); no mobile result recording; player join
requests, player moves and event management stay on the web; `direct` club event attendance and its
notification semantics remain H29; the review world lacks a volunteer and a fixture secretary persona.
