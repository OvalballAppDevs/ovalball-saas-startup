# A fixture is named for its own season

A team's age grade is not a fact about the team. It is a fact about the team
**in a season**. The stable `team_id` survives the season handover; the label on
it does not.

So joining `teams.display_name` to show a fixture's team shows whatever that
team is called *today*, and a season handover silently rewrites the club's own
record of what it did — a result the Under-12s played last season appears under
the Under-13s.

## The one resolver

`public.get_team_identity_for_season(team_id, season_id)` answers it, in this
order:

1. **A stored season identity always wins.** `team_season_identity` is the
   historical record of what the team actually was in that season. It is never
   re-derived.
2. **Otherwise, for a future season, a code-aware projection**, flagged
   `is_projected`. This is why a fixture booked for next season can already read
   U13 before the handover has run — it belongs to next season.
3. **Otherwise the team's current identity.** A club that has never run a
   handover has only ever had one identity, so this is correct rather than a
   guess.

Consume it from TypeScript through
`lib/mini-rugby/team-identity.server.ts` → `loadTeamIdentitiesForSeason`, which
batches every `(teamId, seasonId)` pair a page needs into one round trip.
`public.fixture_season_identity` is the same projection as a view, for SQL and
for tests.

**Do not add a second resolver.** One was added during this work and removed
again: it answered "register row, else current team" and could not project a
future identity, so a next-season fixture would have read U12 until the handover
ran and U13 afterwards — exactly the label instability the rule exists to
prevent.

## What is not the answer

`fixtures.owning_team_age_group_snapshot` and
`owning_team_display_name_snapshot` look like the answer and are not. They are
captured `BEFORE INSERT` and never refreshed, so a fixture created before a
handover for a season after it holds a stale label. Nothing reads them.

A date comparison is not the answer either: a fixture booked beyond every
defined season has no `season_id` at all, and the fallback covers that case.

## Wired

| Surface | Status |
|---|---|
| Calendar | uses the projection |
| Calendar → Agenda | uses the projection |
| Match Centre | uses the projection |
| Season Handover board | uses the projection |
| Dashboard (this week's fixtures) | uses the projection |
| Public club page (upcoming fixtures) | uses the projection |
| Parent/Player family agenda | uses the projection |

`teams.display_name` remains on these surfaces only as the fallback when a
fixture has no `season_id`.

Not yet wired, and still reading the current label: **Messages** (fixture
conversation headers) and **pitch allocation**. Both concern in-flight
scheduling rather than historical results, so the current label is usually
right — but they are the remaining gap.

## Access never follows the label

Fixture authority follows stable ids and real membership, never `age_group` or
`display_name`. This is what stops a newly created U12 cohort seeing the
previous U12 cohort's history: they are different `team_id`s that happen to
share a label a season apart. `supabase/tests/fixture_cohort_isolation.sql`
asserts it, including that no fixture RLS policy mentions an age label.
