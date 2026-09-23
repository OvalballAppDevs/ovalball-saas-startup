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

---

# P4 visual correction — the premium participant cards

The Calendar composition stayed exactly as approved. What changed is what lives in
the selected-day sheet: the compact text row is gone and there is one premium card
per event, crest against crest.

## Architecture — one model, two densities

**The truth is resolved once**, in `packages/contracts/src/participant/match-card.ts`:

```ts
projectParticipantMatch(item, family) -> ParticipantMatch {
  home, away, oriented, ourOrientation,   // canonical home/away
  classification,                          // "Union · U12"
  kickoff, meetTime, venue, status, cancelled,
  child, attendance, attendanceWord, answered,
  spoken                                   // the whole card as one sentence
}
projectParticipantTraining(item, family, endTime) -> ParticipantTraining
```

**The component chooses the density**: `<ParticipantMatchCard density="compact" />`
today, `"expanded"` reserved for the Fixtures pass — so that screen inherits the
same answer rather than working out home and away a second time. That is the whole
point: which side is at home is a domain question with one answer, and two
components each deciding it is how a parent gets told they are playing at home when
they are not.

**Fixtures was not touched** (§17). Only the shared model exists for it.

## Crest against crest, and the ordering

`homeAway` is the viewer's own side's orientation, so **Home puts our side on the
left and Away puts the opposition there**. A test asserts the two produce different
left-hand clubs — "our team first" would pass a weaker test and be wrong.

Where the orientation is genuinely unsettled — `TBD`, `Not Applicable`, null — the
card **claims nothing**: both sides are drawn, no ground is implied, and the spoken
label omits the orientation entirely.

Crests come from the canonical `ClubCrest`: the club's own upload, else the Club
Directory's branding logo, else initials on a neutral ground. There is no
`fallback` prop, so a kit cannot reach where a crest belongs. A test asserts the
card file contains no reference to a kit at all. **On your review data no opposition
has a crest**, so the initials fallback is what you will see — and it is meant to
look deliberate.

## Classification

`Union · U12`, from two canonical fields: `teams.rugby_code` and the compact team
identity. `rugbyCode` was added to `AgendaSide` and to the agenda's own team select
— one column, additive, nothing switches on it. Where either is absent (a Club
Directory opponent, free text typed by a fixture secretary) the missing half is
dropped and nothing is parsed out of a name. `matchClassification(null) === null`.

## KO · Meet · Venue

A wrapping row beneath the crests. Each appears **only where the club has set it** —
no "Meet —", no fabricated venue — and the row reflows rather than crushing on a
narrow phone. Kick-off is `type.smallMedium` in ink; meet and venue are captions in
muted ink.

## The child strip

Bottom third of every card, on chalk so it reads as its own band: the child's own
picture and name from `FamilyProjection`, their side beneath it, the availability
chip, and the chevron. Absent entirely where the row belongs to no child. A test
asserts the card performs no `split`, `toUpperCase` or `slice` — it draws what the
projection handed it.

## Availability — one note you should see

The chip carries an **icon, the word and a tone**, never a tone alone.

**The words are the canonical register words**: `Attending` · `Unsure` ·
`Can't attend` · `Awaiting` — not the mockup's "Can Attend" / "Cannot Attend".
That is not a preference: `verify-availability-one-product` **fails the build** on
the literal `"Can Attend"`, because the platform has been through "Can't attend",
"Can't make it" and "Cannot attend" all meaning one thing. If you want the chips to
read "Can Attend", the change belongs in
`packages/contracts/src/availability/vocabulary.ts` and it moves every surface at
once — say the word and it is one edit.

## Training card

Same frame, same child strip, no opposition — a session has none and is never given
a fake one. The **time leads** (22pt), with the window beneath where the record has
an end, then the title and the venue. `18:00 – ` never appears: no end, no window.

## Multiple events, multiple children

One card per event, always. No "+2 events" link. The sheet scrolls, the header says
"2 events", and each card names its own child — so a day holding Ava's match and
George's session is two cards with two faces, two sides and two answers. Tests cover
distinct children, distinct avatars (one has a photograph and one does not), and an
id outside the family drawing no identity at all.

## Accessibility

One tap target per card and **exactly one `<Pressable>`** — asserted — so no crest,
name, club or chip is independently tappable. That is what keeps the opposition
informational rather than relational.

The card's accessible label is the whole fixture as one sentence:

> "Ava, Under 12 Boys. Ashton Under Lyne RUFC Under 12 Boys versus Ovalball UAT RUFC
> Under 12 Boys. Away for Ovalball UAT RUFC Under 12 Boys. Kick off 10:30. Meet
> 09:45. Ashton Playing Fields. Attending."

Writing that test **found a real defect**: spoken as the team alone it read "Under
12 Boys versus Under 12 Boys", which tells a blind parent nothing. `spokenSideLabel`
now carries the club and the team, and says the club once where they are the same.

## Responsive cases covered

Short and very long opposition names (2-line wrap, no truncation in the model) ·
missing crest · missing meet time · missing venue · missing kick-off · one child ·
several children · all three answers plus no answer · cancelled · a non-`Booked`
status · home · away · unsettled orientation · two and three events on a day.

## Focused tests

**103 suites, 1069 assertions, 0 failing.** New `participant_match_card` (27) plus
`family_calendar` (54). Structural guards pass — availability one-product included,
which is the guard that enforces the chip wording. Typecheck web + app clean, no new
lint, iOS bundle builds. **No SQL touched**, so no RED suite was re-run.

## Physical review — what your data will show

| | Case | Where |
|---|---|---|
| 1 | One match | 2 Oct, 6 Oct |
| 2 | Match + training | **25 Sep** |
| 3 | Multi-child All | `uat.guardian.two`, 23 Sep |
| 4 | **Home** ordering | 2 Oct — our crest left |
| 5 | **Away** ordering | 25 Sep — opposition crest left |
| 6–8 | Can attend / Unsure / Can't attend | answer in a centre and come back |
| 9 | **Missing opposition crest** | every fixture — none has one |
| 10 | Long opposition name | "Ovalball UAT Opposition RFC" |
| — | **No meet time** | 13 Oct, 20 Jan — the row simply is not there |
| — | **Cancelled** | 13 Oct — dimmed, the word, no confirmed kick-off |
| 11–12 | Tap → Match Centre / Training Centre | both |

## Remaining visual debt

- **Fixtures still uses the old row.** The expanded variant exists in the model and
  is unimplemented by design (§17).
- Match Centre keeps its older treatment.
- The chip wording differs from the mockup, enforced by the availability guard —
  see above.

---

# P4 — event separation, club-first identity, and canonical classification

## 1. Event separation

A 4pt accent down the left edge of each card, inside the card's own boundary:
**green (`pitch-600`) for a match, blue (`messengerBlue`) for training** — the
app's established second colour, already used by the Away badge and a received
message. New semantic token `eventTone.{match,training}.{accent,surface,text}`;
the card file contains **zero hex literals** (tested).

**Colour is supplementary and never the answer.** Every card also carries the word
`MATCH` or `TRAINING`, its own icon, and a spoken label that names the kind. The
accent is a marker, not a block: four points of colour, and the card still belongs
to the same design system.

Cards keep their own hairline border, `radius.lg` and 8pt between them, so a day
holding match · training · match reads as three independent events.

## 2. Club-first identity

```
      [CREST]                           [CREST]
  Ovalball UAT RUFC      VS      Preston Grasshoppers RFC
     Under 12 Boys                    Under 12 Boys
```

The **club is the dominant line**; the side is beneath it, quieter. "Under 12 Boys
versus Under 12 Boys" identified neither club — now the crest and the club answer
"who", and the team answers "which of their sides".

**Home is still canonical.** The ordering comes from `fixtures.home_away`, not from
"our club first" — a test asserts Home and Away produce different left-hand clubs,
and an unsettled orientation (`TBD`, festival) claims nothing at all.

## 3. The child photograph — investigated, not patched

**A. The top-left photograph is the signed-in adult's.** `uat.manyhats` is
**Ffion Meredith**, whose `profiles.avatar_storage_path` is set. The header *title*
reads "Ava Whitaker" because a parent context is named after the child it is about;
the avatar beside it is the person, which is the locked platform rule.

**B. The Match Card row is the child**, Ava Whitaker, `players.id`
`d6b75b91-…`.

**C/D. Different entities, different buckets.** An adult's photograph is
`profiles.avatar_storage_path` in the public `avatars` bucket. A child's is
`players.avatar_storage_path` in the **private `player-avatars`** bucket, whose
policy resolves the canonical guardian relationship — asking for a signed URL *is*
the authorisation question.

**E. Nothing was lost in projection.** Queried as the guardian:

```
first_name | child_photo | my_own_photo
Ava        | (null)      | 00b56202-…/avatar-1790149260277.jpg
```

`players.avatar_storage_path` is **NULL for Ava**, and
`select count(*) from storage.objects where bucket_id='player-avatars'` is **0** —
**no child in the review world has a photograph at all.** So initials are the
correct rendering, and the chain
`players.avatar_storage_path → GuardianTeamContext → FamilyChild → FamilyProjection
→ ChildMark/child strip` carries no other source: a guardian's photograph cannot
reach a child's row, because the child's path is the only input.

**Conclusion:** there is no resolver to converge — there is one, and it is right.
If your device shows a photograph on the child row it is a stale bundle, because
the data cannot produce one. To see a real child photograph, upload one against the
**player** (Ava), not the account.

Nothing was patched locally and no image was copied from the header.

## 4. Canonical fixture classification — recovered, extracted, shared

**Traced:**

| Layer | What is there |
|---|---|
| Database | `fixtures.game_type text`, `CHECK (game_type IN ('Friendly','League Fixture','Cup Fixture','Scheduled Match'))` |
| Canonical list | `GAME_TYPE_OPTIONS` — was in `app/(app)/admin/fixtures/types.ts`, a Next.js route, unreachable from React Native |
| Presentation rule | `matchTypeLabel` in `lib/fixtures/presentation.ts` — returns the stored value, **no default**, because "a fixture with no match type recorded is not Friendly" |
| Web consumer | `app/(app)/admin/fixtures/fixture-table-row.tsx` |
| Competition | `fixtures.competition_edition_id` — a **separate** concept, not a match type |
| Other events | `fixtures.event_type` ∈ holiday · festival · vacant — a different axis again |

**Extracted** to `packages/contracts/src/fixtures/game-type.ts`; both web modules now
re-export from it, so nothing on the web changed. `gameType` rides on `AgendaItem`
from the same `fixtures` row.

**Web ↔ mobile is one record.** A Fixture Secretary changing a fixture on the web
from `Friendly` to `League Fixture` changes `fixtures.game_type`; the phone's next
canonical read returns the new value. No mobile copy, no sync table, no
`web_fixture_type`/`mobile_fixture_type` — a test asserts the app holds no list of
match types anywhere and that the value is not transformed on the way through.

**One note on wording:** the mock-up's chip says "League". The canonical value is
**"League Fixture"**, and `matchTypeLabel` shows the stored value verbatim — which
is the web's own rule. Renaming the taxonomy is a database CHECK constraint plus a
migration, not a card's decision. Your review data already covers `Friendly`,
`League Fixture` and **a fixture with none recorded** (20 Jan), which shows no chip
at all rather than guessing.

## 5. Focused proof

**103 suites, 1079 assertions, 0 failing** — `participant_match_card` now 37, with
new cases for the accents, the club-first ordering, the canonical taxonomy, the
absent-match-type case, and the extraction itself. Structural guards pass; both
typechecks clean; no new lint; iOS bundle builds. **No SQL touched**, so no
authority changed and no RED suite was re-run.

## 6. Owner review — what your data shows

| Case | Where |
|---|---|
| Match + training on one day, green and blue accents | **2 Oct** |
| `League Fixture` chip | 25 Sep · 2 Oct · 6 Oct |
| `Friendly` chip | 8 Sep · 13 Oct |
| **No match type recorded** — no chip | **20 Jan 2027** |
| Home ordering (our club left) | 2 Oct |
| Away ordering (opposition left) | 25 Sep · 6 Oct |
| Cancelled, no meet time | 13 Oct |
| Initials on the child strip | everywhere — no child has a photograph |

---

# P4 review fixes — permissions, venue, weather, avatar

Five reported issues. Root cause for each, then the fix.

## 1 & 2. Announce and Fixture Details for a parent

**Root cause: the capability is scoped to the PERSON, the surface never asked which HAT.**

`get_match_centre_capabilities(fixture)` answers *may this user manage this
fixture* — correctly. `uat.manyhats` holds **CLUB_ADMIN, FIXTURES_SECRETARY,
COACH and SAFEGUARDING_OFFICER** *and* guardians Ava, so it returns `t, t, t`
**whichever context they are standing in**. Operating as Parent/Guardian they kept
their coach's controls. Proved live:

```
manyhats  → can_view_participants t · can_message t · can_manage_fixture t
uat.guardian.two (pure parent) → f · f · f
```

**This was never an authority hole.** A genuine parent is refused every one of
these writes at the server — `participant_route_authority.sql` (40/40) proves it
again unchanged. It was a person being offered the wrong hat's controls.

**Fix:** `narrowCapabilitiesToContext` in `packages/contracts/src/participant/
match-centre-capabilities.ts`, applied in `loadMatchCentre` with the active
context. A family-facing context gets none of the three. **It can only ever
remove** — a test asserts nothing can turn a false into a true — so the database
remains the authority. A club admin switching back to their club context gets
everything back, because they really are a club admin.

## 3. "The venue hasn't been confirmed yet"

**Root cause: the Match Centre read `venue_id` alone.** That fixture has:

```
venue_id      = NULL
venue_address = "Ovalball UAT Opposition RFC, Lightfoot Lane, Preston, PR4 0TA"
```

— which is exactly what the Calendar was showing two taps away. One reader saw
three ways a fixture records where it is played; the other saw one.

**Fix:** `packages/contracts/src/fixtures/venue.ts`, applied in the platform's own
order:

1. the **explicit venue** (`fixtures.venue_id`) — a choice beats a default;
2. the **fixture's own address** (`fixtures.venue_address`);
3. the **home side's default ground** (`venues.is_default_home`), which for an away
   fixture is the **opposition's** — and where that side is only a Club Directory
   entry, the ground that entry records;
4. only then genuinely unconfirmed.

**Match Centre now shows the ground's NAME** — the address is no longer printed
beneath it, and **Directions still receives every line of it**, so navigation is
unchanged. The Calendar keeps its address line.

## 4. "Weather not available"

**Two causes, both real.**

**(a) The forecast route resolved coordinates from `venue_id` alone** — the same
narrow read, so any fixture recorded by address could never have weather. It now
calls the same resolver, so the page cannot name a ground the weather was never
asked about. A test asserts the route no longer queries `venues` itself.

**(b) The geocoding had never been run in this review world.** Every venue and
every directory row sat at `geocode_status = 'pending'` with no coordinates, and
the route correctly refuses coordinates without provenance — a number somebody
typed pins a rugby club on a football ground three kilometres away. I ran the
canonical backfill (`postcodes.io`, the same provider and the same columns Site
Admin → Clubs → Geocoding writes): **2 venues and 105 directory entries geocoded,
1 failed.** Note `Ovalball UAT Ground` moved from the seeded `53.7890, -2.2300`
to its real postcode position `53.819394, -2.234962` — the provenance rule doing
its job.

**Free text names a ground and locates nothing**, so for this fixture the name
comes from the typed address and the **coordinates from the opposition's geocoded
Club Directory entry**. `coordinateSource` records which, rather than implying the
typed line was geocoded.

**Verified end to end against the live route:**

```
GET /api/fixtures/b3db774a…/forecast
{"state":"FORECAST_AVAILABLE","forecast":{"forecastFor":"2026-09-25T09:00Z",
 "temperatureC":14,"conditionLabel":"Overcast","precipitationProbability":17,
 "windSpeedMph":4,"windDirection":"W","provider":"Met Office"}}
```

`TOO_EARLY_FOR_FORECAST` and `LOCATION_UNAVAILABLE` remain distinct states — this
fixture was never "too early"; it had no location.

## 5. Ava's avatar

**Traced rather than assumed, and the answer did not change.**

| Question | Answer |
|---|---|
| Who is the top-left photograph? | **The signed-in guardian** — `uat.manyhats` is **Ffion Meredith**, `profiles.avatar_storage_path` set, public `avatars` bucket. The header *title* says "Ava Whitaker" because a parent context is named after its child; the avatar is the person. |
| Who is the card row? | **Ava Whitaker, a child player** |
| Does Ava have a player photograph? | **No.** `players.avatar_storage_path` is NULL, and `storage.objects` in `player-avatars` is **empty — zero rows**. Confirmed while authenticated as the guardian. |
| Can a guardian's picture reach a child's row? | **No.** One path only: `players.avatar_storage_path → player-avatars (private) → FamilyProjection → ChildMark / child strip`. Tests assert the resolver never touches the `avatars` bucket and that no player surface can reach `person.avatarUrl`. |

**So initials are correct for Ava**, and they are correct consistently: the Match
Centre register is initials-only by design ("a register is not a gallery"). To see
a real photograph, upload one against the **player**.

**One genuine divergence found, and it does not affect Ava.** The *web* Match
Centre has a second legitimate rule mobile lacks: for an **adult** player,
`profiles.avatar_storage_path` may serve as their player avatar — never for a
child. Converging it means carrying `isAdult` and the account path through the
session context, which is a deliberate change rather than one to fold into a fix
batch. **Recommended as the next avatar item**; it changes nothing for any child.

## Proof

**104 suites, 1096 assertions, 0 failing** — new `match_centre_parent` (17).
`participant_route_authority.sql` **40/40 unchanged**. Structural guards pass (the
content standard caught a heading on the way through). Both typechecks clean, no
new lint, iOS bundle builds. **No SQL changed** — the geocoding is data written by
the canonical backfill, not schema.

## Acceptance checks

| Check | Result |
|---|---|
| No "Announce to the Squad" for a parent | ✔ narrowed by context |
| No "Fixture Details" for a parent | ✔ same gate |
| Direct calls permission-protected | ✔ a pure parent gets `f,f,f`; every write refused (40/40) |
| Away fixture resolves the opposition's ground | ✔ name from the fixture's address, location from their Directory entry |
| Match Centre shows the ground name, not the address | ✔ |
| Calendar keeps the address | ✔ unchanged |
| Weather resolves for 25 Sep | ✔ live Met Office forecast |
| Ava's avatar consistent across player surfaces | ✔ initials everywhere; she has no player photograph |
