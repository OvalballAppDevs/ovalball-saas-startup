# CA-M8 — Notifications, Inbox & Action Centre: forensic map of HEAD `75767c9`, and what the slice built

One platform, two clients. This map records the notification domain as the repository actually holds it
at the CA-M8 checkpoint, every canonical "still needs this person" state an Action Centre can be
projected from, and where each converges natively. There is **one** notification domain
(`public.notifications` and its registry), **no** mobile inbox, **no** action-item table and **no**
resolved flag: a NOTIFICATION says something happened; an ACTION is read from the record that still
needs a response; READ is never RESOLVED.

**Statuses.** `NATIVE PARITY` — done natively through the shared contract. `SHARED / CONVERGED` — one
shared module now serves both clients. `WEB HANDOFF` — the phone opens the canonical web page and says
so. `RECORDED GAP` — a canonical pending state or emitter that does not exist; recorded, not faked.
`PENDING` — designed, prerequisites named, not built.

## 1. The notification domain as found

| | |
|---|---|
| Storage | `public.notifications (id, user_id, type, title, body, data jsonb, read_at, created_at)`. `type` is a foreign key into `notification_types` (86 keys before this slice, 88 after) grouped by nine `notification_topics`. RLS: select self, update self; **no delete policy**; trigger `enforce_notification_read_only_update` lets a client change `read_at` alone; trigger `notifications_gate_delivery` suppresses an insert the person has switched off (mandatory topics and `mandatory_override` types ignore the switch). |
| Emitters | ~70 SQL functions insert rows with a literal type; `scripts/verify-notification-catalogue.mjs` proves every emitted type is registered and routed and every routed type has a test row. No client inserts. |
| Read model (before) | `my_bell_notifications(p_limit ≤ 50)` — the bell's own membership rule (Messenger's topic and Support's type excluded), newest first, **no cursor**. `my_unread_counts()` — one row: notifications / messages / support / total, split by the registry's topic. |
| Read mutation (before) | The website updated `read_at` directly under RLS (`notification-actions.ts`); the phone had **no** way to mark anything read. Messenger settles its own message notifications through `markConversationRead` (unchanged). |
| Preferences | `notification_preferences (in_app_enabled, email_enabled, push_enabled)`; `notification_topic_settings` view; `set_notification_preference(topic, in_app, email)` refuses to switch a mandatory topic off in-app (`23514`). `push_enabled` is written and read by nothing. |
| Retention | None. No cron, no archive, no dismiss. The only deletion is `forget_notifications_for_deleted_message` (a hard-deleted message takes its notifications with it). |
| Push | **Does not exist.** No `expo-notifications`, no device registry, no token, no APNs/FCM credential, no dispatcher, no delivery log, no permission UX. `should_deliver_notification(…, 'push')` answers `false` honestly. |
| Context identity in `data` | Only nine types carried a `team_id`, `club_id` or `player_id`; every fixture, result and training type carried the event id alone. A client could not stand in the right context before opening one. |

## 2. What the slice built (migration `20270550000000`)

| Piece | What | Why |
|---|---|---|
| `fixture_availability_responded`, `training_availability_responded` | Two registered types in `fixture_updates` / `calendar_training_updates`, emitted by `internal.notify_availability_response` from the two canonical response operations (`respond_to_attendance`, `respond_to_training_attendance`) **only when the answer changed**. `data` carries `fixture_id`/`training_session_id`, `player_id`, `team_id`, `club_id`, `status`. | The CA-M7 gap (ledger H26): staff heard nothing when a family answered. |
| `internal.availability_notification_recipients(team)` | Candidates with a standing at the club or team, decided one by one by `internal.capability_decision(user, 'team.attendance.view', 'team', …)` — the same decision the register asks. The responder is excluded. | Recipients by canonical authority, never a role list. `team.attendance.view` is safeguarding-sensitive, so only Site Admin can withhold it; ending a standing removes a recipient immediately (suite AC-10/11). |
| Supersession | An **unread** row about the same person and event is settled (`read_at = now()`) when the answer changes, then the new row is inserted. A row already read stays as read. | No spam for repeated changes: one unread row per person per event, carrying the current answer. Same treatment as a withdrawn message. |
| `my_notifications(limit, before_created_at, before_id, unread_only)` | The bell's membership rule with keyset paging and an unread-only page, capped at 50. Returns `topic_key`. | A phone that scrolls needs a cursor; "Unread" must be the storage's answer. |
| `mark_notification_read(id)`, `mark_notification_unread(id)`, `mark_all_notifications_read()` | Self-only, `read_at` only, live session required. "All" means the bell's rows; Messenger keeps its own. | One read mutation both clients share. The website's actions now call it. |

No table was added. Messaging, safeguarding, finance and family authority are untouched.

## 3. Notification-producing records — the audit table

Columns: SOURCE DOMAIN / CANONICAL RECORD / NOTIFICATION PATH / RECIPIENT AUTHORITY / READ STATE / UNDERLYING ACTION STATE / WEB DESTINATION / MOBILE DESTINATION / CONTEXT REQUIREMENT / SENSITIVE? / PUSH-ELIGIBLE? / PARITY / NOTES.

| Source domain | Canonical record | Notification path | Recipient authority | Read state | Underlying action state | Web destination | Mobile destination | Context requirement | Sensitive? | Push-eligible? | Parity | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Availability (family) | `player_fixture_attendance` (fixture or training) absent for the child within 14 days | `fixture_attendance_invitation` (cron `send_due_fixture_attendance_invitations`), `fixture_attendance_reminder`, `training_attendance_reminder` | `internal.player_contact_eligibility` — guardians, the adult player | `read_at` | `needsAttendanceResponse` → `AttentionItem fixture_availability / training_availability` per child | `/fixtures/<id>`, `/training/<id>` | Match Centre (participant address, narrowed), Training Centre | family-facing | child data — yes | yes (routing id only) | NATIVE PARITY | Card verdict "Still needs your answer" / "Answered" from the projection. |
| Availability (staff) | the squad's answers (`fixture_availability_summary`) | **new** `fixture_availability_responded`, `training_availability_responded` | `team.attendance.view` by capability decision | `read_at` | `awaiting > 0` → `fixture_availability` (team) | `/fixtures/<id>` | fixture (console for staff); attention row → `/team/availability/[kind]/[id]` | team; the card names `team_id` so the app selects a held team context | names a child's answer to authorised staff only | yes | NATIVE PARITY (new) | Event attendance (`respond_to_event_attendance`) does **not** emit — RECORDED GAP. |
| Fixture requests | `fixture_requests.status = 'sent'` addressed to my side | `fixture_request_received` / `_accepted` / `_declined`, `team_created_from_fixture_request` | `fixture.request.respond` at team or club | `read_at` | `fixture_request` (team: count; club: per request) | `/messages/request/<id>`, `/fixtures` | `/team/requests`; club → conversation thread | team / club | no | yes | NATIVE PARITY | Never a family's. |
| Kick-off amendment | `fixtures.kickoff_amendment_*` proposed by the other club | `fixture_kickoff_change_proposed` / `_changed` / `_declined` | `fixture.fixture.edit` (CA-M7.1) | `read_at` | `kickoff_proposal` (team, club) | `/fixtures/<id>` | fixture console | team / club | no | yes | NATIVE PARITY | |
| Results | `fixtures.result_status = 'awaiting_confirmation'` submitted by the other club | `fixture_result_awaiting_confirmation`, `_amendment_proposed`, `_disputed`, `_final` | `fixture.result.record` | `read_at` | `result_confirmation` | `/fixtures/<id>` | fixture console | team / club | no | yes | NATIVE PARITY | `amendment_pending` / `disputed` not projected as attention — RECORDED GAP. |
| Fixture changes | pitch, details, cancellation, folded team | `fixture_pitch_changed`, `fixture_details_changed`, `fixture_cancelled`, `fixture_cancelled_team_folded` | participants and staff | `read_at` | none (information) | `/fixtures/<id>` | Match Centre / console | any | no | yes | NATIVE PARITY | Cancellations are `urgent`. |
| Training | `training_sessions` | `training_session_updated` / `_cancelled`, `training_plan_cancelled`, `training_staff_message` | `notify_training_participants` | `read_at` | none | `/training/<id>` | Training Centre | any | no | yes | NATIVE PARITY | |
| Team place requests | `player_team_memberships.state = 'PENDING'` | **none** | `team.roster.manage` / `club.roster.manage` | — | `team_place_request` (team) | `/teams/<id>/people` | `/team/people` | team | child — yes | — | attention only | No notification type exists — RECORDED GAP. |
| Club join requests (staff) | `club_join_requests.status = 'pending'` | `club_join_request_submitted` (to `CLUB_ADMIN` memberships — a role list, pre-existing) | `people.member.view` to list; `decide_club_join_request` | `read_at` | `club_join_request` (club) | `/people` | `/admin/people` | club | no | yes | NATIVE PARITY | Emitter recipients are role-based; left as found. |
| Player join requests | `player_club_join_requests.status = 'pending'` | **none** | `club.roster.manage` | — | `player_join_request` (club) | `/club/join-requests` | WEB HANDOFF | club | child — yes | — | attention + handoff | No notification type — RECORDED GAP. |
| Call-ups | `fixture_player_call_up.status = 'requested'` | `fixture_call_up_requested` / `_decided`, `player_eligibility_approval_required` | `fixture.callup.request` (lending side) | `read_at` | `call_up` (team) | `/club/player-moves` | `/team/settings/player-requests` | team | safeguarding-adjacent | yes | NATIVE PARITY | Notification carries no team id; cannot select a context. |
| Dispensations | `player_team_dispensation` chain | `safeguarding_dispensation_requested` / `_decided` / `_revoked` | safeguarding officers | `read_at` | not projected | `/club/player-moves` | WEB HANDOFF | club | **yes** | no (content) | WEB HANDOFF | Excluded from the phone's projection by design. |
| Guardian links | `guardian_link_requests.status = 'PENDING'` | none for submission; `guardian_relationship_changed` on outcome | `family.relationship.approve` at club | `read_at` | not projected | `/guardian-requests`, `/parent/children` | WEB HANDOFF | club / self | **yes** | no | WEB HANDOFF | A club safeguarding queue never appears inside a parent's context. |
| Pathway request | absence of `players.playing_pathway` | `player_information_requested` | active guardians | `read_at` | not projected (protected identity) | `/parent/children` | WEB HANDOFF | family | **yes** | no | WEB HANDOFF | |
| Invitations | `access_invitations.state = 'ISSUED'` + legacy tables | outcome types only (`club_invitation_accepted`, …) | link holder | `read_at` | not projected — no "invitations addressed to me" read exists | `/join` | WEB HANDOFF | self | no | — | RECORDED GAP | |
| Family money | `loadFamilySubscription` → `setup_required` / `failed` | `gocardless_payment_failed`, `gocardless_membership_cancelled` | payer | `read_at` | `family_subscription` (family) | `/parent/players/<id>/subscription` | WEB HANDOFF (provider-hosted) | family | finance — yes | no (amounts never in a push) | attention + handoff | H25 finance authority untouched. |
| Team money | `team_subscription_status` → FAILED / NOT_SET_UP | none | `finance.subscription.view` | — | `team_subscription` (team) | `/teams/<id>/subscriptions` | `/subscriptions` | team | finance — yes | — | NATIVE PARITY | |
| Age grade | `team_age_grade_attention` | none | `team.roster.manage` | — | `age_grade` (team) | `/teams/<id>/people` | `/team/people` | team | child — yes | — | NATIVE PARITY | |
| Partner requests | `club_partnerships.status = 'pending'` | `partner_request_received`, `calendar_share_*` | `club.partners.manage` | `read_at` | `partner_request` (club) | `/partner-clubs` | WEB HANDOFF | club | no | yes | attention + handoff | |
| Tournaments, competitions | `tournament_participants.status = 'pending'`, `competition_match_verifications.status = 'awaiting'` | `tournament_invitation_received`, `competition_match_verification_requested`, … | club/team fixture authority | `read_at` | not projected | `/tournaments/<id>`, `/fixtures/competitions/requests` | WEB HANDOFF | club / governing | no | yes | RECORDED GAP | Readers not yet shared. |
| Season handover | `season_transitions.needs_attention_reason` | `season_transition_needs_attention` / `_warning` / `_completed` | `team.handover.prepare` | `read_at` | not projected | `/club/rollover` | WEB HANDOFF | club | no | yes | WEB HANDOFF | A desk job. |
| Messages | `fixture_messages`, direct, club, announcements | `messages` topic | conversation membership | settled by Messenger | Messenger's own | `/messages/…` | Messages | any | no | yes | untouched | Excluded from the bell by topic. |
| Support | `support_ticket_update` | own header control | ticket owner | `read_at` | Support's own | `/support` | Support | any | no | yes | untouched | |
| Account security | `account_security` topic (mandatory) | own emitters | the person | `read_at` | none | `/account/security` | WEB HANDOFF | self | yes | routing only | WEB HANDOFF | |
| Site Admin | claims, directory requests, disputed results, recovery approvals | `club_claim_submitted`, `directory_request_submitted`, `account_recovery_requested` | site capabilities | `read_at` | the website's `AlertList` projection | `/admin/*` | "This work lives on the website" | site_admin | mixed | — | WEB-ONLY BY DESIGN | No omniscient inbox is invented. |
| Governing body | organiser-side competition responses | `competition_match_response` | body admin | `read_at` | the website's workspace | `/fixtures/competitions/<edition>/issue` | "This work lives on the website" | governing | no | — | WEB-ONLY BY DESIGN | |

## 4. The shared model

| Contract | Role |
|---|---|
| `packages/contracts/src/attention/model.ts` | `AttentionItem { id, sourceType, sourceId, context, priority, title, summary, destination, href, createdAt, dueAt, state: "open", count, capability }`; `sortAttention` (priority → nearest due day → id), `groupAttention` (presentation bands), `countNeedingAction`. |
| `attention/team.ts` | `teamAttentionItems(overview)` — CA-M7's `projectTeamAttention` rows translated, never re-decided. |
| `attention/family.ts` | `attendanceAttention` rows per child plus a membership needing the family. |
| `attention/club.ts` | `loadClubAttention` — one `my_capabilities` probe at club scope, then only the queues behind a held key. Nothing safeguarding. |
| `attention/load.ts` | `loadAttentionForContext(ctx, context)` — family / team / club natively; Site Admin and governing bodies answer `coverage: "web"` and the phone says so rather than drawing an empty queue. |
| `navigation/destinations.ts` | Typed `Destination`, `destinationHref`, `destinationForHref`, `notificationDestination`. The app's `resolveIntent` → `routeForIntent` stays the ONE native resolver; every destination reaches it as a canonical href. |
| `notifications/feed.ts` | `readNotificationPage` (cursor), `markNotificationRead/Unread`, `markAllNotificationsRead`, `notificationPriority` (deterministic from type), `notificationAttentionId` + `attentionVerdict` (READ ≠ RESOLVED at the client: "still open" is only ever the projection's answer, and silent outside the context whose job it is), `notificationContextHint`. |
| `notifications/preferences.ts` | The website's account section as a contract. |

## 5. Mobile surfaces

| Surface | What it does |
|---|---|
| `/notifications` | Header: canonical unread figure and the projection's action figure as two words, never added. Tabs: **Needs Attention** (bands Urgent / Needs Action / For Information; "YOU'RE ALL CAUGHT UP"; the web-desk hand-off) and **Recent** (filters All / Unread / Needs Action — the last offered only where coverage is native; cards with WHAT, WHERE/WHEN, arrival time, unread mark and word, verdict pill, context chip; press-and-hold → Mark as Read / Unread, Open; Mark All Read; pull to refresh; keyset "Show Older"). Opening marks read, selects a held team context named by the card, and routes through the one resolver; a web-only destination opens the website. |
| `/notifications/preferences` | Real switches over `set_notification_preference`; mandatory topics "Always on"; no push switch. |
| Home | `HomeAttention` — the first three of the same projection, "n more" to the screen. Absent when calm. |
| Team Home | Draws its Needs Attention through `teamAttentionItems` and the shared route table. |
| Sign-out | `forgetAttentionCache()` alongside the drafts and Hub caches. The attention cache is in memory only, 60 s, keyed by context, invalidated on any read mutation. |

## 6. Push delivery — PUSH DELIVERY FOUNDATION PENDING

Nothing was built, because nothing safe and contained could be: there is no `expo-notifications`
dependency, no config plugin, no APNs key or FCM project, no worker, and a device registry with no
consumer would be a zero-caller hazard. The canonical architecture, when it is built:

`DOMAIN EVENT → CANONICAL NOTIFICATION (the same insert, gated by should_deliver_notification) →
ELIGIBILITY / PREFERENCE (per topic, push_enabled; mandatory topics still deliver) → DEVICE REGISTRY
(user- and device-scoped: user_id, platform, expo token, app version, last_seen_at, revoked_at; never a
session, password or MFA secret; rotated on token change; removed on sign-out and revokable) → PUSH
(a worker draining a delivery log with attempts, receipt and error; minimal payload — type,
routing ids, a title with no safeguarding or financial detail) → DEEP LINK (the canonical href through
`resolveIntent`)`.

Prerequisites: an Expo push credential and APNs key held outside the repository; the `expo-notifications`
plugin and a permission prompt that is never on the first frame; the registry migration and its
sign-out cleanup; a delivery worker and its log; the payload contract test; the physical-device proof.

## 7. Recorded gaps (see ledger H28)

Event attendance emits nothing; team place requests, player join requests, guardian link submissions
and issued invitations have no notification type; `amendment_pending` / `disputed` results,
tournaments, competition verifications and handover blockers are not projected on the phone;
`club_join_request_submitted` chooses recipients by a role list; call-up notifications carry no team
id; the website's inbox has no unread-only filter and no page after fifty; `directory_request_submitted`
routes to `/admin/claims` where the dashboard has no page; Messenger's own read path bypasses the new
operations (by design, unchanged).
