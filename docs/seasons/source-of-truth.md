# Season dates: one source of truth

**Site Admin → Seasons is the only authoritative source for season dates.**
Every operational boundary in Ovalball derives from a canonical `public.seasons`
row. Changing an allowed date there changes it everywhere, because nothing
recomputes it independently.

This document records the classification from the repository-wide audit, so a
future change can be checked against it rather than re-derived.

## CANONICAL

`public.seasons` — the record itself.

| Column | Owns |
|---|---|
| `starts_on` | Season start |
| `ends_on` | Season end / archive boundary |
| `pre_season_starts_on` | Pre-season start, and the **season handover boundary** |
| `season_year_start` | The year the season is named for |
| `rugby_code` | Which code's calendar this is |
| `is_regression_fixture` | Excluded from every operational resolver |

There is no separate handover date, fixture-season date or registration-season
date. If one is ever needed it becomes a modelled column on this record.

## DERIVED_FROM_CANONICAL

| Thing | Derives what | From |
|---|---|---|
| `internal.resolve_season_for_date` | Which season contains a date | `starts_on`, `ends_on`, `pre_season_starts_on` |
| `internal.regulatory_school_year_start` | The school year a season names | `season_year_start` + code |
| `public.resolve_player_regulatory_age` | A player's age grade | delegates to the above |
| `public.resolve_normal_operational_identity` | The team that age points at | delegates to the above |
| `capture_fixture_team_snapshot` | `fixtures.season_id` | `resolve_season_for_date` |
| `internal.process_due_season_transitions` | The handover boundary | target season's `pre_season_starts_on` |
| `public.get_team_identity_for_season` | What a team was called, or will be called, in a season | keyed on canonical `season_id` |
| `public.fixture_season_identity` | Fixture team names per season | `fixtures.season_id` + `get_team_identity_for_season` |

A missing canonical date is never guessed. If a target season has no
`pre_season_starts_on`, the automatic handover sets the transition to
`needs_attention` naming the missing field, rather than falling back to a
default.

## PRESENTATION_ONLY

`seasons.name` and `seasons.season_ref` are written by
`internal.compute_season_identity`, a trigger on the canonical row. They are
labels — "Rugby Union 26/27", "2026". Nothing authorises, filters or schedules
on them. Season-sensitive domains reference `season_id`.

## Derives from governing regulation, not from Ovalball

Two things legitimately do **not** come from `public.seasons`, and must not be
moved into Site Admin:

- **The DOB cutoff** in `resolve_player_regulatory_age` — school years running
  1 September to 31 August. This is RFU/RFL rule. It is not a club or operator
  setting and must never become editable.
- **`internal.regulatory_season_of(date, rugby_code)`** — labels which
  governing-body season a published regulation belongs to, for the Rugby Hub.
  Its 1 August boundary is the RFU's regulatory year. It answers a question
  about *documents*, never about fixtures, handover or team identity.

## LEGACY — removed

`internal.regulatory_season_of(date)` (single argument) computed a season label
from a date using a hardcoded 1 August boundary, reading nothing. It ignored
the canonical `starts_on`, ignored `pre_season_starts_on`, and ignored that
League seasons are single-year. It had been superseded by the code-aware
overload and had **no callers anywhere**.

It was dropped in `20261209000000_canonical_season_source_of_truth.sql`. A
zero-caller function is not harmless when it is a second answer to a question
the product must answer one way: it sits in the schema looking authoritative,
and the next person needing "which season is this date in" may find it before
they find `resolve_season_for_date`.

## DUPLICATE

None found. No other operational season calendar exists.

## Guard

`supabase/tests/season_source_of_truth.sql` asserts these invariants, and the
migration re-asserts them at apply time.
