# Convergence Step 7 — Fixture Operations: the current-state map

**Archaeology only. Written before any Step 7 behaviour change.** Disk at
`1ba8366`, the accepted tip of Step 6.

The instruction this document answers is §3: *"Do not assume backlog wording
still reflects current code."* It mostly does not. Fixture Operations is the
largest and oldest domain in Ovalball, and most of what the Step 7 brief asks
for already exists in some form. The job of this map is to say which form, so
that Step 7 finishes what is there rather than building a second one.

---

## 0. The shape of the domain

| | |
|---|---|
| Routes | 25 under `app/(app)/fixtures`, `app/(app)/admin/fixtures`, `app/(app)/calendar`, plus `app/public-fixtures` |
| Public RPCs | 76 whose name contains `fixture`, `competition` or `match` |
| Internal helpers | 57 under `internal.` in the same domain |
| Tables | 47 in the fixture / competition / venue / pitch / training family |
| Server actions | 79 across 15 action files |
| SQL suites | 54 |
| TypeScript suites | 12 |
| Browser suites | 27 (`10`, `14`–`38`, `53`–`55`) |

**None of the 27 fixture browser suites is in `run-platform-tests.sh`.** The
release runner's `BROWSER_SUITES` list begins at `62`. Every fixture-operations
browser claim therefore rests on somebody having run a suite by hand at some
point — the same argument Slice 7e used when it wired `62` in, applied to a
domain twenty-five suites wide.

---

## 1. Canonical data

| Concept | Canonical record | Notes |
|---|---|---|
| A fixture | `public.fixtures` | `owning_team_id` + `home_away` are what is stored; `home_team_id` / `away_team_id` are **generated from them** |
| Its season identity | `get_team_identity_for_season` / `fixture_season_identity` | one resolver, documented in `docs/seasons/fixture-identity.md` |
| A competition's schedule | `public.competition_matches` | exists even with no Ovalball participant |
| The club/team projection | `public.competition_match_fixtures` (match_id, fixture_id) | unique on `fixture_id` — one fixture projects one match |
| A request | `public.fixture_requests` | states `draft · sent · accepted · declined · counter_proposed · cancelled · expired` |
| A staged import | `fixture_import_batches` + `fixture_import_rows` | states `uploaded · processing · needs_review · ready_to_publish · publishing · completed · completed_with_exclusions · failed` |
| Availability | `public.player_fixture_attendance` | `ATTENDING · CANNOT_ATTEND · UNSURE`, plus absence = not responded |
| Venue / pitch | `public.venues` / `public.club_pitches` | Step 6 made these canonical; `venues.address` is derived by `set_venue_address` |
| Training recurrence | `training_plans` + `training_plan_schedule_rules` → `training_sessions` | `occurrence_date` + `is_overridden` per session |

`fixtures.owning_team_age_group_snapshot` and `owning_team_display_name_snapshot`
exist, are stale by construction and are read by nothing. They are **not** an
answer to anything and Step 7 does not start reading them.

---

## 2. The authority model — already canonical

Every fixture capability is a real row in `public.capabilities` with a declared
scope. The locked invariant in §5 of the brief is **already encoded in data**:

| Capability | `valid_scopes` | Meaning |
|---|---|---|
| `fixture.fixture.create` | `{club,team}` | one match at a time; inherits to team |
| `fixture.fixture.edit` | `{club,team}` | inherits to team |
| `fixture.fixture.cancel` | `{club,team}` | inherits to team |
| `fixture.result.record` | `{club,team}` | inherits to team |
| **`fixture.import.run`** | **`{club}`** | **never a team capability** |
| **`fixture.planner.use`** | **`{club}`** | **never a team capability** |
| **`fixture.fixture.bulk_edit`** | **`{club}`** | **never a team capability** |
| **`competition.creator.use`** | **`{club}`** | **never a team capability** |
| `fixture.fixture.delete` | `{club}` | draft only, no result |
| `venue.pitch_allocation.manage` | `{club}` | |

`capabilities_site_keys` and `capabilities_valid_scopes_check` make a team-scoped
grant of a club-only key **structurally impossible**, not merely unimplemented.
That is a stronger guarantee than a test, and Step 7 keeps it.

### RLS

`public.fixtures` carries four policies and **no INSERT policy at all** — every
creation path goes through a `SECURITY DEFINER` RPC. `SELECT` is
`fixtures_select_related` (own teams, own clubs, scheduling groups, family
visibility, or `site.fixtures.view`). `UPDATE` is `can_manage_fixture_side` on
either side. `DELETE` requires `site.fixtures.delete`. A restrictive
`session_ok_required` sits over all of it.

`admin_fixture_overview` — the view every Control Centre, export and detail page
reads — is **`security_invoker = true`**. The `clubId` argument in
`buildAdminFixtureQuery` is a convenience filter; the boundary is RLS underneath.
This is the correct shape and is the reason §24's search-privacy requirement is
mostly a matter of proof rather than of construction.

`public_club_fixtures` and `public_venues` are deliberately **owner-rights**
projections — that is what makes them public — so their filters are the whole of
their safety and must be re-proved (§33).

---

## 3. Surface by surface

### 3.1 Fixture Control Centre — EXISTS, one implementation, two scopes

`FixtureManagementView` (`app/(app)/admin/fixtures/fixture-management-view.tsx`,
432 lines) is rendered by **both** `/admin/fixtures` (Site Admin, global) and
`/fixtures/management` (club, scoped). One component, one query builder, one
row component. There is no second copy.

Already present: an **attention band** (next 7 days · missing kick-off or date ·
played with no result) whose counts are scope-wide and unfiltered and each of
which is a link; a text search across club, team, opposition, competition and
venue; filters for date bucket, season, team, home/away, status, code, source,
result status and competition; five sort orders; in-place editing of date, time
and meet time; bulk selection; CSV export; a mobile card list; an empty state
that distinguishes "nothing matches your filter" from "nothing arranged yet".

**Gaps against the brief:**

- Date navigation is `all` / `upcoming` / `past` only. There is **no** week or
  specific-date navigation (§20, §B).
- **Match type** (`fixtures.game_type`) is canonical and is on no column, chip or
  filter (§19).
- The column headed *Venue* actually renders pitch-then-venue. The **pitch** is
  shown; the header does not say so (§A).
- No **availability summary** (§29, §I).
- No **venue postcode** (§22, §H).
- The *Clear filters* control's visibility condition omits `team`, `season` and
  `ha`, so choosing only a team filter offers no way to clear it.

### 3.2 Season Planner — EXISTS, large and complete

`/fixtures/planner` → `MassFixturePlanner` (919 lines) over `planner-grid.tsx`
(1,782 lines) and `lib/fixtures/planner-*.ts` (1,311 lines). Club-scope authority
through `resolvePlannerScope` → `can_bulk_plan_fixtures`. Spreadsheet behaviour —
fill handle, clipboard, rectangular TSV, context menu, multi-cell selection,
clear, keyboard lookup, cached authorised opposition and venue data — is
implemented and covered by suites `15`–`18`, `20`–`22`, `26`–`28`, `34`.

Step 7 does not redesign this. §13's instruction is preservation.

### 3.3 Fixture Import — EXISTS, one engine, two front doors

`lib/fixtures/import-engine.ts` (1,087 lines) is the single staging engine.
`/fixtures/import` (club, capability-gated by `requireClubImportAccess` →
`fixture.import.run` + bulk authority) and `/admin/fixtures/import` (Site Admin,
global) both call it. `parse-csv.ts` and `xlsx-reader.ts` accept CSV and XLSX;
`import-mapping.ts` holds the column model and `IMPORT_ROW_LIMIT`; validation
reuses `planner-rows.ts`, which is the **same validator the Season Planner uses**.
Staging tables carry RLS; publishing goes through `publish_import_row`.

**There is no importer #2 to avoid building.** Step 7's import work is the
journey proof §L asks for, the duplicate and failure semantics §10/§11 ask to be
made explicit, and the authority matrix §12 asks to be demonstrated.

### 3.4 Single-fixture flow — EXISTS, three doors, one editor

`AddFixtureDialog` (Control Centre), `create-fixture-dialog` (Calendar) and
`/fixtures/new` (Request a Fixture, for team staff) all converge on
`create_fixture` / `create_fixture_request`. Editing everywhere opens the one
`components/fixtures/fixture-editor-sheet.tsx` through `FixtureEditorProvider` —
Control Centre rows, Calendar and fixture detail share it.

### 3.5 Match Centre — one shared surface, **hardcoded return**

`app/(app)/fixtures/[fixtureId]/page.tsx` is the one canonical route, per
`CLAUDE.md` and `scripts/verify-match-centre-shared.mjs`. Its back link is a
literal `<Link href="/fixtures">`. **There is no continuation architecture at
all** — not a broken one, an absent one. §25 is genuine Step 7 work.

Weather is wired here through `components/fixtures/match-centre/match-conditions.tsx`
→ `lib/weather/fixture-forecast.ts` → `lib/weather/provider.ts`, a Met Office
DataHub adapter with lead-time-derived caching keyed on rounded coordinates, an
explicit `PROVIDER_UNAVAILABLE` state and a documented refusal to fabricate a
forecast. **A provider already exists and is already approved**; §22's warning
against casually introducing one does not bite.

### 3.6 Calendar — EXISTS; the lane list is every active team

`lib/calendar/build-lanes.ts` produces one lane per active scheduling group and
one per remaining active team **in scope**, with no reference to whether that
team has any fixtures. `TeamFilterBar` renders whatever it is given. §26 is
genuine work, and the constraint that matters is its second sentence: a legitimate
team must not disappear from the product.

### 3.7 Pitch Allocation — EXISTS, overlap-aware

`pitch-allocation-board.tsx` (1,243 lines) already computes overlap lanes at
render time for training. Whether the reported split-square defect is data,
allocation or layout is **not yet determined** and §27 requires it to be
reproduced before it is classified.

### 3.8 Training occurrences — recurrence architecture EXISTS

`save_training_plan` (series) → `generate_training_plan_sessions` →
`training_sessions` with `occurrence_date` and `is_overridden`;
`override_training_session` edits **this occurrence**;
`preview_training_plan_occurrences` previews before committing. "This occurrence"
and "the series" both exist. "**This and all future occurrences**" does not.

### 3.9 Competition Match ↔ Fixture — locked model, already enforced

`internal.sync_competition_match_fixtures` is the projection writer. It already
refuses to attach a venue or pitch that does not belong to the owning club, moves
home/away from participant identity rather than from stored team order, cancels
and re-projects when the organiser replaces a team, and records `sync_error`
rather than failing the organiser's action. `competition_match_fixtures` is
unique on `fixture_id`.

---

## 4. Test state, measured

`10` passes (11). `14` **crashes** — it reads a training session by an id it
does not seed, and dies on `invalid input syntax for type uuid: ""`. `15` fails
4 of 26, and the failures are **stale assertions, not regressions**: it asserts
the pre-redesign Control Centre column model (`Kick Off Time`, `Meet` as separate
club columns) that suite `19` asserts has been merged away. Two permanent suites
in the same domain assert contradictory models of the same screen, and because
neither is in the release runner, nothing has ever said so.

`19` passed 30 of 31; the single failure was the **pre-existing** shell
notification-badge `color-contrast` violation Step 6 recorded — one defect that
was failing four suites twelve times over.

**Twelve of the twenty-seven were failing when Step 7 first ran them, and not
one of the failures was a product regression somebody had introduced.** The
full measured baseline, and what each failure actually turned out to be, is §4
of the Step 7 report.

---

## 5. Known duplicate or legacy paths

| Path | Verdict |
|---|---|
| `/fixtures/import` and `/admin/fixtures/import` | **Not duplicates.** Two authority scopes over one engine. |
| `/fixtures/planner` and `admin/fixtures/planner-*.tsx` | **Not duplicates.** The second is the Control Centre's in-place cell editor, not a planner. |
| `fixture.create` / `fixture.edit` / `fixture.view` / `fixture.import` / `fixture.bulk_edit` / `fixture.cancel` / `fixture.manage_requests` | `DEPRECATED` legacy keys that resolve through `capability_key_map`. Retained deliberately. |
| `fixtures.*_snapshot` columns | Dead. Read by nothing. Left alone. |
| `07-accessibility.mjs` | Reads axe from a deleted job directory. §39 requires repair. |
| `SHOT_DIR` default in suites `19`, `21`, `23`, `24`, `25` | Same deleted directory. |
| Role-name literals | 37 in the fixture domain across 15 files, tracked in the shrink-only `supabase/security/role-literal-baseline.json`. |
