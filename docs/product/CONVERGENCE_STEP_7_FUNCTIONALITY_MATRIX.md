# Convergence Step 7 — Fixture Operations functionality matrix

**BEFORE recorded at `1ba8366`, before any Step 7 behaviour change.**

The gate is §48: `FUNCTIONS AFTER >= FUNCTIONS BEFORE`, `FUNCTIONS LOST = 0`.
A function may move, be renamed, or be reached a different way. It may not
quietly stop existing.

Granularity matches the Step 6 matrix: a **function** is something a person
would name as a thing the product does, not an individual control. "Filter the
Control Centre" is one function; the eleven filters inside it are not eleven.

---

## Fixture Control Centre

| # | Function | Before | After | Note |
|---|---|---|---|---|
| 1 | List a scope's fixtures, paginated, with a scope-wide count | ✅ | ✅ | |
| 2 | Search fixtures by club, team, opposition, competition or venue | ✅ | ✅ | |
| 3 | Filter by date bucket, season, team, home/away, status, code, source, result and competition | ✅ | ✅ | |
| 4 | **Filter by match type** | ❌ | ✅ | **ADDED.** `game_type` was canonical and expressible nowhere. |
| 5 | **Navigate by period — previous / this / next, week or month, or a specific date** | ❌ | ✅ | **ADDED (§20, §B).** |
| 6 | Sort by date, club, created or updated | ✅ | ✅ | |
| 7 | Attention band: next seven days, missing kick-off, result outstanding — each a link | ✅ | ✅ | |
| 8 | Clear every filter in force | ⚠️ | ✅ | Existed but listed seven of ten, so a team or season filter could not be cleared. |
| 9 | Edit kick-off date and time in place | ✅ | ✅ | |
| 10 | Edit meet time in place | ✅ | ✅ | Site Admin column since the redesign; asserted where it now lives. |
| 11 | Select rows and save or discard in bulk, with per-row refusals | ✅ | ✅ | |
| 12 | Duplicate a fixture to the next free week | ✅ | ✅ | |
| 13 | Add a single fixture | ✅ | ✅ | |
| 14 | Export the scope's fixtures as CSV | ✅ | ✅ | |
| 15 | Phone card layout | ✅ | ✅ | |
| 16 | Row actions: Match Centre, View, Edit, Duplicate | ✅ | ✅ | |
| 17 | Distinguish "nothing matches your filter" from "nothing arranged yet" | ✅ | ✅ | |
| 18 | **See match type on the fixture** | ❌ | ✅ | **ADDED.** The phone card already showed it; the desktop grid did not. |
| 19 | **See how many of the squad have replied** | ❌ | ✅ | **ADDED (§29, §I).** Capability-gated; absent, never zero. |
| 20 | See where a fixture is played | ⚠️ | ✅ | The column headed *Venue* led with the pitch; the venue now leads and the pitch sits under it. |

## Fixture record and editing

| # | Function | Before | After | Note |
|---|---|---|---|---|
| 21 | One fixture detail record, shared by Site Admin and the involved club | ✅ | ✅ | |
| 22 | One Edit Fixture sheet, shared by Control Centre, Calendar and detail | ✅ | ✅ | |
| 23 | Change the owning team | ✅ | ✅ | |
| 24 | Change the opposition club and team | ✅ | ✅ | |
| 25 | Swap home and away | ✅ | ✅ | |
| 26 | Set the venue and pitch by canonical id | ✅ | ✅ | |
| 27 | **Be offered the opposition's ground and its only pitch for an away fixture** | ❌ | ✅ | **FIXED.** The rule existed; the read behind it was refused by RLS and returned nothing. |
| 28 | Change the competition | ✅ | ✅ | |
| 29 | Change status; cancel with a reason | ✅ | ✅ | |
| 30 | Delete a draft fixture with no result | ✅ | ✅ | |
| 31 | Archive and restore a fixture | ✅ | ✅ | |
| 32 | Submit, confirm and dispute a result | ✅ | ✅ | |
| 33 | Resolve a result dispute (Site Admin) | ✅ | ✅ | |
| 34 | Message the people involved in a fixture | ✅ | ✅ | |
| 35 | Read a fixture's audit history | ✅ | ✅ | |

## Season Planner

| # | Function | Before | After | Note |
|---|---|---|---|---|
| 36 | Spreadsheet grid over canonical lookups | ✅ | ✅ | |
| 37 | Rectangular clipboard paste, external and internal | ✅ | ✅ | |
| 38 | Fill handle, multi-cell selection, context menu, clear | ✅ | ✅ | |
| 39 | Keyboard navigation and keyboard lookup | ✅ | ✅ | |
| 40 | Per-row validation naming the actual problem | ✅ | ✅ | |
| 41 | Undo a paste | ✅ | ✅ | |
| 42 | Bulk create through the one import pipeline | ✅ | ✅ | |
| 43 | Club chooser for somebody who may plan for several | ✅ | ✅ | |
| 44 | Phone layout | ✅ | ✅ | |

## Fixture Import

| # | Function | Before | After | Note |
|---|---|---|---|---|
| 45 | Upload CSV or XLSX, or paste rows | ✅ | ✅ | |
| 46 | Map columns | ✅ | ✅ | |
| 47 | Preview every row with what Ovalball understood | ✅ | ✅ | |
| 48 | Correct or exclude a row | ✅ | ✅ | |
| 49 | Resolve a duplicate or collision by explicit decision | ✅ | ✅ | |
| 50 | Stage, then publish, with exclusions reported | ✅ | ✅ | |
| 51 | Batch history | ✅ | ✅ | |
| 52 | Site Admin global import | ✅ | ✅ | |

## Requests and negotiation

| # | Function | Before | After | Note |
|---|---|---|---|---|
| 53 | Request a fixture (team staff, one at a time) | ✅ | ✅ | |
| 54 | See incoming requests and act on them | ✅ | ✅ | |
| 55 | Accept, decline, or accept with a team action | ✅ | ✅ | |
| 56 | Ask every Ovalball opponent to confirm | ✅ | ✅ | |
| 57 | Tournament invitations | ✅ | ✅ | |

## Calendar

| # | Function | Before | After | Note |
|---|---|---|---|---|
| 58 | Week lanes, month view, season grid, phone agenda | ✅ | ✅ | |
| 59 | Grouped team filter | ✅ | ✅ | |
| 60 | **Teams with nothing scheduled are filed, not mixed in** | ❌ | ✅ | **ADDED (§26).** Every team stays reachable behind one named control. |
| 61 | Status, kind, home/away, venue and attendance filters | ✅ | ✅ | |
| 62 | Create a fixture or training session from a lane | ✅ | ✅ | |
| 63 | Cancel, delete and restore from the Calendar | ✅ | ✅ | |
| 64 | Deleted calendar events | ✅ | ✅ | |

## Pitch allocation

| # | Function | Before | After | Note |
|---|---|---|---|---|
| 65 | Allocation board over the day's pitches | ✅ | ✅ | |
| 66 | Drag a fixture onto a pitch and time | ✅ | ✅ | |
| 67 | Warm-up and pack-up reservations | ✅ | ✅ | |
| 68 | Conflict detection | ✅ | ✅ | Unchanged. |
| 69 | **Two bookings at one time are both visible** | ❌ | ✅ | **FIXED (§27).** The split square: the second card rendered underneath the first. |
| 70 | Auto-allocation proposal, applied or discarded | ✅ | ✅ | |

## Competitions

| # | Function | Before | After | Note |
|---|---|---|---|---|
| 71 | Create a competition, and quick-create | ✅ | ✅ | |
| 72 | Manage editions, participants, stages, groups and rounds | ✅ | ✅ | |
| 73 | Generate draft matches and a knockout bracket | ✅ | ✅ | |
| 74 | Issue matches to participating clubs | ✅ | ✅ | |
| 75 | Confirm, ask to change or decline a competition match | ✅ | ✅ | |
| 76 | Record a result; cancel or postpone a match | ✅ | ✅ | |
| 77 | Project a Competition Match onto a club Fixture | ✅ | ✅ | |
| 78 | Public competition page | ✅ | ✅ | |

## Match Centre

| # | Function | Before | After | Note |
|---|---|---|---|---|
| 79 | One shared matchday surface for every role | ✅ | ✅ | |
| 80 | The viewer's own availability answer | ✅ | ✅ | |
| 81 | Match conditions: venue, address, postcode, pitch, weather | ✅ | ✅ | Postcode and weather were already here. |
| 82 | Who's in, staff-gated | ✅ | ✅ | |
| 83 | The fixture conversation | ✅ | ✅ | |
| 84 | **Return to the surface the fixture was opened from** | ❌ | ✅ | **ADDED (§25).** It was a literal `/fixtures` link. |

## Public

| # | Function | Before | After | Note |
|---|---|---|---|---|
| 85 | Public fixtures page | ✅ | ✅ | |
| 86 | Public club fixtures and results, friendlies withheld | ✅ | ✅ | Privacy decision unchanged. |
| 87 | **Public venue projection tells a visiting club where to turn up** | ⚠️ | ✅ | Existed with name only; now also the default ground and its only pitch. |

## Cross-cutting

| # | Function | Before | After | Note |
|---|---|---|---|---|
| 88 | **One rule for which side a fixture is named after** | ❌ | ✅ | **ADDED (§C, §18).** Six surfaces each had their own; one had it right, inline and unreachable. |

---

## Totals

| | |
|---|---|
| **FUNCTIONS BEFORE** | **88** |
| **FUNCTIONS AFTER** | **88** |
| **FUNCTIONS LOST** | **0** |

Eight of the eighty-eight were **absent or broken** before this step and are
present after it (#4, #5, #18, #19, #27, #60, #69, #84, plus #88). Three were
present but incomplete and are now whole (#8, #20, #87). Nothing was removed,
and nothing moved surface without an assertion following it — #10 (meet time)
moved to Site Admin in the earlier Control Centre redesign and is asserted on
the surface that now carries it rather than being dropped along with the
assertion that named its old home.
