# P4 — Family Calendar and participant Training Centre

Banked locally. No migration and no change to any SQL function; the only SQL
touched is the self-seeding, rolled-back authority suite.

## The Calendar, built to the owner's reference

A dark forest plate carrying the month, and a light sheet of the chosen day's
rugby lifted over it.

```
 October 2026                      ( ‹ ) ( › )     forest-900 plate
 MON TUE WED THU FRI SAT SUN                       Monday first
  28  29  30  01  02  03  04                       spill days dimmed
                       ●●                          ● played  ● trained
  05  06  07  08  09  10  11
      ○                                            ○ hollow = cancelled
 ┌──────────── ▂▂▂ ────────────┐                   chalk sheet, lifted
 │ SATURDAY · 3 OCTOBER         │
 │ ┌─────────────────────────┐  │
 │ │ 10:30  A  🛡  Pippa      │  │                 one card per event
 │ │           v Ashton …     │  │
 │ └─────────────────────────┘  │
```

The reference's navy became forest, its orange became `pitch-600`, and the
weekday row starts on **Monday** — the platform's rugby week (Tuesday's training
through Sunday's match), which the Calendar has always used. Say the word and it
becomes Sunday-first; it is one constant.

**Today is a ring, the day you are reading is a filled disc.** Two questions,
two marks. A "Today" pill appears only when you are not already there.

**Dots are a summary, never the answer.** One for rugby played and one for rugby
trained — never one per event, because four dots under a two-digit number is a
smudge. A day with a cancellation draws a **hollow** dot, so the difference
survives greyscale, and the spoken label says "3 October, matches and training,
something cancelled". Tapping the day gives the words.

**Week mode is gone.** A month grid contains every week and its strip was the
same information in more space; two date pickers on one screen is one too many.
**Season stays** — "what has this side got on all year" is a different question
and the canonical register is its own authority.

## Date and range strategy

One bounded read of **exactly the forty-two days the grid draws** — the Monday on
or before the 1st to the Sunday on or after the last. Reading only the calendar
month would leave the spill days dotless while their numbers sat on screen, which
reads as "nothing on" rather than "not asked". One scope, one window, one query:
no request per day, none per child, no unbounded history. Stepping month asks
once more. Season mode keeps the register's own dates.

`monthCells`, `monthWeeks`, `monthLabel`, `marksByDay` and `nextDayWithSomething`
are **pure and shared** (`packages/contracts/src/agenda/month-grid.ts`), so which
squares October occupies is assertable without a renderer.

## Family filtering

Unchanged from P1/P3: `All · Pippa · George` from `FamilyProjection`, absent for a
parent of one, no team or age-grade selector in a family scope. The dots follow
the narrowing, so a day filtered down to nothing stops advertising itself — the
grid and the sheet are two views of one list and must never contradict each other.
A child switch is pure subtraction over rows already read, so no cross-child flash
is possible: there is no second load to flash during.

## Event types

Match and Training — what the canonical shared agenda contains.

**Reported, not built:** the web's calendar page reads three more sources of its
own — `club_events` (with an Event Centre at `app/(app)/events/[eventId]`),
`competition_editions` and `club_visible_tournaments`. None reaches the shared
`loadAgenda`, so the app carries none of them. **Nothing is routed to an editor,
because nothing is carried at all** — this is an absence, not a boundary problem.
Adding them means a third `AgendaItem.kind`, which flows into the web's Agenda and
Team pages too, so it is a deliberate extension rather than P4 scope (§13).

## Destinations

Unchanged from P3 and consumed from the same one table: match → Match Centre for
parent/family/player, the canonical authority-aware address for staff; training →
Training Centre for everybody. The Calendar now has three ways into an event (day
cards, season list, week sheet) and **one** `routeForAgendaItem` call.

## Training Centre

**One surface, role-aware** — the canonical shape, not two products.

Participant: the child and their own answerable availability inside the hero, the
cancellation banner, When (date, start, ends), Where (venue, pitch, Directions),
The Session (agenda, notes), and now **Message Team Staff**.

**The administrative half is now a component that is not mounted without the
server's answer.** Until P4 all five edit sheets sat in every viewer's tree and
the two reads that fill them — `loadVenueOptions`, `loadPitchOptions` — were made
for parents whose screen had nowhere to put the answer. Nothing was ever drawn,
because each row's press target is gated on `can_manage` and a non-editable row
renders no chevron. But §10 asked exactly the right question, and the answer was
yes: the components were assembled. Now `TrainingOperations` renders only inside
`{session.canManage && (…)}`, and it fetches the grounds and pitches itself when
it mounts. **The URL still does not grant the surface, and now it does not
assemble it either.**

## Availability

The same canonical product as Home, Fixtures, Match Centre and the web:
`respond_to_training_attendance`, three states, `can_respond` and
`denial_reason` per child from the server.

**New:** `attendanceConfirmation` in the shared availability contract —
> "Pippa can attend training on Saturday 18 October at Prairie Playing Fields."

A statement about the child (owner decision O-4), from canonical values only, and
**it never claims anybody has been notified** — a test asserts the sentence
contains no "notified", "told", "coach", "sent", "alerted" or "saved". Turning an
answer into a staff notification is P5's, and P4 builds no substitute.

## Training communication

Identical to Match Centre's: a shortcut into the canonical chooser, which is
`my_direct_message_candidates()` and therefore `internal.may_direct_message`. No
recipient resolved here, no id constructed, **no participant directory** — being
at a training session has never been authority to message anybody. Absent when the
canonical list is empty, which is what an under-18 player gets. Training carries no
opposition for one to arise from (`them` and `homeAway` are null by construction).

## Multi-child collisions

Pippa trains at six, George plays at half past. Two events, never merged — proved
for different times and for the identical minute. Each row resolves **its own**
child through `memberFor(projection, item.playerId)`, so Pippa's photograph cannot
appear on George's row, and each keeps its own side so a crest cannot cross either.

This is reviewable on the real data: **today, 23 September, has two 18:00 sessions
— Under 12 Boys and Under 8 Mixed — and `uat.guardian.two` has a child on both.**

## Loading, error, refresh

Pull-to-refresh and focus-return refresh. Cleared on a context change, never on a
date change — moving to November should not blank the screen. A failed read keeps
what is on screen and says so ("Offline — showing the calendar as it was") rather
than presenting it as confirmed. Stepping month moves the sheet with it, so grid
and list never describe different months.

## Focused results

- **101 JS suites — 1028 assertions, 0 failing**, including the new
  `family_calendar` (40): the grid's shape, the dots, the empty day, the
  collisions, the child filtering, the read strategy, the confirmation sentence,
  the Calendar's inability to edit anything, and the Training Centre's mount gate.
- **`participant_route_authority.sql` — 40 assertions, all pass** (25 from P3, 15
  new for training). Registered `CANONICAL_GATE`, self-seeding, rolled back.
- Structural guards pass; typecheck web + app clean; no new lint; iOS bundle builds.

## RED — asked of the server

| | Expected | Actual |
|---|---|---|
| guardian sees their own child on their own child's session | ≥1 | **1** |
| …and the session card itself | yes | **yes** |
| guardian on another family's side's session → children | 0 | **0** |
| …and the session card for it | refused | **refused outright** |
| guardian moves the session to another day | refused | **refused** |
| …changes its start time | refused | **refused** |
| …moves it to another ground | refused | **refused** |
| …rewrites the session plan | refused | **refused** |
| …cancels it | refused | **refused** |
| **guardian answers for their own child** | **allowed** | **allowed** |
| guardian answers for another family's child | refused | **refused** |
| U16 player manages their own session | false | **false** |
| …cancels it / moves it | refused | **refused, refused** |
| **club admin may rewrite the session plan** | **allowed** | **allowed** |
| club admin `can_manage` / register | true | **true, true** |

Plus every P3 boundary re-run unchanged: parent → opposition refused four ways,
U18 → coach refused five ways, parent `can_manage_fixture` false, another family's
fixture yields nothing, club admin keeps the console.

## P3 regression

Calendar match → Match Centre; parent cannot reach the fixture console; the
console is still unaddressable; opponent still informational with no handler on it.
All re-asserted in `participant_routing` (20/20).

## Physical iPhone walkthrough

Sign in as **`uat.guardian.two`** — children on Under 12 Boys *and* Under 8 Mixed.
Today is **23 September 2026**.

| # | Step | Expect |
|---|---|---|
| 1–3 | Open Calendar | forest plate, "September 2026", today ringed and selected, dots on the 23rd |
| 4–7 | `All` → first child → second child → `All` | dots and cards follow; **no team selector in Filter** |
| 8–9 | `›` to October, then the **Today** pill | October's grid; back to the 23rd |
| 10 | The 23rd | **two 18:00 sessions, two cards, two different children** |
| — | The 13th of October | a **cancelled** fixture: hollow dot, struck-through row, the word |
| — | Any quiet day | "Nothing on this day" and a button to the next day that has something |
| 11–13 | Tap the fixture on the 25th | Match Centre, no editing |
| 14–20 | Back → tap a session | Training Centre: child, team, date, times, venue, Directions, agenda/notes **all read-only, no chevrons, no Cancel** |
| 21–22 | Answer availability | the three states; then "*name* can attend training on …" — and **no claim anybody was told** |
| 23–24 | Message Team Staff | opens the canonical chooser; no attendee list anywhere |
| 25–26 | Pull to refresh | no stale flash, no cross-child flash |
| extra | `uat.manyhats` → Club Admin → same session | edit rows, chevrons and **Cancel Session** all present and working |

Physical acceptance is yours. Nothing here claims it.

## Remaining debt

- **Club events, competitions and tournaments are not on the app's calendar.**
  Three canonical sources the web calendar reads. Reported above; a deliberate
  shared-contract extension, not P4 scope.
- **The month grid is Monday-first** where the reference is Sunday-first, to match
  the platform's rugby week. One constant if you want it changed.
- **No native Event Centre**, because no event type reaches the app yet.
- **Two fixture component trees behind one address** — still P4+ convergence debt
  from P3; the boundary is the address, which holds.
- **`AgendaRow`'s `showOwner` prop is unused** and predates P2.
- **`verify-recipient-audience-boundary`** unchanged, pre-existing, not weakened,
  not suppressed, not fixed (§25).

---

# P4 visual rebuild — built to the approved mockup

The earlier P4 pass got the model right and the composition wrong: a white header,
a white season dropdown, a white Pre/Main bar, a white mode selector, then a green
calendar, then a white panel. Six surfaces for one screen. That is gone.

## The structure now

```
┌─────────────────────────────────┐
│ FOREST  (one ground, top to sheet)
│  ◯ avatar   Under 12 Boys  ⌄    💬 🔔 ?   ← same P1 header, forest tone,
│             Ovalball UAT RUFC               no white card, no rule
│                                 │
│  September 2026          ( ‹ ) ( › )      ← 26pt, round pitch-600 steps
│                                 │
│  [  Month  |  List  ]           │        ← low dark segmented surface
│                                 │
│  MON TUE WED THU FRI SAT SUN    │        ← faint, letter-spaced
│   31   1   2   3   4   5   6    │
│    7  (8)  9  10  11  12  13    │        ← ● dot under a busy day
│   14  15  16  17  18  19  20    │
│   21  22 ⟨23⟩ 24 ⟦25⟧ 26  27    │        ← ⟨⟩ today ring · ⟦⟧ selected disc
│   28  29  30   1   2   3   4    │        ← spill days faint
│  [ All ][ Pippa ][ George ]     │        ← chips on forest, outlined
├──────── ▂▂▂ ────────────────────┤        ← chalk sheet, r26, lifted 12pt
│ Friday · 25 September   2 events│
│ ┌─────────────────────────────┐ │
│ │ 10:30  (crest)  v Ashton …  │ │
│ │ meet            ⬭ Under 12  │ │
│ │ 09:45           ⚲ Ashton  A ›│ │
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ 18:00  (squad)  Training …  │ │
│ └─────────────────────────────┘ │
├─────────────────────────────────┤
│ Home Fixtures ▮Calendar Hub More│        ← already deep forest, pitch-400
└─────────────────────────────────┘          active with a top indicator
```

## Components introduced

| File | What it is |
|---|---|
| `components/calendar/calendar-chrome.tsx` | `CalendarHeading` (month + round steps) and `CalendarModeSwitch` |
| `components/calendar/month-grid.tsx` | `MonthGrid` and `CalendarDay` |
| `components/calendar/event-sheet.tsx` | `EventSheet`, `EventCard`, `CalendarEmptyDay`, `ListDayHeading` |
| `components/participant/event-hero.tsx` | `EventHero`, `ParticipantActionCard`, `ParticipantSheet` |
| `SeasonSheet` (in the Calendar) | the season and its phase, as a sheet |

`month-calendar.tsx` from the first pass was deleted, not left beside its
replacement. The old `WeekStrip`, `emptyTitle`, `startOfWeek`, `shift` and the
Training Centre's `Shell` went with the things that used them.

## Controls removed or repositioned

| Was | Now |
|---|---|
| White season dropdown, permanent | A chip beside the month → `SeasonSheet`. **Not offered at all to a family.** |
| White Pre / Main segmented bar, permanent | Inside that sheet, and only where the register records a pre-season |
| White Week / Month / Season selector | `Month | List` on forest; Season is a third segment **only** outside a family |
| White header with a bottom rule | The same header, forest, no card, no rule |
| White "Today" pill + white "Filter" pill above the grid | Today is the ring in the grid itself; Filter opens from the sheet's own controls |
| Bordered day list under a repeated date heading | Cards on the chalk sheet, under one date heading |

**Nothing was deleted blindly.** Season selection, the pre-season phase, the
season overview grid, the filter and the week sheet all still work; they stopped
being furniture. Pre/Main is hidden from a parent because it is a distinction a
club draws for its own planning — a guardian checking Saturday has no use for it.

## Month / List

One read, one model, one set of rows narrowed by the one family filter — two ways
of looking at them. Month is the grid with the selected day beneath it; List is the
same rows from today onward, grouped by day, using the **same `EventCard`**. A test
asserts there are exactly two `readAgenda` calls on the screen (the month and the
season) so a third data path cannot appear behind the toggle.

## Date states

Faint spill days · light in-month days · **today: a 1.5pt pitch-400 ring** ·
**selected: a filled pitch-600 disc with forest ink** · **both: the ring around the
disc**, one combined mark · **a dot** under any day with something, drawn in the
disc's own ink when it falls on the selection · **hollow** where something that day
is cancelled. Each day's spoken label is "23, today, matches and training" — the
fact, never the decoration.

## Event sheet and cards

26pt top corners, a 38×4 handle, lifted 12pt over the forest. The heading is the
selected day in words with the count on the right. Cards are `surface.card` on
chalk with a hairline, `radius.lg`, 16pt gutters.

Each card: kick-off with **meet time beneath it where the club has set one** · a
round mark (the opposition's crest where there is one, else a rugby ball; a squad
glyph for training) · the opponent or "Training Session", the side, the venue, the
canonical status in words · the H/A badge · a chevron. In a multi-child view the
`ChildMark` leads the text block, resolved through `memberFor` — a test asserts the
card reconstructs no name, initial or avatar of its own.

**Cancelled** is struck through, dimmed to 0.66, and written in words.

## Training Centre

Forest hero: back · "Training Centre" · the three header utilities. Then the event
mark, the side and child, "Training Session", and the canonical status pill.
Beneath: the date, the times, and the venue with "View on map".

**No stock photograph.** The mockup has one; Ovalball has no picture of this club's
training, and somebody else's rugby on a page about your child is worse than none.
A test forbids `ImageBackground`, `require(` and remote image URLs in the hero.

**No "Arrive from".** The mockup shows one. `meet_time` is a **fixture** column —
`training_sessions` has no arrival field, no RPC for one and no product concept of
one. A time no coach set is worse than no time. Tested.

Then the chalk sheet: the **availability answer first**, because it is what a parent
came for; then `Message Team Staff`, `Training Information`, `Location` as uniform
`ParticipantActionCard`s. No tabs were invented — there is not enough content for
three, and §18 said not to imitate them for their own sake.

## Availability

The shared canonical control gained a **light ground** (`ANSWER_ON_LIGHT`) so it can
sit on the chalk sheet — same three answers, same words, same order, same icons,
same `AVAILABILITY_ANSWER_ORDER`. Selection carries an icon, the words, a filled
ground and `accessibilityState.selected`; never colour alone. Confirmation wording
is unchanged and still claims no notification.

## Tokens

New in `design/tokens.ts`: `surface.{forest,forestRaised,chalk,card}`,
`onForest.{primary,secondary,faint,line}`,
`calendarTone.{selected,selectedInk,today,eventDot,control,controlInk}`,
`statusOnForest.{calm,warning,danger}`. **Every one is drawn from the existing
`colour` palette — no new green.** A test asserts the five new view files contain
**zero** hex literals.

## Accessibility

44pt+ targets throughout (day cells are 46pt tall and a seventh of the width);
`accessibilityRole` on every control; day labels speak the facts; the availability
control announces "I'm Available — Pippa, training on Saturday"; safe-area insets
top and bottom; no horizontal scroll at 320pt (the grid is flex-distributed and the
card's text block is `minWidth: 0`); Dynamic Island cleared by `insets.top`.

## Focused tests

**102 suites, 1042 assertions, 0 failing** — `family_calendar` now 54, including
fourteen that lock the approved composition. Structural guards pass (availability
one-product 1729 checks — it caught a real collision, a hero reading "Not
available" against the canonical availability word, now "Session unavailable").
Typecheck web + app clean. No new lint (the 5 errors are pre-existing web files).
iOS bundle builds.

## The floating blue gear

Not Ovalball. The app bundles no `expo-dev-client`, `expo-dev-menu` or
`expo-dev-launcher`, and there is no app-owned floating control anywhere in
`apps/mobile` — the only absolutely-positioned elements are badges, sheets,
backdrops and the launch canvas. It is the **Expo development launcher**, present
in Expo Go and development builds and absent from a production build. Per §27 it
has not been removed or suppressed: it is legitimate development tooling.

## Owner visual review

| | Screen | Use |
|---|---|---|
| A | Month, one event | any Friday with a single fixture |
| B | Month, multiple events | **23 September** — two 18:00 sessions |
| C | Month, empty date | any quiet weekday; check the "Go to …" button |
| D | Multi-child, All | `uat.guardian.two` |
| E | One child | tap either chip |
| F | List | the toggle's second segment |
| G | Training Centre | tap a 23 September session |
| H | Availability selected | answer, then read the confirmation |
| I | Back to Calendar | no stale child, no white strip |

## Remaining visual debt

- **Match Centre still has its own older treatment.** §21 said not to redesign it
  in P4; the hero/sheet/action-card language is now reusable for it.
- **No tabs on the Training Centre** (Overview / Availability / Information) —
  deliberate, per §18.
- **No arrival time for training** until the platform has one.
- Fixtures and Home keep the chalk header; only the Calendar and the Training
  Centre are forest so far.
