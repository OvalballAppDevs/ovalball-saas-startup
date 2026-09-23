# P2 — Parent/Guardian Home

The daily starting point for managing a child's rugby. Banked locally; nothing
pushed, deployed or released, and **no migration and no SQL of any kind**.

## The three questions, in the order they matter

```
NEEDS ATTENTION   only when something can actually be acted on
NEXT UP           the one thing to get ready for
THIS WEEK         the rest, grouped by day
```

All three are derived by `projectParentHome` from **one** read of the canonical
family agenda, so the headline, the attention list and the week cannot disagree
about the same match — and none of them can disagree with the website.

## Convergence audit

| Element | Class | Outcome |
|---|---|---|
| Whose rugby a family sees | **A** | `resolveFamilyScope` → `FamilyProjection` (P1), consumed unchanged |
| Fixtures, training, opponent, home/away, status, per-child attendance | **A** | `loadAgenda` / `AgendaItem`, consumed unchanged |
| The rugby week's boundaries | **A** | `resolveWindow("week", …)` — Monday to Sunday, the Calendar's own resolver |
| "Does this still need an answer" | **B** | `lib/parent/agenda-model.ts` → `packages/contracts/src/parent/agenda-model.ts`, plus a new shape-generic `needsAttendanceResponse` that the website's own `outstandingResponseEvents` now calls |
| The family read horizon | **B** | the dashboard panel's literal 120 days became `FAMILY_HORIZON_DAYS` |
| The question a person is asked | **A** | `availabilityQuestion` (M6) — "Can Pippa make it?", "Can Pippa make training?", "Can you make it?" |
| A child's name, picture, initials | **C** | were being rebuilt per screen; now `FamilyProjection` via one `ChildMark` |
| Where an event opens | **C** | five hand-built paths became one `src/links/destinations` table |
| Day words (Today/Tomorrow/weekday) | **B** | `dayLabel` in the shared projection, replacing a per-screen formatter |
| A parent payment/subscription action | **D** | **does not exist canonically** — reported, not invented |
| A parent "acknowledge this change" action | **D** | **does not exist canonically** — cancellation is shown as status, not as attention |

## Needs Attention — source and rules

One canonical kind: **an outstanding availability answer**. The rule is
`needsAttendanceResponse`, the identical function behind the website's own count:

- not yet answered — **Unsure is an answer**, so nobody who replied is chased;
- **not cancelled** — a cancelled match is not a commitment;
- **not past, and within `ATTENDANCE_HORIZON_DAYS` (14)**.

Each outstanding answer is its own row, naming its own child with their own
picture, and opening that event. Urgent within 3 days — order first, colour
second.

**Deliberately absent.** Unread messages (were the first row before P2 — removed;
a badge already says it). Unread notifications (**read is not resolved**). A
squad's outstanding answers in a family context — that is a coach's question, and
it is gated on the context rather than on the server happening to refuse.

**A guardian link request is not parent attention.** It reads like one, and
`internal.can_decide_guardian_link_request` requires `family.relationship.approve`
at the **club** — so the queue belongs to a Club Admin or Safeguarding Officer,
and it excludes the requester and the subject. I built it, proved it against the
live database, found it was club authority, and removed it.

## Next Up

The soonest event at or after today whose status is not `Cancelled` — match or
training, from the same rows, no per-type query. A cancelled match stays plainly
on the week's list (it is the reason nobody drives to the ground) but never takes
the headline. Nothing upcoming is an ordinary answer.

The card carries: the child, our side, the opponent, home/away as the canonical
letter badge, the date, kick-off, meet time where published, the venue, the
canonical status, and **the child's own answer** — stated, not answerable here.

## This Week

Today to Sunday of the canonical Monday-start week. Grouped by day, days with
nothing in them omitted; within a day by time then by child. Today and Tomorrow
are named; the rest carry their weekday. Next Up keeps its chronological place and
is marked "Shown above" rather than removed, so no day is left with a hole.

## Family filtering

`FamilyProvider` (P1) unchanged. Several children → `All · Pippa · George`; one
child → no selector at all. `narrowToChild` is a **subtraction over rows the read
already returned** — there is no query for a selection to widen — and the id has
already been normalised against the projection, so an out-of-scope id empties the
screen rather than widening it. Every child-specific row leads with the child's
own name and picture; no row asks the parent to infer a child from an age grade.
There is no team or age-group selector.

## Event → participant centre

| Event | Viewer | Destination |
|---|---|---|
| Match | parent · family · player | `/fixtures/[fixtureId]/match-centre` |
| Match | team · club · site admin | `/fixtures/[fixtureId]` (the console, where administration lives) |
| Training | anybody | `/calendar/training/[sessionId]` |

Decided once in `src/links/destinations`, now also used by Fixtures, the Calendar
(grid, week list and week sheet), the notification list and the deep-link handler.

**Two defects this closed.** Every list sent *everybody* to `/fixtures/<id>` — on
this client the fixture console — so a parent tapping their child's match landed
in fixture administration. And the Match Centre offered "Fixture Details" to
everyone "because the console is itself capability-aware"; that was the wrong
test, so the offer now follows the server's own `can_manage_fixture`.

## Loading, error and refresh

Skeletons in the shape of the answer, never a flash of empty state. The summary is
cleared **before** every re-read, so a child switch cannot leave George's match
under Pippa's chip — the same rule P1 set for context switches. Needs Attention is
not rendered at all until the data is in, because a panel that is sometimes wrong
is one people stop reading. A failed read **clears** the summary rather than
leaving an unconfirmable kick-off on screen, and is stated once rather than under
three headings. Pull-to-refresh re-reads context and summary. `useFocusEffect`
re-reads on return, so answering in the Match Centre removes the attention row —
no local state is written to paper over it.

## Focused proof

- **100 JS suites — 968 assertions, 0 failing**, including the new `parent_home`
  (42) covering Next Up, the attention rules, the week, day words, one-child,
  multi-child All, each child alone, an invalid child id, and every destination.
- **Structural guards:** content standard, identity presentation, Match Centre
  shared, Training Centre shared, Event Centre shared, availability one-product
  (1687), messenger/notification architecture, mobile messenger scope (318),
  notification catalogue (86/86/86), contact safety, authority guards, fixture
  bulk authority, both registries — all pass.
- **Typecheck:** web clean, app clean. **Lint:** no new problem in any P2 file.
- **Bundle:** `expo export --platform ios` succeeds.
- **Authority:** no SQL changed, so the P1 RED evidence stands unchanged.
- **Known, recorded, untouched:** `verify-recipient-audience-boundary` still fails
  at `HEAD` on `redeem_invitation`. Not weakened, not suppressed, not fixed.

## Physical iPhone walkthrough

Today is **2026-09-23**, so the week runs Mon 21 – Sun 27.

| # | Sign in as | What to look for |
|---|---|---|
| 1 | `uat.guardian.one` | Home loads: greeting, chips, Needs Attention, Next Up, This Week |
| 2 | — | Header still Messages · Notifications · Support with independent badges |
| 3 | `uat.manyhats` | **One child (Ava)** — no child selector at all |
| 4 | `uat.guardian.one` | **Three children** — `All · Cara · Freddie · Reece`; every row names its child |
| 5 | — | Tap the first child: Next Up, This Week and Needs Attention all narrow |
| 6 | — | Tap the second: the first child's rugby is gone, not merely reordered |
| 7 | — | Needs Attention reads "Can *name* make it?" / "make training?" — 3 outstanding within 14 days |
| 8 | — | Next Up: club colours, opponent, H/A badge, date, time, venue, and the child's own answer |
| 9 | — | This Week: day headings, `Shown above` on the Next Up row |
| 10 | — | Tap a match → **Match Centre** |
| 11 | — | Tap training → **Training Centre** |
| 12 | — | No kick-off editing, no cancel, no venue/pitch change, no opposition contacts, no "Fixture Details" row |
| 13 | — | Pull down: refreshes without flashing empty |
| 14 | — | Cold open: skeletons in the answer's shape |
| 15 | `uat.manyhats` → Club Admin | Switch context: the staff Home returns, with the squad's outstanding answers |
| 16 | — | 390pt and 320pt: no horizontal scroll, safe areas respected, one-handed reach |

Empty states are not reproducible against this data without removing a family's
fixtures, which I have not done to the review world.

Physical acceptance is the owner's. Nothing here claims it.

## Remaining debt

- **The app carries two fixture routes where the web has one.** The canonical rule
  is one role-aware Match Centre with staff controls integrated; this client split
  it into a Match Centre and a console at M4. P2 routed each viewer to the right
  one and closed the cross-link; **converging them is P3/P4 work** and was not
  reopened here.
- **No canonical parent payment/subscription attention item exists.** The
  website's family dashboard exposes none. Not invented (§15).
- **No canonical "acknowledge a change" state for a parent.** A cancellation is
  shown as status — struck through, dimmed, and the word — not as attention.
- **Availability answered on a phone still notifies nobody on the staff side.**
  Owner-scheduled for P5; not worked around.
- **`AgendaItem.childAvatarUrl` is always null** from `loadAgenda` and is now
  fully superseded by `FamilyProjection`. A dead field, safe to retire in a later
  pass.
- **`AgendaRow`'s `showOwner` prop is unused** and predates P2. Left alone.
- **`verify-recipient-audience-boundary`** — pre-existing, recorded, untouched.
