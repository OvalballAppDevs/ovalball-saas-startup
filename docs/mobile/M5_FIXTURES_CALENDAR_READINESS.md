# M5 — Fixtures and Calendar: what was already there

Written before building, from the repository as it stands at `54172f4`. Short on purpose: it records
what M5 consumes and what it had to move, not what it intends to build.

## The debt the mobile foundation recorded — paid

`apps/mobile/src/context/home-data.ts` said plainly that it was **not** the canonical agenda. It asked
one team for its next fixture, because `lib/agenda/load.ts` began with `server-only` and imported a
React component's props type, so React Native could not reach it. Home therefore resolved an opponent
by its own small rule while the website resolved it by the canonical one — two answers to "who are we
playing", waiting for a fixture whose opposition is a directory entry rather than a team.

M5 moves the agenda into `packages/contracts/src/agenda/`:

| moved | from | notes |
|---|---|---|
| `load.ts` | `lib/agenda/load.ts` | unchanged; `server-only` stayed on the web side |
| `scope.ts` | `lib/agenda/scope.ts` | unchanged |
| `window.ts` | `lib/agenda/window.ts` | pure already |
| `filters.ts` | `lib/agenda/filters.ts` | pure already |
| `mirror-pair.ts` | `lib/fixtures/mirror-pair.ts` | pure already |
| `team-identity.ts` | `lib/mini-rugby/team-identity.server.ts` | `server-only` stripped |
| `family-scope.ts` | the pure half of `lib/parent/family-agenda.ts` | `FamilyChild`, `resolveFamilyScope` |
| `kit.ts` | the `KitConfig` type from `components/club/rugby-kit.tsx` | type only |

Every web path (`@/lib/agenda/load`, `@/lib/fixtures/mirror-pair`, …) is now a re-export, so no web
import changed and there is exactly one implementation.

## Canonical truth M5 consumes

**Scopes.** `resolveAgendaScope(ctx, activeContext)` → `family` · `teams` · `club` · `platform` ·
`none`. Context narrows, never widens. No search parameter reaches it.

**Window.** `resolveWindow(mode, anchor, today, direction)`. Upcoming is bounded at 365 days, past at
730, and every read is capped at `AGENDA_ROW_CAP = 400`.

**Items.** `AgendaItem` carries both sides with crest and kit, home/away flipped when the viewer is the
opponent, venue, pitch, status, canonical result (only where **both** scores exist), the child a row
belongs to, attendance, and an `href`. Training has no opposition and is never given one.

**Mirror pairs.** One real match is two rows. `dedupeMirrorPairs` is set-aware, because an agenda
routinely holds one half without the other.

## Fixture capabilities, as the engine has them today

Team-scoped **and** delegable: `fixture.fixture.create` · `.edit` · `.cancel` · `.view` ·
`fixture.request.create` · `fixture.request.respond` · `fixture.result.record` · `.archive`.

Club-only, never team: `fixture.planner.use` · `fixture.import.run` · `fixture.fixture.bulk_edit` ·
`fixture.fixture.delete`. This is §6 and §20 as the database already states them; mobile does not need
to assert it, only to ask the right question.

`fixture.create` / `fixture.edit` / `fixture.cancel` (the short keys) are **not** delegable and are the
older shape; the `fixture.fixture.*` keys are the delegable ones. Mobile asks for the delegable keys.

## Canonical mutations

| action | RPC |
|---|---|
| create | `create_fixture(...)` |
| edit | `update_fixture_details(p_fixture_id, p_patch jsonb)` — plus focused `update_fixture_kickoff` / `_venue` / `_pitch` / `_meet_time` |
| which fields are editable | `fixture_editable_fields(p_fixture_id)` → jsonb |
| cancel | `cancel_fixture(p_fixture_id, p_reason)` — refuses to be reached through the edit patch |
| request | insert `fixture_request_groups` + one `fixture_requests` row per team, RLS-scoped |
| compatible opponents | `compatible_opponent_identities(p_team_id)`, `compatible_opponent_teams(p_team_id, p_opponent_club_id)` |
| availability | `fixture_availability_summary(p_fixture_ids[])` |

`update_fixture_details` refuses `status = 'Cancelled'`: "Cancel a fixture with Cancel Fixture, so the
other side and the players are told why." §19's distinction is the database's own.

## Statuses, verbatim

`fixtures_status_check`: `Planned` · `Booked` · `To Be Determined` · `Annual Holiday` · `Festival` ·
`Lancashire Cup` · `Cancelled` · `Completed`. `home_away`: `Home` · `Away` · `TBD` ·
`Not Applicable`. No vocabulary is invented (§10).

## Known gaps carried into M5

- **Training recurrence** is materialised server-side; the agenda reads persisted occurrences only.
  No mobile recurrence engine (§40).
- **Club events** beyond fixtures and training have no agenda representation yet — the loader reads
  `fixtures` and `training_sessions`. Calendar shows what exists rather than inventing a third kind.
- The `platform` scope is reachable only by a Full Site Admin and is unbounded by team; mobile keeps
  the same row cap and says when it bites.
