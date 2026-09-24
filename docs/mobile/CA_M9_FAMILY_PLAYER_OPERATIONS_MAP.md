# CA-M9 — Family & Player Operations: forensic map of HEAD `36ff132`, and what the slice built

One platform, two clients. This map records every family-facing and player-facing capability as the
repository holds it at the CA-M9 checkpoint, and where each converges natively. There is **one** family
domain (`guardians`, `players`, `player_team_memberships`, `guardian_player_permissions`), **one**
attendance store (`player_fixture_attendance`), **one** payment domain (GoCardless through the club's
programme), **one** messaging authority (`internal.may_direct_message`) and **one** notification domain
(CA-M8). The selected child is presentation state. The server decides.

**Statuses.** `NATIVE PARITY` — done natively through the shared contract. `SHARED / CONVERGED` — one
shared module now serves both clients. `WEB-FIRST BY DESIGN` — the job stays on the website, and the
app says so. `INTENTIONAL HANDOFF` — the app explains the task and opens the canonical web page.
`NOT APPLICABLE` — not a family or player job. `BLOCKED` — a new authority semantic would be needed.

## 1. Cross-cutting facts

| | |
|---|---|
| Family context | `SwitchableContext.kind ∈ family \| parent \| player` is derived from `guardians` (ACTIVE) × active `player_team_memberships` and from `players.user_id`. `isFamilyFacingContext` is the one presentation predicate. No context grants anything: `activeManageableClubId` is null for every family-facing kind. |
| Selected child | `FamilyProvider` (`apps/mobile/src/family/family.tsx`) normalises the stored choice against the resolved `FamilyProjection` on every render; an id the family does not hold can never reach a query or a chip. |
| Multi-club family | `resolveFamilyScope` lists (player, team, club) triples; `readingScopeFor("family")` asks every club the family reaches (CA-M5); `FamilyMember.clubName` and `describeFamily` carry provenance. The review world has no multi-club family; the code path is pinned by `family_player_operations_ca9.test.mts`. |
| Age | `resolvePlayerAgeState` (adult / minor / unknown_youth_protected / unknown) for presentation; `internal.resolve_attendance_response_source` for authority: a guardian always; an adult player (DOB ≥ 18); a 16–17-year-old only with `approve_own_attendance` in effect; under 16 never; **no date of birth = refused** ("Age could not be verified"). The phone shows the server's sentence and offers nothing it refused. |
| Three states | `ATTENDING \| CANNOT_ATTEND \| UNSURE` plus unanswered. A fourth is refused by the server (AV-1). |
| Messaging | `internal.may_direct_message(other)`: both adults (unconditional), not blocked, club policy, then discovery (shared club incl. guardian→child's club staff; staff↔staff across a fixture). A parent or player never reaches the opposition; a minor never reaches a coach, nor a coach a minor. Chooser: `my_direct_message_candidates()`. |
| Staff notification | `internal.notify_availability_response` (CA-M8), called only by the two canonical response operations. No second emitter. |

## 2. Surface map

| Web surface | Canonical domain | Table / view / RPC | Authority | Relationship requirement | Shared contract | Current mobile surface | Missing mobile behaviour (before CA-M9) | Safeguarding classification | Parity | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Dashboard family panel (`projectParentHome`) | agenda | `loadAgenda` family scope, `player_fixture_attendance` | RLS | active guardian / own player | `parent/home.ts`, `participant/home-hero.ts`, **`attention/*`** (CA-M8) | Home: hero, notices, news, membership card | identity block, child selector sheet | child data | NATIVE PARITY | Family Home: identity block → Needs Attention → Next Up → announcements/news → memberships. |
| Child selector (chips on web agenda) | family | `resolveFamilyScope`, `player-avatars` signed URLs | RLS | guardian | `family/projection.ts` | chips (`ChildFilter`) | a selector naming each child's sides and club | child picture | NATIVE PARITY | `ChildSelector` sheet + `FamilyIdentityBlock` on Home; chips stay on Fixtures and Calendar. No DOB, no ids. |
| Agenda (`/agenda`) | agenda | `loadAgenda` | RLS | guardian / player | `agenda/*`, **`family/events.ts`** | Fixtures tab (family: own children only; no Add/Edit/Cancel/Request) | one row per child for one match | child data | NATIVE PARITY | `collapseFamilyEvents`: one event with every sibling's answer when reading All Children. |
| Calendar (`/calendar`) | agenda | `loadAgenda` (+ `club_events` on web) | RLS | guardian / player | agenda | approved forest calendar with participant cards | sibling collapse | child data | NATIVE PARITY | Club events are **not** in `loadAgenda` on either client's shared reader; the web calendar reads them directly — RECORDED GAP (see §6). |
| Match Centre (`/fixtures/<id>`) | fixtures + attendance | `get_match_centre_capabilities`, `get_my_players_for_fixture`, `respond_to_attendance` | server per fixture | guardian / player on an involved side | `availability/*`, `participant/*` | participant Match Centre (hero, result, meet/KO/venue, own availability, weather, team-safe info) | confirmation after answering; a provisional score said as such | opposition contacts refused; register refused | NATIVE PARITY | `attendanceConfirmation` after a fixture answer; `resultQualifier` from `result_status`. Opposition contacts asked for only by the fixture's manager. |
| Message Team Staff | messaging | `my_direct_message_candidates`, `open_direct_conversation` | `may_direct_message` | shared club | mobile `messages/recipients.ts` | "Message Team Staff" → `/messages/new` | — | U18 both ways refused; opposition refused | NATIVE PARITY | Web has no such affordance on the fixture page (web is behind, recorded). |
| Training Centre (`/training/<id>`) | training + attendance | `get_training_session_card`, `get_my_players_for_training_session`, `respond_to_training_attendance` | server | guardian / player | availability | native Training Centre with confirmation | — | as above | NATIVE PARITY | Unchanged. |
| Availability (three states) | attendance | `player_fixture_attendance` | `resolve_attendance_response_source` | guardian / adult / consented 16–17 | `availability/question.ts` | `AvailabilityChoice` | confirmation on fixtures | child data | NATIVE PARITY | Human words only (Available / Unavailable / Unsure / Might attend). |
| Staff notification on answer | notifications | CA-M8 emitter | capability decision | — | CA-M8 | — | — | names the child to authorised staff only | SHARED / CONVERGED | Reused; AV-3…6 re-prove. |
| Event Centre (`/events/<id>`) | club events | `get_club_event_card`, `get_my_players_for_club_event`, `respond_to_event_attendance` | server | active membership at the club | none shared | **none** | whole surface | child data | WEB-FIRST BY DESIGN (recorded) | Not in the shared agenda reader; `get_my_players_for_club_event` raises for an under-16 self-responder instead of returning `can_respond=false`; no notification emitter. Left documented. |
| Children (`/parent/children`) | family | `guardians`, `players`, `player_team_memberships`, `my_guardian_link_requests` | RLS / RPC | guardian | **`family/relationships.ts`**, `family/avatars.ts` | **none** | Children screen | child picture, age state only | NATIVE PARITY (new) | `/family`: one row per person, sides, club, login status, pending requests. No DOB. |
| Child detail: picture | family | `set_player_avatar`, bucket `player-avatars` | `can_edit_player_avatar` (family) | guardian / self | mobile `identity/images.ts` | none | native | child picture | NATIVE PARITY (new) | Tap the picture to change it. |
| Child detail: permissions | family | `get_player_permission_summary`, `set_guardian_player_permission` | `family.permission.manage` + ACTIVE guardian | guardian | **`family/permissions.ts`** | none | native grid | — | NATIVE PARITY (new) | Unanimous-grant / deny-by-default; "Waiting for another guardian" said. |
| Child detail: their own login | invitations | `issue_invitation` (PLAYER_ACCOUNT) | server | guardian | `family/permissions.ts` | none | native | — | NATIVE PARITY (new) | One invitation architecture; the token never reaches the phone. |
| Add child / link request / additional guardian / gender | family | `add_child_for_guardian`, `request_child_link`, `request_additional_guardian`, `respond_to_additional_guardian_request`, `set_player_playing_pathway` | as web | guardian | — | none | — | protected identity (gender), DOB entry | INTENTIONAL HANDOFF | Need a date of birth and a club search, or record identity once: the website. The Children screen says so and opens it. |
| Profile (`/account`) | identity | `profiles` (RLS self), bucket `avatars` | self | — | **`identity/profile.ts`** | header avatar change only | Profile screen | — | NATIVE PARITY (new) | Name, phone, picture. Email, password, authenticator, address: website. |
| Family subscription (`/parent/players/<id>/subscription`) | payments | `get_enrolment_eligibility`, `player_subscription_payers`, `gocardless_*`, `membership_obligations` | RLS (payer-scoped) | guardian / own player | `subscriptions/family.ts`, **`subscriptions/family-detail.ts`** | Home card + web link | native detail; the family branch of Subscriptions was a placeholder | finance | NATIVE PARITY + INTENTIONAL HANDOFF | What it is, whom it covers, amount a month, Direct Debit state, this month, sibling discount, next step. Setting up the Direct Debit opens the website (server-side provider call). |
| GoCardless authorisation | payments | `record_billing_request`, provider redirect flow | payer | payer | — | web | — | finance | INTENTIONAL HANDOFF | No bank details in Ovalball on any client. No `ovalball://` return exists; the flow returns to the web page. |
| Payment attention | attention | `SubscriptionAttention` | — | family | CA-M8 `attention/family.ts` | Needs Attention | — | finance | SHARED / CONVERGED | Disappears when the canonical state resolves. |
| Announcements / news | publishing | CA-M5 | server audience | — | `club/content.ts` | Home, News tab | — | — | SHARED / CONVERGED | Unchanged. |
| Rugby Hub | Hub | CA-M6 | — | — | `rugby-hub/*` | Hub tab | — | — | SHARED / CONVERGED | Player Home offers a "Get better" entry; presentation only. |
| Notifications | notifications | CA-M8 | — | — | `notifications/*` | Notifications | — | — | SHARED / CONVERGED | Family and player types deep-link into the surfaces above. |
| Messages | messaging | `direct_conversations`, `fixture_messages` | `may_direct_message`, `can_access_fixture_conversation` | — | — | Messages | — | U18 boundary absolute | SHARED / CONVERGED | Unchanged. |
| Player self-registration (`/player/join`) | family | `create_own_player_profile`, `request_to_join_club` | `player.self_register` | — | — | none | — | DOB entry | WEB-FIRST BY DESIGN | Desk work. |
| Adult transition (`player_adult_transition`, `end_my_guardian_access`) | family | RPCs | the adult player | — | — | none (neither client) | — | — | WEB-FIRST BY DESIGN (recorded) | No surface on either client at HEAD. |
| Match community (awards, kudos) | community | `get_match_community`, `cast_match_award_vote`, `give_match_kudos` | electorate | — | — | none | — | youth-conservative | WEB-FIRST BY DESIGN (recorded) | Out of CA-M9 scope. |
| Staff attendance override | attendance | `response_source='staff'` (permitted, unwritten) | — | — | — | none | — | — | BLOCKED (H26) | See §5. |

## 3. Personas used

| Persona | Kind | What they prove |
|---|---|---|
| `uat.guardian.one` | guardian of three (Cara U12, Freddie unplaced, Reece 17 on Men's 1st) | multi-child family, a child with no side, a consented teen's guardian |
| `uat.guardian.two` | guardian of Ava (U12), Ben (U8), Martha (unplaced) | multi-child, multi-side |
| `uat.adult.player` (Marcus Fenwick, Men's 1st) | adult player | own fixtures, self-response, no staff controls |
| `uat.player.self` (Rowan Whitaker, 17, U16) | U18 player with a login | self-response refused without consent; U18 messaging boundary |
| `uat.team.manager` | team staff | the other side of the staff notification |
| `uat.preston.admin` | another club | opposition isolation |

No permanent identity was created. No multi-club family exists in the review world; the multi-club path is pinned in the JS suite. Two review-world facts worth knowing when reading the screenshots: the adult player account's profile is named Owen Doyle while its linked player is Marcus Fenwick (seeded that way, left as found), and the child selector lists the children who have rugby to show — a child awaiting a team appears on the Children & Family screen, not in the selector.

## 4. Shared contracts created or converged

`family/events.ts` (sibling collapse), `family/relationships.ts` (the family in words), `family/permissions.ts` (grid + invitation), `player/home.ts` (Player Home projection), `identity/profile.ts` (own profile), `subscriptions/family-detail.ts` (membership detail, provider ids never returned). Existing: `family/projection.ts`, `agenda/*`, `parent/home.ts`, `participant/*`, `availability/*`, `attention/*`, `subscriptions/family.ts`.

## 5. H26 — staff attendance override: audit and proposed model (not implemented)

The domain records **stated availability only**: every write sets `response_source` to `guardian` or
`player`; `staff` is a permitted CHECK value nothing writes. There is no observed-attendance store, no
team sheet, no selection table. Overwriting a family's stated answer with a staff one would be
falsification of what a person said.

Proposed model, for the owner's decision: a separate **observed attendance** record
(`player_event_attendance_observed`: event, player, `observed_status ∈ PRESENT | ABSENT | LATE`,
`recorded_by`, `recorded_at`), written by `team.attendance.view`-holding staff after the event, read
beside the stated answer on the register, never replacing it, never emitting a family notification.
This needs new data and authority semantics, so it stops here. H26's staff-notification half remains
closed (CA-M8); its override half remains open.

## 6. Recorded gaps (ledger H29)

Club events are absent from the shared agenda reader and from the phone; `get_my_players_for_club_event`
raises for an under-16 self-responder; `respond_to_event_attendance` emits no staff notification (the
event may be club-wide, so the CA-M8 team-recipient rule does not transfer safely — left documented);
a non-payer co-guardian reads "setup required" for a healthy membership because `gocardless_*` RLS is
payer-scoped (a finance-domain RLS change, H25/H20-adjacent, not touched); the web Match Centre has no
"Message Team Staff" entry; `direct_coach_communication` (16–17) is recorded but never consulted by
`may_direct_message`; no adult-transition surface on either client; the CA-M8 audit's working notes took
`get_enrolment_eligibility` for service-role only — it is granted to `authenticated`.
