# CA-M11.4 — Fixture Request, Partner Club & Shared Calendar: Forensic Map

**Status: audit complete, scope decision made.** This document is the required forensic map plus the
scope decision it produced. The headline finding: this domain is **already substantially built, to a
high standard, on both clients.** The work this pass does is the one confirmed, high-value, safely-
additive gap — a shared scheduling calendar for the request flow — not a rebuild.

## Method

Read the schema across all `fixture_requests`/`fixture_request_groups`-touching migrations (14
revisions of `accept_fixture_request` alone), the current live table shape via `\d fixture_requests`,
every web action file under `app/(app)/fixtures/`, `app/(app)/calendar/`, `app/(app)/partner-clubs/`,
every mobile screen under `apps/mobile/app/(tabs)/{fixtures,team,club}/`, the capability catalogue, and
the notification-emission call sites. Grep-verified rather than assumed throughout — see citations.

## 1. Request creation

**WEB**: `app/(app)/fixtures/new/actions.ts` (`createFixtureRequest`) — inserts one
`fixture_request_groups` row (requesting club, opponent identity, proposed date, notes, game type,
competition edition) and one `fixture_requests` row per selected team (independently trackable/
answerable, per the original migration's own design goal). RLS (`fixture_requests_insert_scoped`,
requires `can_manage_team`) is the real authority boundary; the action does not check permissions
itself. **CONVERGED**: `app/(app)/fixtures/new/page.tsx` is one composer, not three.

**NATIVE APP**: `apps/mobile/app/(tabs)/fixtures/new.tsx` (498 lines) — a full native "Add Fixture" /
"Request Fixture" ONE JOURNEY screen (its own doc comment: "There used to be two buttons... this is
one job"). Opponent chosen from the club directory FIRST; the screen tells you before you pick a date
whether this will be a request (on Ovalball) or a record (not on Ovalball). Compatible-opponent-team
list, home/away/either, kick-off time, note, game type (record path only) — all present. **GAP FOUND
AND FIXED THIS PASS**: the date/time step was a plain `DateField`/`TimeField` with zero scheduling
context — no visibility of our own commitments, no partner availability, no way to find a good date
without leaving the screen. This is the gap this pass closes (see Section 12 below).

**SHARED DOMAIN**: canonical age/code compatibility is `internal.identities_can_play_fixture`,
enforced by a DATABASE TRIGGER on `fixture_requests` insert (never just a UI filter) and exposed via
`compatible_opponent_teams`/`compatible_opponent_identities` RPCs
(`app/(app)/fixtures/new/search-opponents.ts`). Web and app both call the identical RPCs — one rule,
not two.

## 2. Request lifecycle / state machine

**Confirmed states** (`fixture_requests_status_check`): `draft, sent, accepted, declined,
counter_proposed, cancelled, expired`.

**Confirmed reachable in practice**: `sent` → `accepted` (via `accept_fixture_request`, SECURITY
DEFINER, re-checks authority itself) or `sent` → `declined` (a **plain RLS-covered UPDATE**, not a
function — `app/(app)/fixtures/actions.ts`'s own comment: "no atomic multi-table write is needed the
way acceptance requires") or `sent` → `cancelled` (also a plain RLS-covered UPDATE, used for
withdrawal — `apps/mobile/app/(tabs)/team/requests.tsx`'s `withdraw()`, guarded with
`.eq("status","sent")` so a stale double-action cannot silently succeed).

**CONFIRMED DEAD**: `counter_proposed` is declared in the check constraint and has display labels in
four places (web `app/(app)/messages/[kind]/[id]/page.tsx`, mobile `club/requests.tsx` and
`team/requests.tsx`, shared `packages/contracts/src/messenger-rows.ts`) but **no SQL function, no web
action, and no mobile mutation ever writes it.** Grepped exhaustively for `'counter_proposed'` outside
the check constraint itself: zero writers. This is a genuine, confirmed domain gap — not a UI omission.

**`draft` and `expired`**: also never written anywhere found. `draft` appears to be reserved for a
future save-without-sending flow that was never built; `expired` for a future scheduled expiry job that
does not exist. Neither invented or implemented this pass, per the brief's own instruction not to
invent statuses.

## 3. Accept — what it actually creates

`accept_fixture_request(p_request_id, p_target_team_id)`, latest definition in
`supabase/migrations/20270310000000_an_away_request_carries_the_proposed_ground.sql`. Far more capable
than the original: resolves Mini-Rugby scheduling-group opponents (age-eligible member auto-resolution),
resolves a proposed away ground/pitch against the host's own `venues`/`club_pitches` by name match where
possible, and — critically — has **two distinct creation paths**:

- **Ordinary new fixture**: inserts exactly one `fixtures` row for the requesting team (never a second,
  separate "mirror" insert in this latest version — opponent identity is carried via `opponent_team_id`/
  `opponent_scheduling_group_id`/`opponent_directory_id` on that single row, consistent with the Master
  Fixture Registry "one row is the whole match, viewed from one side" model this codebase already uses
  elsewhere).
- **Existing-fixture completion**: when `fixture_requests.existing_fixture_id` is set (a request raised
  from the fixture editor, asking an opponent to confirm which of THEIR teams plays a fixture that
  ALREADY exists), acceptance `UPDATE`s that fixture's `opponent_team_id`/`opponent_directory_id` rather
  than inserting a second row — with a uniqueness guard
  (`fixture_requests_one_open_per_existing_fixture`, one open request per existing fixture) preventing
  duplicate concurrent asks.

Both paths correctly preserve the Competition Match / Fixture-operational-projection distinction: this
whole table and both its creation paths write only to `public.fixtures` (the operational projection),
never to a competition-match table — `game_type`/`competition_edition_id` are carried through as
classification metadata onto the resulting fixture, never used to fabricate competition authority.
Confirms Sections 32/74/75 are already correctly respected.

## 4. Partner club architecture

**`club_partnerships`** is the canonical relationship (`supabase/migrations/20260903500000_
partnership_automation.sql` and earlier `20260831093000_partner_clubs_and_fixture_messages.sql`).
Status starts `pending`, moves to `active` only via `respond_to_club_partnership` — **never
auto-accepted**. When a fixture request between two Ovalball clubs is accepted and they are not already
partners, exactly one Partnership Request is auto-created (`source_fixture_id` records the trigger,
purely informational — never changes fixture behaviour either way). Full web product exists:
`app/(app)/partner-clubs/{page,[clubId]/page,partner-clubs-explorer,partner-club-card,club-map-card}.tsx`.
**This already answers Section 7's question**: Ovalball distinguishes clubs-on-Ovalball, the club
directory (every club, on or off Ovalball), and formal active partnerships — no new relationship type
was invented or needed.

## 5. External opposition

`club_directory` (public-read, `active=true`) is the one search surface for BOTH on-Ovalball and
external clubs — `searchOpponentClubs`/`searchDirectoryClubs` never distinguish at the query level; the
UI does, immediately and honestly, the moment a club is chosen (`Presence` badge, "On Ovalball"/"Not on
Ovalball", both clients). Choosing an external club skips the request/negotiation entirely and records a
plain fixture directly (no request row at all) — truthful: there is nobody on the other end to ask.
This already matches Section 10/12 exactly; nothing to build.

## 6. Contact details

Grepped for personal contact exposure on the request/response path: none found.
`fixture_conversation_participants`/`fixture_messages` are structured, request-scoped threads (opened
via `/messages/[kind]/[id]` with `kind="request"` on both clients) — never a generic cross-club DM
surface, and never a rendered personal phone/email. Section 59/60 already satisfied.

## 7. Notifications

Confirmed emitted, grepped directly: `fixture_request_received` (on send, to the target team's staff if
a specific team was named, else the opponent club's Club Admin/Fixtures Secretary —
`internal.notify_fixture_request_recipients`, a trigger, capability-derived recipients, never a
hardcoded role check beyond the `role in ('team_admin','coach','manager')`/`role in
('CLUB_ADMIN','FIXTURE_SECRETARY')` recipient-selection, which is a genuine, pre-existing role-string
narrowing this pass did not touch), `fixture_request_accepted`, `fixture_request_declined`. No
`fixture_request_countered` (consistent with counter being unimplemented) and no dedicated
withdraw-notification (`apps/mobile/src/agenda/mutations.ts`'s own comment: "which is why there is no
separate 'withdraw' here" — withdrawal resolves the outstanding notification rather than emitting a new
one, an existing, deliberate design choice, left alone).

## 8. Action Centre / Home surfacing

**Already wired.** `apps/mobile/src/attention/routes.ts` has a `case "fixture_request"` for team
context, routing directly to `/team/requests` (no dead-end). Club-context items route through the
generic intent resolver to the club requests screen. `apps/mobile/app/(tabs)/club/requests.tsx` calls
`invalidateAttention()` after every accept/decline, so Action Centre counts stay correct without a
manual refresh. Nothing to build here.

## 9. Native request screens (mobile) — already built

- `apps/mobile/app/(tabs)/team/requests.tsx`: Waiting for Your Answer / Waiting for Them / Recently
  Settled, capability-gated Accept/Decline/Withdraw, human status language throughout ("Waiting for an
  answer", "Change proposed", "Withdrawn" — never a raw enum), links to the request thread.
- `apps/mobile/app/(tabs)/club/requests.tsx`: the same rows across every one of the club's sides, naming
  which side each concerns, same two operations, same capability gate (`fixture.request.respond` probed
  server-side, never inferred from a role label).
- `apps/mobile/app/(tabs)/fixtures/new.tsx`: the one composer (Section 1 above).

All already satisfy Sections 39, 43-47 of the brief. No rebuild attempted or needed.

## 10. Capabilities

`fixture.request.create` / `fixture.request.respond` (`supabase/migrations/20270349000000_
capability_catalogue_and_bundles.sql`), both scoped `club` and `team`, granted to CA and FS at club
scope, CO and TM at team scope (create only for CO — a Coach may ask, not answer; confirmed by bundle
grants), `site.fixtures.support` as the site-master equivalent. Gated by capability + scope throughout,
never a role-label check — grepped for `role ===` / `'CLUB_ADMIN'` used as an AUTHORITY gate (rather
than a legitimate recipient-selection narrowing, which is different) in the request UI/actions and found
none.

## 11. What genuinely does not exist (the real gap)

**A shared scheduling calendar for the request flow — confirmed absent on both clients.** Neither
`app/(app)/fixtures/new/page.tsx` nor `apps/mobile/app/(tabs)/fixtures/new.tsx` shows any calendar,
availability, or "Find a Date" surface; the date is a bare text/date-picker field with zero scheduling
context. `packages/contracts/src/agenda/{load,month-grid,window}.ts` already provide the exact
reusable primitives this needs (bounded date-window queries, a month-grid cell model, our own
fixtures+training for a team) — this was designed to be built ON, not duplicated.

**Counter-proposal — confirmed dead, and confirmed non-trivial to add safely.** The state exists in the
check constraint only. Implementing it means extending `accept_fixture_request`, a function with 14
historical revisions and two live creation paths (ordinary + existing-fixture-completion) plus
scheduling-group auto-resolution — real, load-bearing complexity. Per the brief's own Section 33
instruction ("If domain does NOT support this safely: DO NOT fake it with notes. Document the gap and
design the smallest canonical extension"), this pass **documents the extension design (below) and does
not implement it**, rather than rushing a change to that specific function in the same pass as new,
unrelated schema work. This is a scope decision, not an oversight.

### Proposed counter-proposal extension (designed, NOT applied)

Additive columns on `fixture_requests`: `countered_date date`, `countered_kickoff_time time`,
`countered_venue_preference text` (same check constraint as `venue_preference`), `countered_by uuid
references auth.users(id)`, `countered_at timestamptz`, `counter_note text`. A new RPC
`counter_fixture_request(p_request_id, p_date, p_kickoff_time, p_venue_preference, p_note)` — same
authority check as `accept_fixture_request`'s responder branch, moves `status` to `counter_proposed`,
sets the `countered_*` columns, leaves the ORIGINAL proposed date/time on the group/request untouched
(so history is never destroyed) and fires `fixture_request_countered`. `accept_fixture_request` would
need one small, careful branch: when `status = 'counter_proposed'`, use `countered_date`/
`countered_kickoff_time`/`countered_venue_preference` instead of the group's `proposed_date`/the
request's `preferred_kickoff_time`, AND the accepting side becomes whoever did NOT set the counter
(the original requester, accepting their own counter's answer) — this reversal is the one genuinely
fiddly part and the reason this needs its own careful pass with its own dedicated test matrix, not a
same-day addition alongside the calendar work.

## 12. Scope decision for this pass

Given the above, this pass builds:

1. **A privacy-safe shared availability/scheduling-calendar system**, shared contracts +
   SECURITY DEFINER RPC for cross-club partner availability (status-only, never event detail) + native
   calendar UI wired into the existing, converged `fixtures/new.tsx` composer, replacing the bare date
   field with a real scheduling surface, plus a `Find a Date` compare view. Purely additive: no existing
   table, RPC, or screen is modified in a way that could regress the mature lifecycle documented above.
2. **Full test coverage** for the new read model (SQL authority/privacy tests, JS/TS pure-function
   tests for availability derivation and date-compare logic).
3. **Does NOT implement** counter-proposal this pass — designed above, left for its own dedicated pass
   given the real risk surface of `accept_fixture_request`.

Everything documented in Sections 1-10 above (request creation, accept/decline/withdraw, partner clubs,
external opposition, notifications, Action Centre, capabilities, native screens) is preserved exactly as
found — none of it needed to change to add the calendar.
