# P3 — Parent Fixtures, Match Centre, and the participant/admin boundary

Banked locally. No migration and **no change to any migration or to any SQL
function**; the only new SQL is a self-seeding, rolled-back test suite.

## The root cause of the Calendar defect

Not the Calendar's `onPress`. That was already converged in P2 and was correct.

**`/fixtures/<id>` is the canonical address for one physical fixture on both
clients** — it is what the website routes to, what `notificationHref` emits for
every fixture notification, what a shared link carries, and what expo-router
restores after the app is killed. The mobile client had grown two screens and
given the **fixture console** that canonical path. So every canonical way into a
fixture put a participant in fixture administration:

| Entry point | Before P3 |
|---|---|
| Header bell → "Can Pippa play on Saturday?" (`fixture_attendance_invitation`) | **the console** |
| A shared or emailed fixture link | **the console** |
| Restored navigation state after the app was killed | **the console** |
| A hand-typed URL | **the console** |
| Match Centre → "Fixture Details" | **the console** (gated in P2, but the path remained) |
| The fixture console itself → Match Centre | a hand-built path with a `teamId` nobody read |

Closing one handler could never have been enough, because **the address was the
defect**. The observation was exactly right, and the word "capable" was the right
word.

## Every event entry point audited

`router.push` · `router.replace` · `Link` · notification destinations · agenda
destinations · calendar destinations (month grid, week list, week sheet) · fixture
cards · Home cards (Needs Attention, Next Up, This Week) · message-linked objects ·
deep-link parsing · `+not-found` recovery · restored navigation state · every
hand-built fixture/training path.

Findings: five hand-built paths (Home, Fixtures, Calendar ×3 — closed in P2); the
Match Centre's link to the record and the console's link to the Match Centre (both
closed now); `notifications.tsx` and `_layout.tsx` routing canonical hrefs without
narrowing (closed); `messages/index.tsx` and `+not-found.tsx` route only to
conversations and never to an event (verified, unchanged); `fixtures/new.tsx`
converged. A permanent test now fails if any screen builds one of these paths by
hand again.

## The destination architecture

**Layer A — projection** (`src/links/destinations.ts`, the single authority):

| Object | Viewer | Address |
|---|---|---|
| Match | parent · family · player | `/fixtures/[fixtureId]/match-centre` — **cannot render administration, because it does not import it** |
| Match | anybody else | `/fixtures/[fixtureId]` — **authority-aware** |
| Training | anybody | `/calendar/training/[sessionId]` |

`narrowIntentForContext` applies the same narrowing to intents arriving from
**outside** — a notification, a deep link, a future push payload — so a
participant's canonical `/fixtures/<id>` becomes the participant address before it
is routed. It only ever narrows, and leaves every non-fixture intent untouched.

A context kind appears in Layer A, and it is never authority: it chooses between
two addresses and only ever chooses the more restrictive one. A family-facing
context holds no fixture-management capability by construction —
`loadFixtureAuthority` has no scope to ask at for one.

**Layer B — the guard.** `/fixtures/[fixtureId]` asks
`get_match_centre_capabilities(fixtureId)` — the canonical per-fixture resolver,
the same `internal.can` chain every fixture mutation re-runs — and renders the
console only where `can_manage_fixture` is true. It **fails towards the
participant**: an error, an absent row and a false all give the Match Centre.

**And the console has no address at all.** It is a component
(`src/fixtures/fixture-console.tsx`) that exactly one route may render. A typed
URL, a restored stack or a link from outside cannot reach it, because there is no
URL for it. That is the protection that does not depend on anybody choosing the
right path.

So a team manager who has **not** been delegated `fixture.fixture.edit` lands on
the Match Centre exactly as a parent does. Membership is not management.

## Fixture route convergence (the P2 debt)

**Why there were two:** M4 built a fixture console at the canonical path and M6
added the Match Centre beside it at a sub-path. The web has one route because its
Match Centre is one shared role-aware surface with staff controls integrated; the
app had inverted that, making the *admin* surface canonical.

**What was converged:** both surfaces moved out of the route tree into
`src/fixtures/`. `/fixtures/[fixtureId]` became the one canonical address, deciding
by server authority. `/fixtures/[fixtureId]/match-centre` remains as the explicit
participant address — kept deliberately, because it is the address the website has
linked since M4, `resolveIntent` already parses it, and a route that *cannot* draw
administration is a second independent protection rather than a duplicate.

**What was not:** the two surfaces are still two component trees. Merging them into
one role-aware tree is the web's shape and is P4's work; collapsing them here would
have risked legitimate staff operations, which §13 forbids.

## Parent Fixtures

Upcoming / Past from the canonical fixture model — no second state vocabulary.
Training excluded (it has no opponent and no home/away; it lives on the Calendar).
`All · Pippa · George` from `FamilyProvider`, absent for a parent of one. The
**team chips are now withheld in a family scope**: the child chips are the canonical
family filter, and a side's name is the same question in the wrong language. No
team selector, no age-group selector, no club fixture browser. `Add Fixture` is
gated on the server's own `fixture.fixture.create`, which a family context does not
hold. Cards carry child, side, opponent, home/away as the canonical letter badge,
date, kick-off, meet time, venue, canonical status and the child's own availability;
they carry no fixture identifiers, owning-team internals, notes, planner or import
information. Tap → Match Centre.

## Match Centre

Match identity (both sides, crest and kit, competition, date, kick-off, meet time,
venue, canonical status), the child and their own availability with the canonical
three-state response where the server permits it, published match information,
weather, and cancellation/change state. For staff it additionally carries the
register and announcements. **The "Fixture Details" row is gone for anybody without
`can_manage_fixture`**, and the console it pointed at is no longer addressable.

**New in P3:** a participant communication action. `can_message` is
`internal.can_access_fixture_conversation` — the club-to-club thread — and a
guardian correctly does not hold it, so before P3 a parent reached the Match Centre
with **no way to ask anybody anything**. There is now a "Message Team Staff" row
that opens the canonical recipient chooser. It is a shortcut, not a second route:
`/messages/new` is built on `my_direct_message_candidates()`, which applies
`internal.may_direct_message` to its own output. No recipient is resolved in the
Match Centre, no id is constructed, and fixture participation grants nothing. The
row is absent when the canonical list is empty — which is what an under-18 player
gets.

## Opposition isolation

**Opposition information is visible. An opposition relationship is never created.**
`SideColumn` is text and images with no `Pressable` and no `onPress` — the opponent
cannot be opened, browsed or contacted. Opposition contacts are now only **asked
for** by somebody who may manage the fixture: the server already returned nothing
to a participant, but a read a family context never makes cannot leak.

Proved: a guardian gets 0 opposition contacts and 0 "Fixture contact" candidates,
`may_direct_message` to another club's staff is false, opening that conversation
by id is refused — while the opponent's name on their own fixture stays visible.

## Training Centre boundary

One screen, one implementation, no role-named copy. Every editable field is gated on
`session.canManage`, which comes from `get_training_session_card` running
`internal.can_manage_training`; cancelling is gated again; and a non-editable row
draws **no press target and no chevron**, so there is no control that fails after
being tapped. Proved at the write: a guardian cancelling a session is refused.
Calendar remains view-only — it imports no mutation at all.

## Availability

Unchanged and canonical: the three states, `respond_to_attendance`, and
`get_my_players_for_fixture` deciding `can_respond` per child. A guardian's own
child is still returned for their own match (the half a blunt boundary fix would
have broken). **No notification is created from the Match Centre** — the
availability → staff notification architecture is P5's, and nothing here
anticipates it.

## Dead field removed

`AgendaItem.childAvatarUrl` had one definition, two always-`null` writes and no
reader anywhere in either client. Removed, along with the now-dead `avatarUrl` on
the loader's internal family shape. `FamilyProjection` is the one authority for how
a child is drawn.

## Focused results

- **100 JS suites — 988 assertions, 0 failing**, including the new
  `participant_routing` (20): every entry point, both layers, the Training Centre's
  gates, the read-only Calendar and the family filter.
- **`supabase/tests/participant_route_authority.sql` — 25 assertions, all pass.**
  Registered `CANONICAL_GATE`. Self-seeding and rolled back, which matters here:
  the review world contains **no fixture outside any UAT family**, so this boundary
  can only be proved against data a test owns.
- Structural guards all pass (availability one-product now 1703 checks).
- Typecheck web + app clean; no new lint problem; `expo export --platform ios` builds.

## RED — asked of the server, as the real people

| | Expected | Actual |
|---|---|---|
| `can_manage_fixture`, guardian on own child's match | false | **false** |
| `can_view_participants`, guardian | false | **false** |
| `can_message` (club-to-club thread), guardian | false | **false** |
| guardian cancels the fixture | refused | **refused** |
| guardian cancels the training session | refused | **refused** |
| `can_manage` / `can_view_register` on training, guardian | false | **false, false** |
| another family's fixture → any capability | false | **none at all** |
| another family's fixture → children returned | 0 | **0** |
| own child on own match still returned | ≥1 | **1** |
| opposition contacts, guardian | 0 | **0** |
| "Fixture contact" candidates, guardian | 0 | **0** |
| `may_direct_message(guardian → other-club staff)` | false | **false** |
| opening that conversation by id | refused | **refused** |
| people the guardian may message | ≥1, own club | **8, all own club** |
| any of them outside the family's clubs | 0 | **0** |
| `is_adult_messaging_user(U18 player)` | false | **false** |
| U18 `may_direct_message(coach)` | false | **false** |
| U18 recipient list | 0 | **0** |
| U18 opens a conversation with the coach | refused | **refused** |
| `can_manage_fixture`, U18 player on own fixture | false | **false** |
| **club admin on their own club's fixture** | **true** | **true** |
| club admin may manage the training session | true | **true** |

## Physical iPhone walkthrough

Sign in as `uat.guardian.one` (Cara · Freddie · Reece) unless stated.

| # | Step | Expect |
|---|---|---|
| 1–4 | Home → tap the upcoming match | Match Centre. No kick-off/venue/pitch editing, no cancel, no opposition contacts, no "Fixture Details" |
| 5–7 | Fixtures → `All` / first child / second child | rows narrow; Filter has **no "Our Team"** section |
| 8–10 | Open an upcoming match, then switch to Past | Match Centre both times |
| 11–14 | Calendar → tap a match → back | **Match Centre** |
| 15–17 | Calendar → tap training | **Training Centre**, every field read-only, no cancel, no register |
| 18–21 | In Match Centre | opponent, H/A badge, date, kick-off, meet time, venue; the child named and pictured; their availability answerable |
| 22 | Look for any way to the opposition | none: the opponent's name and crest are not tappable |
| 23–26 | Hunt for fixture or training administration | none from any participant surface |
| extra | Header bell → an availability notification | **Match Centre**, not the console |
| extra | `uat.manyhats` → switch to Club Admin → tap a match | the **console**, with its controls, unbroken |

Physical acceptance is yours. Nothing here claims it.

## Remaining debt

- **The two fixture surfaces are still two component trees.** One canonical
  address now chooses between them by server authority, which is the boundary; the
  web's single role-aware tree is P4's convergence.
- **The U18 fixture-route case could not be exercised on review data.** The one
  minor with a login plays for Under 16 Boys, which has no fixtures. It is proved
  in the self-seeding SQL suite instead (F1, F6, F7) and structurally in JS.
- **`+not-found` recovery handles only conversation intents.** Converging it onto
  the destination table would *add* fixture routing where none exists; left alone
  deliberately.
- **`AgendaRow`'s `showOwner` prop is unused** and predates P2.
- **`verify-recipient-audience-boundary`** still fails pre-existing at `HEAD` on
  `redeem_invitation`. Not weakened, not suppressed, not fixed (§19).
