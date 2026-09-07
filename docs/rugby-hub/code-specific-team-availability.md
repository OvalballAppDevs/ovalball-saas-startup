# Code-specific team-type availability

How one shared team catalogue serves two codes that do not regulate the same
age grades.

## The problem

`canonical_team_types` has **no `rugby_code` column**. It is a single shared
catalogue of the 25 team identities Ovalball supports, used by both union and
league clubs.

That was fine until RFU Regulation 15.6 established that girls' union rugby is
played in four *dual age bands* — U12/U11, U14/U13, U16/U15, U18/U17 — so Girls
U13 and Girls U15 are not union age grades at all.

The first attempt at enforcing that (migration `20261108000000`) set
`is_active = false` on both rows. Because the catalogue is shared, **that
removed them from Rugby League too** — and the RFL's girls age structure has
never been established from a primary source. Union evidence was allowed to
mutate League availability, which is the same error as concluding Appendix 10
didn't exist because it wasn't in a supplied set: *absence of research is not
evidence of absence.*

The blast radius was wider than the picker.
`internal.validate_canonical_type_active_on_create` is a `BEFORE INSERT`
trigger on `teams` that refuses any team whose canonical type is globally
inactive — so a league club could no longer *create* a Girls U13 team at all.

## The solution

No new table. `regulatory_team_type_mappings` already had the right state,
documented at creation in `20261104000000`:

> `NOT_OFFERED` — Ovalball supports the team type, but not in this code (no
> such thing as League Colts in the Ovalball catalogue today).

That is exactly the required semantic, already keyed on
`(canonical_team_type_id, rugby_code)`. Until now it was documentation that
nothing read. Phase 4B.1 wires it to behaviour.

### The rule is positive-default

A type is offered for a code **unless that code's row explicitly says
`NOT_OFFERED`.**

| Mapping state | Offered? |
|---|---|
| *no row at all* | yes |
| `RESEARCH_REQUIRED` | yes |
| `MAPPED` | yes |
| `NO_REGULATORY_EQUIVALENT` | yes |
| `NOT_OFFERED` | **no** |

Silence can never narrow availability. An unresearched combination keeps
working, and a Site-Admin-added type appears everywhere immediately. This is
the single most important property of the design and it is covered by three
regressions (assertions 28–31).

### One view, one truth

`public.canonical_team_types_by_code` resolves the catalogue per code and
exposes `is_offered`. Every offering surface reads it, so the rule cannot drift
between the signup checklist, Add Team, the server action that validates a
submission, the tournament picker and opponent search.

```sql
select key, is_offered from canonical_team_types_by_code where rugby_code = 'union';
```

### Enforcement points

| Layer | What it does |
|---|---|
| `canonical_team_types_by_code` | What each code may be offered |
| `loadTeamCategoryGroups(supabase, { rugbyCode })` | Server pages filter on load |
| `filterGroupsForCode(groups, code)` | Signup filters client-side (it fetches anonymously, before a code is chosen) |
| `teams_gender_category_check` | Refuses union girls at U13/U15/U17 outright |
| `validate_canonical_type_active_on_create` | Refuses a new team on a type withheld from **its own** code |

The trigger fires on `INSERT` only. Withholding a type governs what may be
**created**, never what already exists — historical rows keep working and keep
resolving, and `internal.resolve_canonical_team_type` deliberately does not
consult offering rules at all.

## Current state

| | Union | League |
|---|---|---|
| Offered | 23 | 25 |
| Withheld | `girls_u13`, `girls_u15` | *nothing* |

Union girls identities are exactly `girls_u12`, `girls_u14`, `girls_u16`,
`girls_u18`. Both withheld rows remain **globally active** — undoing the global
deactivation was the point.

## Rollover

`internal.next_age_grade_for(age_group, gender, rugby_code)` steps union girls
by band and everything else by year:

- union girls: U12 → U14 → U16 → U18 → *null* (adult women's rugby, a manual decision)
- union boys: U12 → U13 → U14 → U15 → U16, unchanged
- league, any gender: falls through to `internal.next_age_grade`, unchanged

Rollover never lands on U13 or U15 for union girls.

## What this does NOT do

- **It does not touch League.** No RFL evidence exists for girls age structure,
  so league offering and progression are byte-for-byte what they were. A
  migration-time assertion refuses to apply if league is narrowed at all.
- **It does not create parallel type systems.** There is one catalogue and one
  vocabulary; only availability is per code.
- **It does not duplicate display names.** No `UnionGirlsU13` / `LeagueGirlsU13`
  split.

## Adding a future withholding

1. Set `mapping_state = 'NOT_OFFERED'` on that `(type, code)` row with a `notes`
   explaining why (the schema requires the note).
2. Add the age/gender combination to `teams_gender_category_check` **only if**
   the evidence is code-specific and strong.
3. Add a regression pairing the withheld code with the unaffected one.

Never set `is_active = false` to express a per-code rule. That is the bug this
document exists to prevent.
