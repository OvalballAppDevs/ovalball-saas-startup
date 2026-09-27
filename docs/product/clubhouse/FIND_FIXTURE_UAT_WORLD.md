# Find a Fixture — UAT Matching World (expected-result oracle)

Fixture: `supabase/seeds/local_uat_find_fixture_matching_world.sql`, plus
`node scripts/seed-find-fixture-uat-crests.mjs` for the ten synthetic crests
(Storage uploads have no raw-SQL path). Idempotent, additive, local-only —
see that file's own header for the safety guard, the removal procedure, and
why only three of the ten clubs are partners.

This document is the oracle the fixture must stay consistent with. If the
fixture changes, this table is re-verified against a fresh RPC run before it
is trusted again — it is not maintained by hand from memory.

## Fixed scenario

| | |
|---|---|
| Viewer club | Ovalball UAT RUFC (`ovalball-uat-rufc`) |
| Viewer persona | `uat.coach@ovalball.test` (CLUB_ADMIN + `coach` team_permissions on the three selected teams — CLUB_ADMIN alone does not carry team-scoped fixture authority; confirmed directly against this persona while proving this fixture) |
| Selected viewer teams | Men's 1st Team, Women's 1st Team, Under 16 Boys |
| Test date | **2026-10-17** (Saturday) |
| Venue preference | Either |
| Distance filter | Any (filtering itself is `applyClubhouseDistanceFilter`, already tested; not re-tested here) |

## Expected vs. actual — captured from a real run of the batched RPCs

Captured by calling `find_fixture_candidate_teams_batch` and
`find_fixture_candidate_availability_batch` directly as `uat.coach@ovalball.test`
against the local database, then feeding the exact rows returned through the
real `buildFindFixtureMatches` / `summariseFindFixtureClubAvailability` /
`sortFindFixtureMatches` functions (`packages/contracts/src/clubhouse`) — not
hand-computed. **Actual matched every expected value on first run; no
adjustment was made to either side.**

| Club | Matched | Availability (2026-10-17) | Distance | Partner | Included? |
|---|---|---|---|---|---|
| UAT North | 3/3 | 3/3 no known clash | 5.0 mi | Yes | Yes |
| UAT South | 3/3 | 1 clear · 1 busy · 1 tentative | 12.0 mi | Yes | Yes |
| UAT East | 2/3 | Availability unknown | 18.0 mi | No | Yes |
| UAT West | 3/3 | 2 clear · 1 tentative | 25.0 mi | Yes | Yes |
| UAT Valley | 1/3 | Availability unknown | 30.0 mi | No | Yes |
| UAT Riverside | 2/3 | Availability unknown | 45.1 mi | No | Yes |
| UAT Borough (League) | **0/3** | n/a | 50.1 mi | No | **No — excluded** |
| UAT Athletic | 2/3 | Availability unknown | 55.1 mi | No | Yes |
| UAT Park | 3/3 | 3/3 no known clash | 70.1 mi | Yes | Yes |
| UAT United | 3/3 | Availability unknown | Unknown (no directory coordinate) | No | Yes |

**Why UAT South is "1 clear · 1 busy · 1 tentative" rather than the originally
planned "2 clear · 1 busy":** the fixture also seeds a pending fixture request
*from* UAT South's own Women's 1st team (to UAT West's Women's 1st, an
unrelated third-party ask, not involving the viewer). A pending request makes
BOTH named teams read `request_pending` for that date, regardless of which
side initiated it — a real, honest consequence of the shared-calendar
architecture, not a defect. Documented here rather than forced back to the
original illustrative plan, per this fixture's own stated escape clause.

### Sort orders (from the same real run)

- **Nearest:** North (5.0) → South (12.0) → East (18.0) → West (25.0) → Valley (30.0) → Riverside (45.1) → Athletic (55.1) → Park (70.1) → United (unknown, last)
- **Best Match:** North → Park → West → South → United → East → Riverside → Athletic → Valley
  (3/3-matched clubs first, ranked by clear-availability coverage, then distance; North and Park both 3/3-clear, North wins on distance; United is 3/3-matched but 0-clear/unknown, so it sorts after every club with real clear coverage; the 2/3-matched clubs are ordered by distance since none has any real clear signal; Valley (1/3) is last)
- **Most Clear:** North → Park → West → South → East → Valley → Riverside → Athletic → United
  (ranked by clear-availability coverage alone, ignoring matched count; the five 0-clear clubs — East, Valley, Riverside, Athletic, United — fall back to distance, and Valley (1/3 matched but 0 known clear) lands ahead of Riverside/Athletic/United purely because it is nearer)

## Game week (Monday–Sunday) — captured from a real run of `find_fixture_candidate_game_week_batch`

TEST DATE 2026-10-17 is a **Saturday**; its own Monday-Sunday game week runs
**Monday 2026-10-12 to Sunday 2026-10-18**.

| Club | Team | Exact-date state (17th) | Same-week commitment | Club-level pill |
|---|---|---|---|---|
| UAT North | Women's 1st | no known clash | Fixture 2026-10-19 (**following Monday — a different week**, correctly excluded) | No known clash |
| UAT South | Under 16 | busy (exact date) | — | Mixed |
| UAT South | Women's 1st | tentative | — | Mixed |
| UAT West | Men's 1st | no known clash | **Fixture 2026-10-16 (Friday, same week)** → "Busy this week", detail 2026-10-16 | Mixed |
| UAT West | Women's 1st | tentative | — | Mixed |
| UAT West | Under 16 | no known clash | — | Mixed |
| UAT Park | Under 16 | no known clash | Fixture 2026-10-11 (**preceding Sunday — a different week**, correctly excluded) | No known clash |

Both boundary cases (North's following Monday, Park's preceding Sunday) were
seeded specifically to prove the range never leaks across the Monday/Sunday
edge, and both were confirmed absent from the real RPC's output. UAT West is
the one club with three genuinely different real states at once (a real
same-week fixture, a real pending tentative request, and a genuinely clear
team) — its club-level pill is "Mixed", exactly matching Section A10's own
third worked example, and its per-team breakdown is:

- Men's 1st Team → **Busy this week** (2026-10-16)
- Women's 1st Team → **Tentative**
- Under 16 Boys → **No known clash**

Re-running all three sort orders with the week-aware summaries produced the
identical club ordering as the exact-date-only run (Section "Sort orders"
above) — South and West's `effectiveClearCount` both drop from their exact-
date value, but neither changes rank relative to its neighbours in this
particular nine-club set.

## What this proves, end to end

- Union/League isolation holds through the full batched pipeline, not just the
  single-team form: UAT Borough (League) never appears, at any stage.
- The availability partnership boundary is independent of compatibility: UAT
  West and UAT Riverside are both fully compatible, but only the partner
  (West) gets real availability — Riverside, a non-partner, reads "unknown"
  regardless of what its calendar contains.
- Absence of an availability row is read correctly by the CLIENT as
  `no_known_clash` for a partner (North, Park) and as `unknown` for a
  non-partner (East, Valley, Riverside, Athletic, United) — the SQL layer
  alone cannot distinguish these two cases; `summariseFindFixtureClubAvailability`
  does, by checking the candidate's own `partnershipStatus` first.
- `matchedTeamIds` is always the real subset of the caller's own three
  selected teams, in their own selection order — never the opposition's team
  list, never a count invented from row totals.
- All three sort modes are independently correct and produce genuinely
  different orders from the same nine-club set.
