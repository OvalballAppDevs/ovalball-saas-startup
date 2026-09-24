# CA-M11.1 — Club Admin functional parity recovery: the website as the specification, at HEAD `cec5ded`

The owner's correction: the phone is not a reduced Club Admin. Where the website has a function, the
default is to bring it to the phone over the same canonical domain, the same server operations and the
same authority, with native presentation. Complexity is never a reason to leave a function on the web;
only a genuine technical, security, provider or platform reason may, and it is named here.

**Statuses.** `PARITY` — the same legitimate outcome is achievable on the phone through the same server
operation. `MISSING` — not achievable, with the exact blocker. `PROVIDER HAND-OFF` — the website itself
sends the person to a provider's own pages (GoCardless), and so does the phone, deliberately.
`BEYOND WEB` — a canonical, granted server operation the website has no control for, offered natively.

## 1. Bottom navigation

The two arrows were the router's "missing icon" glyph for two route groups (`news`, `announcements`)
that existed under the tab folder but were never declared as screens. Both are now declared and hidden.
The bar is Home / Fixtures / Calendar / Rugby Hub / More in every context; `projectTabs` is pinned.

## 2. Club Admin Home

Not redesigned. The only Club Home change in this pass is none; discoverability lives in More.

## 3. Invitations (owner correction 1)

| Web function | Web surface | Canonical domain / operation | Capability | Mobile (after CA-M11.1) | Status |
|---|---|---|---|---|---|
| Invite club staff: email (required), real-world role, one club-wide role, a role per team | `/people` invite form | `issue_invitation('CLUB_STAFF', p_email, p_intended_outcome{roles, declared_role}, p_team_roles)` | `people.invitation.create` (R) | `src/invitations/invite-staff-sheet.tsx` with the same inputs and RPC | PARITY |
| Show the credential once: link, human code, QR of the link | `components/invitations/invitation-share.tsx` (server-rendered SVG via `qrcode`) | the plaintext returned once by `issue_invitation`; the QR encodes `${site}/join?t=<token>` only | — | `src/invitations/share-panel.tsx` + `qr.tsx` (the same `qrcode` encoder's pure core, drawn in SVG); copy (clipboard), share sheet | PARITY |
| Email the link | `sendEmailEvent('club_invitation')` in the web action (server-only mail) | — | — | not sent from the phone; the panel says so and offers link/code/QR | MISSING — the mail sender is a server-only module with provider secrets; the phone must not hold them. The canonical fix is a server-side email on issue (owner decision, H32) |
| Resend (rotates link, code, expiry) | `/people` pending row | `resend_invitation` → `(token, code, expires_at)` | `people.invitation.create` | Reissue → share panel with "previous no longer works" | PARITY (mobile's old "nothing else changes" copy corrected) |
| Revoke with reason | `/people` | `revoke_invitation` | `people.invitation.revoke` | ReasonSheet | PARITY (existing) |
| Team join code: issue (50 uses, 30 days), show link/code/QR, list with hint/uses/expiry, revoke | `/teams/[id]` join-code section | `issue_invitation('TEAM_JOIN_CODE', p_team_id)`, `invitations_admin_view`, `revoke_invitation` | `team.join_code.manage` | Team Settings → Join Codes now shows the same triple | PARITY |
| Recipient: link → preview → sign in → accept; code typed → same preview; wrong-account escape; age gate | `/join` | `preview_invitation`, `redeem_invitation` | session | `app/join.tsx` (CA-M11) | PARITY |
| Recipient: scan a QR | none on web (the QR is for a phone camera) | the QR is the link | — | `app/scan-invitation.tsx` (expo-camera, QR only; accepts only `/join?t=`/`?c=` on the site host or the app scheme; never opens a URL) | BEYOND WEB |
| Recipient with no account | `/login` → `/signup` loses the invitation context (web gap) | — | — | "I Don't Have an Account" opens the website's `/join` | MISSING on both clients: there is no invitation-aware signup (recorded) |
| Guardian / player-account / safeguarding / governing / site-admin invitations | their own web surfaces (no QR or code on any of them) | wrappers that discard the code | various | see the Guardians & Players and Safeguarding sections | as those sections |

QR and code semantics are shared: there is no mobile QR payload, no mobile token, no `mobile_invites`.
Possessing a code grants nothing beyond the web flow (`TEAM_JOIN_CODE` → a pending join request).

## 4. Pitch Allocation (owner correction 2)

Web audit (every interaction, `app/(app)/calendar/pitch-allocation/*`):

| Interaction | Input | Server operation | Result | Conflict rule | Capability | Audit |
|---|---|---|---|---|---|---|
| Drag & drop / Move dialog | pitch + 15-min slot / pitch + `<input type=time>` | none at drop: staged in `pendingChanges` | card repositions; badges recompute | advisory only (`detectConflicts`, `detectResourceConflicts`, `detectTournamentConflicts`) | `.manage` (UI) | none until Save |
| Save Changes (N) | staged map | one `update_fixture_schedule(..., p_source 'PITCH_ALLOCATION')` per fixture, after a home-club / not-cancelled / pitch-active check | pitch, venue, kick-off (proposed to the opposition when shared), status lifecycle, mirror | server: none (RPC asks fixture edit at either side) | `.manage` (UI), **`fixture.fixture.edit` (RPC)** | one `audit_log` row per fixture, source `PITCH_ALLOCATION`; `fixture_pitch_changed` / kick-off notifications |
| Discard Changes | — | none | draft reset | — | — | — |
| Auto Allocate / Recalculate All | — | writes `pitch_allocation_proposals` + items under RLS | proposal review modal | hard-first ordering, size, bands, lanes, turnaround, tournament blocks, shared-group one-per-day | `.manage` (RLS insert) | proposal rows only |
| Apply proposal | review modal | stages eligible items (not hard, not unallocated), then `status = 'discarded'` | staged | — | `.manage` | proposal status |
| Unassign / resize | do not exist on the board | clear via Fixture Detail `update_fixture_pitch` | — | — | fixture edit | audit |
| Settings | warm-up, pack-up (0–60 by 5), auto-allocate | upsert `club_scheduling_policy` under RLS | buffers change board-wide | — | RLS: legacy `fixture.edit` | — |
| Read-only viewer | — | same board, no controls | — | — | `.view` | — |

Native design (`apps/mobile/app/(tabs)/admin/pitch-allocation/`): date header (previous / next / today /
next home fixture), the website's four-number summary, tournament holds, a tray of fixtures needing a
pitch with the website's reason for each, grounds as chips, each pitch as a card of the day's occupancy
in time order (fixture windows with buffers, training, club events, tournament holds, clash and warning
badges), tap a fixture → Move (pitch + time, with the clash it would cause shown from the same detectors
before staging) / Clear Pitch / Open Fixture, staged changes → Save Changes (N) / Discard, Auto Allocate
and Recalculate All → proposal review sheet → stage eligible, an unsaved-changes guard on leaving, and a
Settings screen for buffers and auto-allocate with the buffers' provenance.

| Web function | Mobile | Status |
|---|---|---|
| Allocate (unallocated → pitch + time) | Choose a Pitch → Move sheet → stage → Save | PARITY |
| Reallocate (move pitch / time) | tap card → Move → stage → Save | PARITY |
| Unallocate | tap card → Clear Pitch (`update_fixture_pitch`, the website's Fixture Detail path) | PARITY (the web board itself has no control; the canonical operation is used) |
| Conflicts (hard / warning; training; tournament; lanes; buffers) | same detectors over the draft, on cards and in the Move sheet | PARITY (and the phone includes training/event occupants in tournament checks, which the web's live recompute drops) |
| Proposals (auto / recalculate / review / stage / discard) | same shared builder and review | PARITY |
| Settings | native | PARITY |
| Read-only view | native, controls hidden | PARITY (the phone also offers the board to a `.view`-only holder, which the web's Calendar tab does not) |
| Date default (next home fixture) | shared `nextHomeFixtureDate` (web converged) | PARITY |
| Drag & drop | tap-to-move | different presentation, same outcome |

Shared: `packages/contracts/src/pitch-allocation/*` (types, occupancy, allocator, conflicts, lanes, the
board read model, the operations) — the website's `lib/pitch-allocation/*`, `data.ts`, `actions.ts`
and the settings action now consume it; `lib/mini-rugby/*` and `lib/fixtures/resolve-home-away-groups`
moved with it. Authority: `venue.pitch_allocation.view` / `.manage` only, on both clients' UI and on
the proposal/policy RLS. **Recorded divergence (H32):** the placement RPC `update_fixture_schedule`
asks `fixture.fixture.edit`, not the allocation key, so a fixture-edit holder with `.manage` withheld
can still land a placement on either client, and a `.manage` holder without fixture edit cannot save.
The website's own server actions additionally gate on the legacy `fixture.edit`. Changing the RPC's
authority is an authority change and is reported, not made.

## 5. Subscriptions & Payments (Club Admin finance)

Two money domains, kept apart on both clients: A — members pay the club (`/club/finance`,
`/club/settings/subscriptions`, the club's own GoCardless merchant); B — the club pays Ovalball
(`/club/settings/ovalball-billing`, `platform_*`). Shared contract `packages/contracts/src/club/finance.ts`;
the website's `lib/payments/domain/{money,dashboard-metrics,proration}.ts` now re-export it, so one
formula answers both clients. Native screens under `apps/mobile/app/(tabs)/admin/subscriptions/`
(Overview, Plans, Members, Membership detail, Ovalball Billing). Every mutation goes through a reason
sheet with the step-up pattern; club-scope `finance.*` keys only; no `gc_*`, token, bank or
service-role field reaches the phone.

| Web function | Server operation | Capability | Mobile | Status |
|---|---|---|---|---|
| Finance dashboard metrics, attention counts, memberships needing review, month selector | RLS reads of `membership_obligations`, `gocardless_subscriptions`, `gocardless_payments`; `get_finance_action_required` | `finance.subscription.view` | Overview | PARITY |
| Generate this month's obligations | `create_membership_obligations_for_period` | `finance.enrolment.manage` | Overview → Generate Obligations | PARITY |
| Waive with reason | `set_obligation_exemption` | `finance.enrolment.manage` | Members → Waive (reason required) | PARITY |
| Retry a failed payment | web server action using the service-role merchant token → GoCardless retry | `finance.payment.act` | "Retry on the Website" (opens the same finance page) | PROVIDER HAND-OFF — the merchant token is service-role-only; there is no HTTP route for the phone to call |
| Membership detail + obligation history + payments | `get_membership_operational_detail` | (RPC-gated) | Membership detail | PARITY |
| Cancel a member's membership | web server action → provider cancel → `end_membership_subscription` | `finance.payment.act` | "Cancel Membership on the Website" | PROVIDER HAND-OFF — same blocker |
| Export CSV | `export_finance_rows` (+ audit) → client CSV | `finance.subscription.export` | Export CSV → same RPC → share sheet | PARITY (owner note: `RECENT_AUTH_CONVERGENCE.md` prefers export web-only) |
| Programme settings, effective-dated price change + history, sibling discounts, first-payment worked example | `configure_subscription_programme`, `set_subscription_price`, `configure_sibling_discount_rule`, `preview_first_payment_illustrative` | `finance.subscription.configure` | Plans | PARITY |
| Connect GoCardless (OAuth) | `/api/gocardless/oauth/start` → provider → callback → `store_gocardless_connection` | `finance.gocardless.connect` | opens the website's start route in the system browser | PROVIDER HAND-OFF (deliberate; never a WebView; no token on the phone) |
| Connection / verification status; disconnect with reason | `get_gocardless_connection_status`, `disconnect_gocardless` (+ `get_active_subscription_impact`) | `finance.gocardless.connect` | Overview (status asked only when the key is held; impact shown before disconnect) | PARITY |
| Refund; payouts/reconciliation; `set_responsible_payer`; cancel the Ovalball subscription; the club's own Direct Debit to Ovalball | orphan server operations with no web UI | — | not built | MISSING ON BOTH CLIENTS (no web function to mirror) |
| Ovalball billing state, next collection, plans, history, credit; choose plan; start trial; referrals | `club_platform_billing_state`, `club_platform_next_collection`, `select_club_plan`, `start_club_trial`, `club_referral_summary` | `finance.platform_billing.view/manage`, `club.referrals.view` | Ovalball Billing | PARITY |

**H20 / H25** concern team-staff finance delegation (the team scope of `finance.subscription.view`), not
Club Admin finance operations; every club screen asks the key at club scope. Both are left untouched
and pinned as untouched by `club_finance_ca11_1.sql` (CF-G1/G2). Tests: `club_finance_ca11_1.test.mts`
19/19, `club_finance_ca11_1.sql` 33/33.

## 6. Season Handover

The website's `/club/rollover` (PREPARE → DECIDE → REVIEW → APPLY, 17 server actions, `apply_season_handover`
the single mutation boundary) converged into `packages/contracts/src/club/handover.ts` (one read model,
sixteen mutation wrappers over the same RPCs, and the pure rules the page held: sections, state and
event words, consequence sentences and counts, confirmation lines, blocker destinations, team-decision
rules, player filters and status words, `YOUTH_AGE_GROUPS`). The website's page and its actions now
consume it (zero `.rpc(` left in the web actions). Native staged workflow under
`apps/mobile/app/(tabs)/admin/rollover/`: Overview (ledger, readiness), Teams (target season from the
canonical register, Prepare, per-team Confirm / Adjust / Choose Destination / Fold / Defer / Youth
pathway complete / Undo, bulk confirm, Mixed → U12 split with an unanswered default, Mini-Rugby group
flags and next-season groups), Players (search, filters, Change Placement with the server's verdict,
Run this team next season, Undo, graduation queue), Attention (blockers deep-linked, Ask their guardian),
Apply (counts, explicit confirmation restating consequences and "cannot be undone", `team.handover.apply`,
step-up with a held intent, audit list).

| Web function | Server operation | Capability | Mobile | Status |
|---|---|---|---|---|
| Board, header, ledger, readiness, People counts | `seasons`, `handover_state`, `rollover_readiness`, `handover_consequences` | `team.handover.prepare` | Overview | PARITY |
| Choose target season; Prepare Handover | `generate_rollover_proposal` | prepare | Teams | PARITY |
| Team decisions: confirm / adjust / choose destination / fold (reason) / defer / youth pathway complete / undo; bulk confirm | `confirm_rollover_team_proposal`, `undo_rollover_team_decision` | prepare; fold/graduate `team.lifecycle.manage` (R) | Teams → decision sheet | PARITY |
| Mixed boundary split; group flag resolved; next-season Mini-Rugby group | `confirm_mixed_boundary_rollover`, `resolve_rollover_group_flag`, `create_next_season_scheduling_group` | prepare; `team.mini_rugby_group.manage` | Teams | PARITY |
| Players: search, filters, status; change placement; plan a missing team; undo; graduation queue | `age_grade_rollover_player_proposals`, `rollover_placement_options`, `set_rollover_player_placement`, `set_rollover_player_planned_placement`, `plan_missing_placement_team`, `clear_rollover_player_placement`, `place_graduating_player`, `mark_graduating_player_left` | prepare; `team.graduation.place` | Players | PARITY |
| Withdraw a planned team | `unplan_handover_team` | prepare | wrapper only — the web has no control either | PARITY (no surface on either client) |
| Needs Attention with deep links; Ask their guardian | `handover_apply_blockers`, `request_player_playing_pathway` | prepare | Attention (season blockers open the website's Seasons register, a Site Admin desk job) | PARITY |
| Apply with confirmation; revision check; audit | `apply_season_handover(p_rollover_id, p_expected_revision)`, `handover_audit` | **`team.handover.apply`** | Apply | PARITY (the web's Apply button now follows `team.handover.apply` too — it followed `prepare` before; server unchanged) |
| Automatic cron apply disclosure; staff movement disclosure | — | — | not built | MISSING ON BOTH (no web surface) |

No migration; no authority change; `aal = R` on apply/lifecycle remains unenforced server-side on both
clients (recorded). Proof is transaction-safe: `season_handover_ca11_1.sql` 27/27 self-seeds its own
club and rolls back; the review club's season was never advanced. `season_handover_ca11_1.test.mts`
16/16.

## 7. Guardians & Players (Club Admin administration)

The website scatters this over six pages (`/club/settings/guardians`, `/guardian-requests`,
`/club/join-requests`, `/club/player-moves`, team people, rollover). Shared contract
`packages/contracts/src/club/guardians-players.ts` (an eleven-key probe, the readers, every mutation as
a thin wrapper over the same RPC and arguments). Native screens under
`apps/mobile/app/(tabs)/admin/guardians/`: Overview (what is waiting on you, by capability), Players
(search, filters), Player detail, Guardians (deduplicated, with linked children), Link Requests, Join
Requests (squad picker never pre-selected), Duplicates, Player Moves (call-ups and dispensations).
Privacy: `player_staff_view` only (no DOB, no gender value — "Recorded" / "Not recorded"; staff may only
ask); guardian emails only through `get_team_guardian_directory` under `family.relationship.approve`@club;
the *submitted* DOB appears only on a link request or a duplicate review, as on the web.

| Web function | Server operation | Capability | Mobile | Status |
|---|---|---|---|---|
| Club-wide player directory | `player_team_memberships` + `player_staff_view` + `get_team_guardian_directory` | `family.relationship.approve` (page) | Players | PARITY |
| Player detail | `player_staff_view` | `player.profile.view` | Player detail | PARITY (the web has no detail page; the phone shows only what club surfaces show) |
| Create / edit a player as Club Admin | none / self-child scopes only | — | — | MISSING ON BOTH BY DESIGN (no RPC; not a club function) |
| Move a player to another side | `move_player_team_membership(membership, target, reason)` | `team.roster.manage` on both sides | Player detail → Move to Another Side (reason required) | BEYOND WEB (canonical, granted, no web control) |
| Archive / restore a place | `archive_player_team_membership` / `restore_player_team_membership` | `team.roster.manage` | Player detail | PARITY |
| Player join requests to the club with squad placement | `approve_player_club_join_request(request, team)` / `decline_player_club_join_request(request, reason)` | `team.join_request.review` | Join Requests (the attention item now lands here, not on the web) | PARITY |
| Pending team places (parent-added child) | `approve_pending_team_membership` / `reject_pending_team_membership` | `team.roster.manage` | Players → Places to Confirm | PARITY |
| Call-ups: raise and decide | `request_player_call_up`, `preview_player_movement_eligibility`, `decide_player_call_up` | `fixture.callup.request`, `fixture.callup.approve` (R) | Player Moves | PARITY |
| Dispensations: request, decide per stage, governing-body reference, revoke | `request_player_dispensation`, `decide_player_dispensation`, `revoke_player_dispensation` | `fixture.dispensation.request`, `.approve_club` (R) | Player Moves | PARITY |
| Ask a guardian for a player's gender | `request_player_playing_pathway` | `player.pathway.request` | Player detail | PARITY |
| Guardian directory with emails | `get_team_guardian_directory` | `family.relationship.approve` | Guardians | PARITY |
| Guardian link requests: queue, approve, decline | `guardian_link_requests_for_approval`, `approve_guardian_link_request`, `reject_guardian_link_request` | `family.relationship.approve` (R) | Link Requests | PARITY |
| Remove a guardian relationship | `remove_guardian_relationship(guardian, reason)` → `{orphaned}` | `family.relationship.remove` (R) | Player detail → Remove (reason required; orphaned banner) | PARITY |
| Replacement guardian invitation | `send_replacement_guardian_invitation` → token | `family.relationship.approve` | Player detail → Replacement Invitation (link shown once, copy/share; no email from the phone) | PARITY (email is the web's server-only module) |
| Duplicate-player review | `resolve_player_duplicate_review_as_existing` / `_as_new` | `family.duplicate.resolve` (R) | Duplicates (explicit confirmation the web lacks) | PARITY |
| Issue a GUARDIAN invitation | `issue_invitation('GUARDIAN')` | `family.invitation.create` | — | MISSING ON BOTH (no web UI) |
| Suspend / lift with confidential | `transition_guardian_relationship` | `site.family.manage` | — | not a Club Admin function (correct on both) |

**Found, not fixed (H32):** the catalogue declares `family.relationship.approve/remove`,
`family.duplicate.resolve`, `fixture.callup.approve` and `fixture.dispensation.approve_*` as `R`, but their
RPCs do not call `internal.require_recent_aal2` — probed empirically, a Club Admin at aal1 is accepted on
both clients. The phone's step-up path is wired and will engage the day the server enforces it;
`guardians_players_ca11_1.sql` pins the current acceptance as a documented gap so closing it flips
loudly. Tests: `guardians_players_ca11_1.sql` 29/29, `guardians_players_ca11_1.test.mts` 8/8.

## 8. Safeguarding Officer

The website's safeguarding product is small and deliberate: there is no case, concern, incident, note or
document domain anywhere (`docs/architecture/safeguarding-officer-model.md`), and nothing was invented.
What exists is (a) the Club Admin's nomination job on `/club/settings/safeguarding` and (b) the
officer's own keys (`safeguarding.dispensation.view`, `safeguarding.welfare.view`,
`safeguarding.transfer.view`, `messaging.moderation.club_review`, conversation handling), which the web
gives no page of their own. Shared contract `packages/contracts/src/club/safeguarding.ts`; native
screens under `apps/mobile/app/(tabs)/admin/safeguarding/` (contact register and nomination; the
officer's threads, dispensation visibility, reasoned welfare lookup, moderation queue), reached from
the Admin Centre section (nominate) and from More for a person whose own keys make them the officer.
A Club Admin who is not the officer inherits nothing (proved).

| Web function | Server operation | Capability | Mobile | Status |
|---|---|---|---|---|
| Reach the section; nominate a contact; nominate an existing member | `nominate_safeguarding_officer`, `nominate_club_safeguarding_officer`, `get_club_member_directory` | `safeguarding.officer.nominate` | index | PARITY (the member nomination has a server action the web never renders; the phone calls the same RPC) |
| Invite / resend / withdraw the officer's invitation | `invite_safeguarding_officer` → canonical `issue_invitation`; `resend_safeguarding_officer_invitation`; `revoke_invitation` on the canonical row | nominate | link shown once with copy/share (no email from the phone) | PARITY (the web's Revoke is wired to a legacy id the canonical issuer never writes, so its control never appears; the phone's works) |
| Edit contact; remove assignment; message / email the officer; awaiting and confirmed lists; thread read and reply | `update_safeguarding_officer_contact`, `deactivate_safeguarding_officer`, `start_or_get_safeguarding_officer_conversation`, `send_safeguarding_officer_message`, RLS reads | nominate; `.officer.deactivate`; `.conversation.start`; `.conversation.handle` | index, threads | PARITY |
| Officer: conversation inbox; "Reviewed by Ovalball" marker | `club_safeguarding_officer_conversations`, `safeguarding_thread_reviews` | `.conversation.handle` | threads | BEYOND WEB (existing server reads the web never draws) |
| Officer: dispensation visibility | RLS branch `safeguarding_dispensation_team_ids()` | `safeguarding.dispensation.view` | dispensations (read-only; no decision reason selected) | BEYOND WEB (the web's player-moves page will not render for an officer) |
| Officer: welfare lookup with a mandatory recorded reason | `welfare_member_view(player, reason)` + `safeguarding.welfare_viewed` event | `safeguarding.welfare.view` | welfare | BEYOND WEB |
| Officer: moderation queue | `club_message_reports` | `messaging.moderation.club_review` | reports (read-only) | BEYOND WEB |
| Officer: moderation decisions | `mark_message_report_reviewed` / `resolve_message_report` | `site.messages.moderate` only | — | MISSING ON BOTH — no club-level decision operation exists |
| Transfer view | — | `safeguarding.transfer.view` (catalogued, wired to nothing) | — | MISSING ON BOTH — no domain exists; not invented |
| Site Admin confirmation, withhold/restore of officer keys | site RPCs | site | — | Site Admin is web-only by design |

Authority proved server-side by crafted calls (`safeguarding_ca11_1.sql` 61/61): a Club Admin without
the officer keys is refused every officer read (42501 or zero rows); a confirmed officer reads their
own club; another club's officer reads nothing; nomination and invitation operations refuse everyone
but the nominate holder; no officer read returns a narrative, notes or medical column; no safeguarding
case table exists. Nothing safeguarding appears on Club Home, in attention items or in generic rows
(pinned). Sensitive notifications unchanged (payloads carry ids only). Tests:
`safeguarding_ca11_1.test.mts` 8/8.

## 9. More (discoverability) and Team-context isolation

The club context's More now offers Teams, People, Fixture Requests, Grounds & Pitches, News, Publish,
**Guardians & Players, Subscriptions & Payments, Season Handover, Pitch Allocation, Roles & Permissions,
Safeguarding** — each behind its canonical capability (the Admin Centre's own probe, the board's two
keys, the officer's own keys). The team context's More carries none of them (pinned).

## 9a. Proof outcome (Expo Web export, Playwright, local stack, 2026-09-24)

A: five tabs (Home / Fixtures / Calendar / Rugby Hub / More) and no arrow cell in the club, team and
family contexts. B: More offers the six club jobs in the club context and none of them in the team
context. C: a placement made on the website's board (Move dialog, Save Changes) appears on the phone's
board with one `PITCH_ALLOCATION` audit row. D: a move staged and saved on the phone (Pitch 1, 15:00,
"no clash" shown first) appears on the website's board. E: Clear Pitch on the phone leaves the fixture
unallocated on the website. F: with `venue.pitch_allocation.manage` withheld the phone's board reconciles
to read-only; with `fixture.fixture.edit` withheld a staged save is refused by the server and the row is
unchanged. G: a website-issued token and code preview on the phone; a code issued on the phone shows the
link, the code and the QR of the link (canonical `/join?t=` shape), and the website recognises both the
code and the link. Domain screens from the four builders were verified by their permanent suites and
typechecks; they were not driven in the browser in this pass. Review world restored to baseline
(fixture row byte-identical including its timestamp; overrides, proposals and invitations back to their
counts); the only residue is append-only audit history.

## 10. Physical-iPhone walkthrough (prepared, not performed)

1 Club context. 2 More: the club's jobs listed behind their capabilities. 3 Subscriptions & Payments.
4 A legitimate subscription action (as the finance section allows). 5 Season Handover. 6 Preview only /
the staged workflow without Apply. 7 Guardians & Players. 8 A player's detail. 9 A guardian's detail.
10 A legitimate relationship or player action (with reason and, where R, a code). 11 People → Invite
Staff with email, real-world role, club-wide role and a team role. 12 The QR displayed. 13 The code
displayed; copy; share sheet. 14 Get Started → Scan a QR Code with the camera on the QR from 12 → the
same invitation preview. 15 The code typed on another phone → the same preview. 16 Pitch Allocation.
17 Previous / next day, Today, Next home fixture. 18 A ground chip. 19 The pitch cards with buffers,
training, events, holds. 20 Choose a Pitch on a tray fixture → stage → Save Changes. 21 Move an allocated
fixture to another pitch and time; a clash shown before staging. 22 Clear Pitch. 23 A hard clash badge
after staging two fixtures on one single-lane pitch. 24 Manage withheld by another admin → pull to
refresh → controls gone; fixture edit withheld → Save refused with the server's sentence. 25 Safeguarding
entry as the officer (More row present) and as a Club Admin who is not the officer (nomination only).
26 An authorised safeguarding read. 27 An authorised action. 28 The non-officer Club Admin refused the
officer's screens. 29 Five bottom tabs. 30 No arrows, in club, team, family, player, site-admin and
governing contexts. 31 Team context. 32 More in the team context carries none of the club-only jobs.

## 11. Final acceptance — can the person now achieve on the phone what they can on the website?

| Correction | Answer | Evidence |
|---|---|---|
| Invitations | **YES** | Staff invitation with the website's inputs and the same RPC; link, code and QR shown once on both surfaces; team join codes likewise; resend rotates; recipient link, typed code and in-app QR scan all reach the same `/join` preview and acceptance; cross-client proof: a website-issued token and code preview on the phone, a phone-issued code and link are recognised by the website. The only transport difference is email, which the phone cannot send (server-only mail module) and says so. |
| Pitch Allocation | **YES** | Native board over the shared read model and operations: allocate, reallocate, unallocate, conflicts, proposals, settings, read-only view; proof: web placement → phone, phone placement → web, native clear → web, manage withheld → read-only, fixture edit withheld → save refused by the server. Drag and drop is replaced by tap-to-move. |
| Bottom navigation | **YES** | Five cells, no arrows, in club, team and family contexts (screenshots and `projectTabs` pin). |
| Subscriptions & Payments | **YES**, with two provider hand-offs the website itself makes | Every Club Admin finance read and configuration write natively over the same domain (§5). Retry a failed payment, cancel a membership and connecting GoCardless stay provider-hosted / server-actioned because the merchant token is service-role-only — the website's own architecture, not a phone limitation. |
| Season Handover | **YES** | Every staged step and decision natively over the same engine; Apply gated on `team.handover.apply` with explicit confirmation (§6); proof transaction-safe, the review club's season untouched. |
| Guardians | **YES** | Directory with emails, link requests approve/decline, remove relationship, replacement invitation, duplicate review (§7). A GUARDIAN invitation has no web control to mirror. |
| Players | **YES** | Directory, detail, join requests with squad placement, pending places, archive/restore, call-ups and dispensations, ask for gender (§7), plus the canonical player move the website lacks a control for. Create/edit a player is not a Club Admin function on either client. |
| Safeguarding | **YES** for everything the website has, plus the officer's own reads | Nomination, invitation, contact, removal, messaging, lists and threads (§8); the officer's dispensation visibility, welfare lookup and moderation queue over existing server reads; a non-officer Club Admin refused server-side. Moderation decisions and a transfer domain do not exist on the server (MISSING ON BOTH). |

