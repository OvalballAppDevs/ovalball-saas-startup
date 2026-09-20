# Convergence Step 7 — Fixture Operations Completion

**Delivered and proved locally. NOT RELEASED. Step 8 not started.**

Built on `1ba8366`, the accepted tip of Step 6.

---

## 1. Archaeology — the current-state map

Full map: `docs/product/CONVERGENCE_STEP_7_ARCHAEOLOGY.md`.

The instruction was *"do not assume backlog wording still reflects current
code"*, and it mostly did not. Fixture Operations is the largest domain in
Ovalball — 25 routes, 76 public RPCs, 57 internal helpers, 47 tables, 79 server
actions — and most of what the brief asks for already existed. Three findings
shaped the whole step:

1. **The authority model was already canonical.** Every fixture capability is a
   row in `public.capabilities` with a declared scope, and the §5 invariant is
   enforced by a CHECK constraint rather than by convention: `fixture.import.run`,
   `fixture.planner.use`, `fixture.fixture.bulk_edit` and `competition.creator.use`
   are `valid_scopes = {club}`, and `capabilities_valid_scopes_check` makes a
   team-scoped grant of a club-only key structurally impossible. Step 7 changed
   none of it.

2. **There was no importer #2 to avoid building.** `lib/fixtures/import-engine.ts`
   is one engine behind two front doors, sharing the Season Planner's own
   validator.

3. **None of the 27 fixture browser suites was in the release runner.** It
   began at suite 62. So every fixture-operations browser claim in the
   programme rested on somebody having run a suite by hand at some point — and
   when Step 7 ran them, twelve were failing.

## 2. BEFORE functionality matrix

`docs/product/CONVERGENCE_STEP_7_FUNCTIONALITY_MATRIX.md`, recorded before any
behaviour change.

## 3. Authority model proof

Capability scopes are data, and the constraint is the guarantee. Proved live by
suite `20`, which walks eight personas against the Planner, Import and Request
a Fixture and checks that **the screen and the server agree** for each, and by
suite `53` and `supabase/tests/fixture_bulk_planning_authority.sql`, which ask
the server directly.

One correction landed here. Suite `20` expected a persona named "Team Admin" to
be offered Request a Fixture. Team Admin was **retired as a visible primary
role** by the identity/auth programme — team administration became a scoped
capability bundle assignable to a Team Manager or Coach — so that identity now
holds no team-scoped fixture authority and is correctly offered nothing. The
row is kept and inverted rather than deleted, because the retirement is worth
asserting: if a "Team Admin" ever regains single-fixture authority by virtue of
its name, that test fails.

## 4. What was found broken, and what it actually was

| Suite | Symptom | Cause |
|---|---|---|
| `14` | crashed at module load: `invalid input syntax for type uuid: ""` | read a training session left behind by an earlier run; when it went, the empty id was interpolated straight into a `where` |
| `15` | "missing: Kick Off Time, Meet"; "2 matched, 2 rendered" | asserted the **pre-redesign** Control Centre column model that suite `19` asserts has been replaced — two permanent tests, one screen, opposite claims; and asserted pagination against whatever fixtures happened to exist |
| `16` | "0 meet-time cells" | meet time moved to Site Admin in the redesign; and its §9 assertion invoked an RPC from psql with no session, so it had never run |
| `17`, `18`, `26`, `35`, `37` | validation and lookup failures | four canonical teams and every pitch had gone from the automated UAT club, and there is no Rugby League tenant at all |
| `22` | "0 offered of 1 active" | counted active editions **platform-wide** and compared with a lookup correctly scoped to the club's own rugby code — so the isolation rule working read as a failure |
| `27` | no create affordance on the U7/U8 lane | Calendar draws lanes only when the week has entries; the suite navigated to a week and hoped something was in it |
| `29`, `34` | "Away suggests the opposition's primary ground" suggested nothing | **a real product defect** — see §11 |
| `19`, `23`, `26`, `38` | twelve `color-contrast` failures | one pre-existing application-shell defect, declared by Step 6, failing four suites that neither caused it nor can fix it |
| `37` | left two competitions behind after reporting success | its cleanup deleted from `audit_log`, which is append-only, so the raise aborted the cleanup **before** it reached the competitions — and the next suite read them as real platform data |

Every one is closed. The suites now state their own preconditions
(`scripts/browser-verification/fixture-world.mjs`), sweep their own tag before
seeding so a crashed run cannot poison the next, and reclaim rows a previous
crash left behind.

**And the records they were reading had never been seeded at all.**
`supabase/seeds/local_uat_fixture_operations.sql` provides Preston
Grasshoppers' teams and its one pitch — deliberately, so that opposition
defaults and "asked, not booked" can be proved — but nothing anywhere creates
the four age-grade teams or the pitches at Ovalball UAT Ground that nine suites
depended on. They existed only in one working database, and when they went the
suites reported product defects. So this is not "the local database drifted": a
clean boot would have failed those nine suites too, and now does not.

## 5. Fixture Import — §7–§12

**ALREADY COMPLETE, verified, connected.** One engine, two authority scopes,
sharing the Planner's validator. Parser, formats, mapping, preview, validation,
duplicate decisions, resolution, staging, publish-with-exclusions, batch
history and the audit trail all exist and are exercised by suites `17`, `18`,
`26`, `30` and `supabase/tests/club_fixture_import.sql`.

Step 7 added the **connection** proof §L asks for (suite `78`): a row created by
import appears in the Control Centre, is found by search, is the same canonical
fixture id the Calendar links, and carries canonical venue **and** pitch ids
rather than typed names.

Commit semantics are **explicit partial acceptance**, not an atomic batch:
`publish_import_row` publishes per row and the batch reports
`completed_with_exclusions` with the failures named. That is the existing
design and is now stated rather than implied.

## 6. Season Planner — §13, §14

**PRESERVED.** Nothing in the spreadsheet contract was touched: fill handle,
clipboard in both directions, rectangular TSV, context menu, multi-cell
selection, clear, keyboard lookup, cached authorised opposition and venue data,
bulk save. Suites `15`–`18`, `20`–`22`, `26`–`28` and `34` all run in the
release gate now, which they did not before.

## 7. Single-fixture flow — §34

**PRESERVED and proved.** Create, edit, venue, pitch, home/away, opposition,
match type, save, cancel, status and display, through the one Edit Fixture
sheet shared by Control Centre, Calendar and fixture detail. Suite `29`.

## 8. Fixture Control Centre — §17, §A, §B, §F

The surface already carried an attention band, a text search, eleven filters,
five sorts, in-place editing, bulk selection, export, a phone layout and two
distinct empty states. Step 7 closed what was missing:

- **Period navigation (§20, §B).** Previous / This Week / Next as ordinary
  links carrying two dates in the URL — so the back button restores the view,
  the view is shareable, and three consecutive Saturdays cost three key
  presses rather than three dialogs. Week or month, plus a picker for the job
  a picker is genuinely good at: jumping somewhere specific, which selects the
  period *containing* that day so choosing a Wednesday still shows the
  Saturday. `lib/fixtures/date-window.ts`, with 18 unit assertions.
- **Match type (§19).** `game_type` was canonical, was shown on the phone card,
  and appeared nowhere on the desktop grid or in any filter. Both now, from
  `GAME_TYPE_OPTIONS` — the one taxonomy.
- **Availability summary (§29, §I).** See §14.
- **An actionable canonical state (§F).** "At home, with no ground set" joins
  the band. It is a state of the fixture (`home_away = 'Home'` and
  `venue_id is null`), not an invented status, and it is the one on the band a
  club can immediately clear.
- **Two corrections.** *Clear filters* listed seven of ten, so a team or season
  filter could be applied with no way offered to clear it. And the column
  headed *Venue* led with the pitch; the venue leads now, with the pitch under
  it.

## 9. Fixture Search — §23, §24

**ALREADY COMPLETE / VERIFIED, extended.** A canonical authorised search exists
inside the Control Centre: a debounced text query across club, team,
opposition, competition and venue, plus ten structured dimensions, all
server-side predicates on `admin_fixture_overview`. Step 7 added match type and
the date window and did **not** build a second search route — which would have
been search #2.

Privacy is structural rather than filtered: `admin_fixture_overview` is
`security_invoker = true`, so `fixtures_select_related` is the boundary and the
`clubId` argument in `buildAdminFixtureQuery` is a convenience. Proved against
an unrelated club's identity in suite `53` and
`supabase/tests/fixture_cohort_isolation.sql`.

## 10. Calendar — §26, §G

Lanes are built once (`lib/calendar/build-lanes.ts`) and consumed by Week,
Month and Agenda. Step 7 added the fact a lane has any activity at all, and the
filter now **files** quiet teams behind one named control — *"Show 4 teams with
nothing scheduled"* — rather than mixing eighteen equal choices together or
deleting any of them. Three things are never filed: the lane currently
selected, a lane whose activity was never resolved, and a group lane that
exists because a real fixture referenced it.

The context matrix (§G) is covered by suites `20`, `27`, `51`–`59` and
`supabase/tests/calendar_component_filtering.sql`.

## 11. Venue and pitch integration — §15

Step 6 made venue and pitch canonical. Step 7 found that one consumer could not
read them, and fixed it at the boundary rather than around it.

**THE DEFECT.** `lib/fixtures/venue-defaults.ts` has always said that an away
fixture suggests the opposition's default ground and, where that ground has
exactly one pitch, that pitch. The rule is right. The branch was dead.
`club-catalogue.ts` and `fixture-editor.ts` both resolved it by reading
`public.venues` through the caller's own client — and `venues_select` answers
`venue.venue.view` **at that club**, so a fixture secretary arranging a match
at Preston could not read Preston's venue rows. RLS does not refuse; it returns
nothing. The ground still appeared, because the code fell through to the Club
Directory's free-text `home_ground`; the pitch silently never did.

**THE FIX.** `public_venues` — the projection that exists to tell a visiting
club where to turn up — gained `is_default_home` and `only_pitch_name`, and
both consumers read it. Nothing private was published: `only_pitch_name` is
null unless a ground has exactly **one** active pitch, so a club's pitch layout
is not enumerated, and the migration asserts the exact published column set so
a future `ALTER` cannot widen it silently.

This is the same failure mode Step 6 kept meeting, in a third place: **a
feature that depends on a read it is not authorised for does not raise, it
returns no rows, and the absence reads as "there is nothing to suggest".**

## 12. Pitch allocation — §27

**Reproduced, classified, fixed, and given a permanent regression.**

The board clamped any fixture needing a lane beyond the pitch's configured
capacity into the **last** lane — the comment said "so it still renders
somewhere rather than being silently dropped". What it did was render it in the
same square as the booking already there, with the lower card invisible
underneath. And an ordinary one-lane pitch never reached the lane code at all,
so a genuine double-booking drew both cards at identical coordinates.

**Classification: PRESENTATION.** The allocation had correctly placed both
fixtures on the pitch, the canonical `pitch_id` on each was right, and
`detectConflicts` had already flagged the clash. The board had decided in
advance how many rows it was willing to draw. No canonical id was changed,
which §27 forbids.

The fix is the one the training layer beside it already used: count lanes from
the bookings and let the row grow. The pitch's declared `lane_count` keeps the
job it is for — deciding what counts as a conflict — and the caption still
states the declared capacity, because a one-lane pitch that has been
double-booked is still a one-lane pitch. The rule moved to
`lib/pitch-allocation/lanes.ts` so it could be asserted at all: it was private
to a client component, which is exactly why it survived to a live report.
`supabase/tests/js/pitch_allocation_lanes.test.mts`, 11 assertions, the first
of which is the reproduced case.

## 13. Training season occurrences — §28

**DEFERRED TO TRAINING MANAGEMENT**, with the dependency named.

The recurrence architecture exists and there is exactly one of it:
`training_plans` + `training_plan_schedule_rules` → `generate_training_plan_sessions`
→ `training_sessions`, with `preview_training_plan_occurrences` before
committing. Two of the three editing semantics are implemented —
**this occurrence** (`override_training_session`, with `is_overridden` on the
session) and **the series** (`save_training_plan`). **This and all future
occurrences** does not exist.

It is deferred rather than built because implementing it means splitting a
schedule rule at a date inside `training_plan_schedule_rules` — a change to the
recurrence model itself, which is Training Management's, not Fixture
Operations'. Building it here would be recurrence architecture #2 by another
name. Suite `14` and `training_plan_regenerate_idempotency_regression.sql` prove
the two that exist still work.

## 14. Availability — §29, §I

**STEP 7 DISPLAY. Not the Step 9 response experience.**

`public.player_fixture_attendance` has held `ATTENDING` / `CANNOT_ATTEND` /
`UNSURE` since the attendance work, and "not responded" is the absence of a
row. Operational fixture surfaces could not say so. They can now, through
`public.fixture_availability_summary`.

What Step 7 built is a read. There is no way to answer from it, no per-player
names, and no route into responding — the parent and player journey that
produces these numbers is a later step's.

Two properties matter more than the arithmetic:

- **A fixture the caller has no attendance authority over is ABSENT from the
  result.** Not a zero, and not a row of nulls: absence is the only answer that
  says nothing at all, including nothing about whether the fixture exists.
  A count read through RLS would have returned zero rows and rendered an
  authoritative *"0 of 22 have replied"*, which is not false-ish, it is false.
- **The authority is the one that governs the data** — `team.attendance.view`,
  the same capability `player_fixture_attendance`'s own policies answer, not
  the fixture-management authority the Control Centre's other actions use. A
  definer function that authorises on a different capability from the data it
  reads is how a caller ends up able to count what they may not see. The
  migration asserts this structurally.

**The first version of this function was wrong, and the permanent test caught
it.** It filtered the requested ids with `select ... from public.fixtures where
id = any(...)` and treated the survivors as "what this caller can see" — but the
function is `SECURITY DEFINER`, so RLS never applied and every id came back.
The condition is now the authority itself, which is both narrower and simpler.

## 15. Competition projection — §30, §31, §32

**LOCKED MODEL, ALREADY ENFORCED.** `internal.sync_competition_match_fixtures`
moves home/away from participant identity rather than stored team order,
refuses a venue or pitch that does not belong to the owning club, cancels and
re-projects when the organiser replaces a team, and records `sync_error` rather
than failing the organiser's action. `competition_match_fixtures` is unique on
`fixture_id`. Suites `31`, `33`, `35`, `36`, `54` and
`supabase/tests/competition_matches.sql`, `competition_authority_matrix.sql`.

## 16. Public privacy — §33

Re-proved unchanged. `public_club_fixtures` withholds friendly results; that
decision was not revisited.

`public_venues` is the one public projection this step touched, and widening it
by two columns made an existing assertion fail — correctly, and usefully.
`venue_training_authority_matrix.sql` said *"that projection carries three
columns, not the venue row"* and counted them. A count passes for any three and
fails for a deliberate fourth without saying which, so the assertion now **names
the set** (`club_id,id,is_default_home,name,only_pitch_name`) and adds a second
one that no future column may ever be an address, a postcode or a pin. The
migration guards the same set at migration time, and the clean boot guards it
from empty: three places, one list, and a widening has to be meant.

## 17. Concurrency — §36

Covered by the existing race suites, which now run in the gate:
`fixture_creation_races.test.mts`, `competition_authority_races.test.mts`,
`venue_training_authority_races.test.mts`, plus the duplicate-import and
same-day capacity rules (`internal.enforce_shared_team_fixture_capacity`,
which is what refused this step's own second seeding attempt on the same date —
a rule doing its job).

## 18. Mobile — §37

1440 / 390 / 320 on the Control Centre, Planner, Import, Calendar, Fixture
Search and Match Centre continuation. Suites `23`, `15`, `26` and `78`. The
period stepper keeps a 44px touch target at 320px, where it stacks rather than
shrinking.

## 19. Accessibility — §38, §39

axe (WCAG 2.1 A/AA) on every changed fixture surface. **No serious violation
introduced.**

The two pre-existing violations Step 6 declared are unchanged and unhidden. One
of them is in the **application shell** — the unread badge on the notification
bell and the messages popover — so it is present on every authenticated page
and was failing four fixture suites twelve times over for a defect none of them
caused. The declaration now lives once, in
`scripts/browser-verification/harness.mjs`, matched on rule **and** element so
it cannot excuse a colour-contrast failure somewhere else, printed as a `NOTE`
on every run, and shrink-only.

**Root cause, since it is short:** both badges set `bg-pitch-600 text-white`
directly. `app/globals.css` already records that this pair measures about 3.1:1
and already solved it site-wide by making `--primary-foreground` dark ink on
that same green. The two components predate and bypass that decision. It is a
token change, not a redesign — and it is **not made here**, because §39 says
these are not Step 7's work unless Step 7 modifies the owning component, and it
does not.

**Test-infrastructure repair (§39).** `07-accessibility.mjs` read axe from an
absolute path under a job directory deleted long ago, so it could not start —
and a suite that cannot start proves nothing while looking like it might. It
now reads the project's own `axe-core`. Five suites had the same stale path as
their screenshot directory; they write to a gitignored `.screenshots/`.

## 20. Step 6 regression — §40

Re-run green: L17 (`club_directory_privacy`), venue/pitch integrity
(`club_venue_pitch_integrity`), structured address
(`structured_venue_address`), the logo and theme resolvers (suite `76`), club
and team scope. Fixture Operations consumes the Step 6 foundation rather than
working around it — §11 above is the clearest example, where the answer was to
use the canonical projection rather than to widen a policy.

## 21. Auth and security regression — §41

Steps 4–5 unchanged and re-proved by the suites already in the gate: post-login
to `/dashboard`, safe-next, the session contract, `auth_flow_states`, AAL2, Site
Admin capability authority, CSP, invitation and joining.

Fixture convenience created no bypass. The one new continuation surface —
Match Centre's return path — deliberately does **not** call `safeNextPath`. That
helper answers "is this somewhere on Ovalball", which is the right question
after signing in and the wrong question here. `lib/fixtures/return-context.ts`
answers the narrower one — "is this one of the five surfaces a fixture is
actually opened from" — and discards anything else rather than sanitising it.
There is no reachable value of `from` that leaves the application, names an
arbitrary internal route, or carries a parameter the destination does not
already parse. 13 unit assertions cover the whole refusal family, and suite
`78` walks them in a real browser.

## 22. Migrations

Two, both additive:

| | |
|---|---|
| `20270514000000_a_fixture_can_say_how_many_have_answered.sql` | `internal.fixture_attendance_readable_team_ids`, `public.fixture_availability_summary`, with a migration-time guard that the authority stays `team.attendance.view` |
| `20270515000000_a_visiting_club_is_told_which_pitch_to_turn_up_on.sql` | `public_venues` gains `is_default_home` and `only_pitch_name`, with a migration-time guard on the exact published column set and on the view staying owner-rights |

No table was altered, no column dropped, no policy widened.

## 23. Clean boot — §44

`scripts/isolated-clean-boot.sh`: a second Supabase project on its own ports,
built by the CLI from empty. 536 migrations applied, then the estate's own
assertions run against the fresh database.

Step 7 added its own assertion block, following the pattern Step 4, Slice 7e
and Step 6 each established — because both of its migrations are the kind whose
mistake is invisible on a database where nobody looks. It checks that the
availability summary exists and authorises on `team.attendance.view` and **not**
on fixture-management authority, that `anon` cannot execute it, that
`public_venues` publishes exactly its five declared columns, that it is still
owner-rights, and that it carries **no address, postcode or coordinate**.

`fixture_availability_summary.sql` and `fixture_search_and_venue_authority.sql`
now run there too, so Step 7's behaviour is proved from empty rather than only
on a database that has been lived in.

**CLEAN BOOT: PASS.**

```
PASS clean boot: the migration chain installs from empty and Step 4's objects are correct
PASS clean boot: Slice 7e's objects are correct from empty, including what it removed
PASS clean boot: Step 6's objects are correct from empty, including what they revoked
PASS clean boot: Step 7's objects are correct from empty, including what they publish
   auth_flow_state_authority            28 passed, 0 failed
   definer_rpc_session_contract         37 passed, 0 failed
   security_perimeter_guard              6 passed, 0 failed
   site_admin_users_access_closure      37 passed, 0 failed
   authority_helper_retirement          77 passed, 0 failed
   club_venue_pitch_integrity           21 passed, 0 failed
   club_directory_privacy               19 passed, 0 failed
   fixture_availability_summary         12 passed, 0 failed
   fixture_search_and_venue_authority   15 passed, 0 failed
```

## 24. Production-shaped rehearsal — §45

From the **real production tip, `20270503000000`** — 524 migrations — because
Steps 5 and 6 are banked and unreleased, so the next release applies all twelve
of `20270504…20270515` together. Rehearsing only Step 7's two would prove less
than a release actually does.

Each of the twelve applied one at a time, each preceded by a dry run inside a
rolled-back transaction. The measure was widened to the tables §45 names:
`fixture_requests`, `competitions` and `competition_matches` join the club-domain
counts.

**The first run reported FAIL, and it was the report rather than the migrations.**
Widening `measure()` left the delta's own label list three short, and the length
guard Step 6 added — after a label misalignment it had to go back and correct —
refused to print a misaligned report. Every migration had applied cleanly with a
clean dry run and no row had moved; the guard fired on the reporting, which is
exactly what it exists for. Labels realigned, and the guarded list widened with
them so the three new counts are also ones a migration may not move.

**REHEARSAL: PASS.**

```
-- delta
   site_* functions            29 ->    33   <-- +4
   policies                   594 ->   594
   capabilities               239 ->   239
   profiles                    15 ->    15
   club_memberships             4 ->     4
   role_assignments             5 ->     5
   site_admins                  2 ->     2
   clubs                        2 ->     2
   venues                       2 ->     2
   club_pitches                 1 ->     1
   teams                       10 ->    10
   fixtures                     2 ->     2
   fixture_requests             0 ->     0
   competitions                 0 ->     0
   competition_matches          0 ->     0
   internal.is_site_admin       1 ->     0   <-- -1

   site_admin_users_access_closure   37 passed, 0 failed
   authority_helper_retirement       77 passed, 0 failed
   security_perimeter_guard           6 passed, 0 failed
   definer_rpc_session_contract      37 passed, 0 failed
```

Four new `site_*` functions and the retirement of `internal.is_site_admin` are
the only movements, and both are what the twelve migrations say they do. **No
club, venue, pitch, team, fixture, request, competition, competition match,
profile, membership, role assignment or administrator moved.** Nothing in this
rehearsal touched production: it rehearses production's SHAPE — the same tip,
the same order, one at a time — not its data, and says so.

## 25. Persistent review world — §42, §49

Extended, never replaced. `Step 2 Review RFC` keeps its people, its teams, its
roles and its two grounds; Step 7 adds a season of fixtures through
`create_fixture` and `submit_fixture_result` **as the review Club Admin**, not
by direct insert — the same discipline Step 6 adopted after finding that seed
files produced venue rows the product itself could not have produced.

Six fixtures, chosen so that every Step 7 surface has something real to show:

| | |
|---|---|
| 27 Sep, 10:30 | Under 12 Boys v Aberaeron, Claro Road, **Main Pitch** |
| 27 Sep, 10:30 | Under 14 Girls v Aberavon Green Stars, Claro Road, **Second Pitch** |
| 4 Oct, 14:00 | Men's 1st Team v Aberavon Harlequins, **Pannal Playing Fields**, Cup Fixture |
| 11 Oct, 11:00 | **Away** at Aberavon, Friendly |
| 6 Sep, 10:30 | played — **24–17** recorded through `submit_fixture_result` |
| 18 Oct | **To Be Determined**, no kick-off, no pitch |

Two match days at one ground on the same morning gives Pitch Allocation
something to arrange; the away fixture gives the naming rule something to
reverse; the TBC and the recorded result together populate the Control Centre's
attention band.

No new persona was needed — the existing cast covers every context Step 7
exercises. `enrich-fixtures` is idempotent and refuses a club that already has
fixtures. `verify` reports two approved join requests as drift from the
recorded baseline; that is the product owner's own review work and was
**reported, not touched**.

Automated tests use the separate automated UAT club and disposable data. None
of them reaches the review world.

## 26. Browser UAT — §K, §L, §M

Suite `78` is the end-to-end administrator journey the brief asks for, using
real application navigation and canonical persisted data: Control Centre →
search → inspect → change the pitch by canonical id → save → Control Centre →
Calendar → Match Centre → back to the **originating** Control Centre context
with its filters intact, plus an away variant, the return-path refusals, the
period stepper, match type, the availability summary and its absence, the
Calendar filter, and the import → operations and planner → operations
connections.

Three things it taught while being written, all of them about the suite rather
than the product, and all of them fixed in it:

- **A row is identified by its fixture id, not by text.** The first draft
  searched the page for its own run tag. The Control Centre correctly shows the
  opposition's real *club name* — the tag lives in `raw_opposition_text`, which
  the search matches and the screen is right not to print — so the suite was
  looking for something the product should not show. The seed now names a real
  Club Directory opponent and the assertions follow the id.
- **Waiting for the network is not waiting for the page.** The period stepper is
  a client-side navigation, so `click()` returns before the router has pushed;
  reading the URL then reported "nothing moved", and pressing Back then popped
  the entry *before* the Control Centre. It reads as a broken stepper and was a
  test racing its own page. Every stepper assertion now waits for the URL it
  expects, and the Back assertion additionally waits for the row to be on the
  page — the URL arriving is not the view arriving.
- **A week has to be inside a season.** The Calendar's season view is bounded by
  the canonical seasons register, so fixtures dated a year out were not on its
  grid at all. The suite now picks the first quiet week at least sixteen weeks
  ahead that is still inside the club's current season.

## 28. The fixture card information contract — §J

Which canonical fields each primary fixture surface intentionally shows. The
requirement is not that every field appears everywhere; it is that an omission
is a decision rather than a page that drifted.

| Field | Control Centre (desktop) | Control Centre (phone) | Calendar | Match Centre | Public club page |
|---|---|---|---|---|---|
| Date | ✅ | ✅ | ✅ (position) | ✅ | ✅ |
| Kick-off | ✅ (under the date) | ✅ | ✅ | ✅ | ✅ |
| Meet time | Site Admin only | — | — | ✅ | — |
| Home side named first | ✅ (as Our Team + H/A) | ✅ | ✅ | ✅ | — (club's own framing) |
| Owning Ovalball team | ✅ | ✅ | ✅ | ✅ | ✅ |
| Opposition | ✅ | ✅ | ✅ | ✅ | ✅ |
| Home / away, in words | ✅ | ✅ | ✅ | ✅ | ✅ (tag) |
| **Match type** | ✅ **new** | ✅ | — | ✅ | — |
| Venue | ✅ | — | ✅ | ✅ | — |
| Pitch | ✅ (under the venue) | ✅ | ✅ | ✅ | — |
| Postcode / address | — | — | — | ✅ | — |
| Weather | — | — | — | ✅ | — |
| Status | ✅ | ✅ | ✅ | ✅ | ✅ |
| Result | ✅ | ✅ | ✅ | ✅ | ✅ (friendlies withheld) |
| Request state | header sheet | — | — | — | — |
| **Availability summary** | ✅ **new** | ✅ **new** | — | ✅ (full panel) | — |
| Club crest | ✅ | — | ✅ | ✅ | ✅ |

**The deliberate omissions.** The public club page never names a pitch, a
postcode or an availability count — it is a public page and those are
operational. The Calendar carries no match type because its unit is a week and
the lane already says whose it is. The phone Control Centre card drops the
venue and keeps the pitch, because the ground is almost always the club's own
and the pitch is the thing that changes. Meet time is Site Admin only on the
Control Centre because it is secondary detail that belongs with the fixture,
and it is on Match Centre, where the squad reads it.

## 29. Canonical fixture presentation — §C, §D

**§C.** Six surfaces each decided independently which side of a fixture to name
first, and five of them named the owning team whatever the answer was — so an
away match at Fylde read *"Under 12 Mixed v Fylde"*, which says our side is at
home. The sixth, the family agenda, had the rule right, written inline and
reachable from nowhere else.

`lib/fixtures/presentation.ts` is the rule now, and the surfaces call it: the
Calendar's season week, the family and parent agenda card, the Dashboard's next
match, the Edit Fixture confirmation, and the Control Centre's phone card. One
separator constant, so no surface can drift to "vs" — one already had.

**§D.** Cross-surface identity is asserted in suite `78` by recording the
fixture id and then finding a link to that exact id on the Control Centre, the
Calendar and the Fixtures list, for the same fixture, after an edit. For a
competition-derived fixture the relationship is asserted in
`supabase/tests/competition_matches.sql`: a Competition Match with an optional
Fixture projection, unique on `fixture_id`, with the two identities never
confused.

## 30. Fixture request and negotiation lifecycle — §E

Traced, not merely regression-tested. The canonical states are
`draft · sent · accepted · declined · counter_proposed · cancelled · expired`
on `public.fixture_requests` — recovered from the CHECK constraint, not
invented. The lifecycle: a request is created by a team's own staff
(`create_fixture_request`), appears to the recipient club through
`getIncomingFixtureRequestsSummary` and the Club Desk, is answered by
`accept_fixture_request` / `accept_fixture_request_with_team_action` /
decline, produces a fixture on acceptance (`resulting_fixture_id`), and that
fixture then behaves like any other in the Control Centre and the Calendar.
Suite `34` walks both clubs through it end to end, including the proposed
ground and pitch surviving into the fixture. There is no second request state
machine and Step 7 did not add one.

## 31. Test totals



Suite `78`, the Step 7 journey, runs **57 assertions** and is green.

| | suites | passed | failed |
|---|---|---|---|
| SQL and TypeScript | **252** | **5,195** | **0** |
| Browser journeys | **44** | **1,061** | **0** |
| **TOTAL** | **296** | **6,256** | **0** |

Every one of the 44 suites named in `BROWSER_SUITES` ran and is accounted for —
checked by diffing the list in the runner against the suites that actually
reported. Twenty-eight of those 44 were not in the release runner before this
step.

Also green, outside the runner: typecheck, `next build`, `diff --check`, the
content standard, the Match Centre and Pitch Allocation shared-surface
verifiers, and the authority-guard baseline. Lint is unchanged at **4 errors,
175 warnings**, all pre-existing (`recovery-flow.tsx`, `club-step.tsx`,
`activity-card.tsx`'s training card, `messaging-panel.tsx`) and none in a file
this step created.

**A note on how the gate had to be run, because it matters for reading the
numbers.** The machine this ran on was under sustained memory pressure from
outside this work — 17 GB of 18 GB swap in use, about 60 MB of RAM free, with a
long-running browser session and twelve Docker containers already resident. The
first attempt at a single end-to-end gate was **killed by the operating system
for low memory** partway through the browser suites.

That is the condition §46 is about, and the distinction Step 6 had to establish
the hard way: **resource starvation produces stalls and kills, not assertion
failures.** Nothing failed; the process was stopped, three times. The suites
were re-run in smaller sequential groups — eventually one or two at a time — so
that each run's browser is short-lived. No suite was skipped, no assertion was
weakened, and nothing is reported as passing that did not run.

**Two clean batches were not achieved for the browser half, and that is stated
rather than implied.** The SQL and TypeScript half ran clean **twice**; the
browser half ran clean **once**, in groups, because this machine could not hold
a single end-to-end batch. If the product owner wants the two-batch standard
Step 6 set, it needs a quieter machine, and that is a scheduling question
rather than an engineering one.

## 32. Functionality

| | |
|---|---|
| **FUNCTIONS BEFORE** | **88** |
| **FUNCTIONS AFTER** | **88** |
| **FUNCTIONS LOST** | **0** |

## 33. Final disposition — every backlog item, stated — §N

Every original Fixture Operations backlog item, stated.

| Item | Disposition |
|---|---|
| Fixture Import | **ALREADY COMPLETE / VERIFIED** — one engine, two authority scopes; connection to operations newly proved (§L) |
| Fixture Search | **ALREADY COMPLETE / VERIFIED**, extended with match type and the date window; privacy proved against an unrelated club |
| Season Planner | **ALREADY COMPLETE / VERIFIED**, preserved untouched, now in the release gate |
| Fixture Control Centre | **COMPLETE** — period navigation, match type, availability, the venue-missing state, two corrections |
| Away presentation | **COMPLETE** — the home side is named first, from one rule, on every surface |
| Match type | **COMPLETE** — on the fixture and as a server-side filter, from the one taxonomy |
| Week / date slider or navigation | **COMPLETE** — a link stepper with week and month periods, plus a picker for a specific date |
| Date grouping | **ALREADY COMPLETE / VERIFIED** — the Control Centre's combined Date cell carries day and kick-off together and the default sort is by date, which the earlier redesign chose deliberately over a heading row per match day; the period window now bounds it |
| Logos | **ALREADY COMPLETE / VERIFIED** — every crest on a fixture surface goes through `ClubAvatar` and `resolveClubLogoUrl`, the Step 6 canonical resolver. Audited: `logo_storage_path` appears on these surfaces only as the field being handed to that resolver, never as a hand-written fallback, and a crest changed in Club Settings shows on the next render with no propagation logic of its own |
| Club colours | **ALREADY COMPLETE / VERIFIED, and deliberately not applied here.** `ClubThemeScope` from `club_kits` themes the club-identity surfaces (suite `76`); the operational fixture surfaces keep the product palette, because a Fixture Control Centre that changes colour with the club would make status, attention and refusal colours mean different things at different clubs. No fixture-specific colour resolver exists, which is what §21 forbids |
| Weather | **ALREADY PRESENT AND VERIFIED** — Met Office DataHub adapter with lead-time-derived caching on rounded coordinates, an explicit `PROVIDER_UNAVAILABLE` state and a documented refusal to fabricate a forecast; a credential is configured locally, so this is a live integration and not a stub. No new provider was introduced |
| Postcode | **ALREADY PRESENT AND VERIFIED** — Match Centre renders the venue's canonical structured address and postcode as real text beside the map, which is the surface a travelling parent uses. Deliberately not added to the Control Centre list, where it would be a third line on a dense row for information an administrator already knows |
| Match Centre return path | **COMPLETE** — a surface allowlist, not a URL; every other target resolves to `/fixtures` |
| Calendar empty-team filtering | **COMPLETE** — filed behind one named control, never removed |
| Training season occurrences | **DEFERRED TO TRAINING MANAGEMENT** — "this occurrence" and "the series" exist; "this and all future occurrences" means splitting a schedule rule inside `training_plan_schedule_rules`, which is the recurrence model itself |
| Pitch-allocation split square | **COMPLETE** — reproduced, classified as presentation, fixed, with a permanent regression |
| Availability counts and responded state | **COMPLETE as STEP 7 DISPLAY.** The Step 9 response experience is not implemented and was not pulled forward |
| Fixture request / negotiation lifecycle | **ALREADY COMPLETE / VERIFIED** — traced end to end across both clubs; no second state machine added |

## 33b. Protected logo provenance — CLOSED, and the discrepancy was never real

Step 6 carried forward a provenance mismatch on the two protected logo files
and correctly refused to investigate it. **It does not exist.**

Step 6 compared the files against the canonical record `be2bef0c…` /
`bdd32248…` using `git hash-object`, which prefixes `blob <size>\0` before
hashing and is therefore **not** the file's SHA-1. Its own table said so in the
column header — "SHA-1 (`git hash-object`)" — and that parenthesis was the
whole of it.

| | `Ovalball Square Logo.png` | `Overball Logo Low Res.png` |
|---|---|---|
| plain SHA-1 | `be2bef0c978869aaa73e474cd5abdf5aec1fff6c` | `bdd3224871f0561d971f93f519764f0502092504` |
| `git hash-object` | `aca33ffc9812cb3e65f29232bb73140bdcced288` | `1a4f167526fec91375ac8f337f61feca0fd80fff` |
| size | 1,151,454 | 1,140,858 |
| mtime | 2026-09-09 23:32:50 | 2026-09-09 23:32:50 |

The plain SHA-1 matches the canonical record exactly, and every other digest,
both sizes and both mtimes match Step 6's own table. **The files are
byte-identical to what the canonical record describes, and always were.** The
canonical record needs no update.

Neither file was read into, written to, staged, restored or replaced at any
point in Step 6 or Step 7. Verified byte-identical at the start and at the end
of this step; both remain untracked.

## 34. Later-owned

Carried forward untouched: **L7** (the contract half of the legacy invitation
retirement), **L11** (a deep link dropped at sign-in), **L15** (fourteen
perimeter-manifest consumer declarations belonging to other slices), **S7-13**
(a second production Full Site Admin — owner action).

Explicitly **not** pulled into Step 7, per §O: the Parent/Player availability
response journey, polls, Kudos, post-match community write-ups, Players' /
Parents' / Coaches' / Opposition Player, work-ethic and Beast awards, award
configuration, badges and voting eligibility. The fixture data and API surfaces
support them; none is implemented.

New, and named rather than fixed:

- **The application-shell unread badge** fails `color-contrast` on every
  authenticated page. Root cause and the one-token fix are in §19. It belongs
  to whichever step owns the shell.
- **"This and all future occurrences"** for training — §13.

## 35. Deferred manual review checkpoint

The product owner reviews by hand, in Chrome, against the local stack. The
review club is `Step 2 Review RFC` and it now has a season in it.

```
node scripts/review-fixtures/step2-review-club.mjs enrich-fixtures   # once
node scripts/review-fixtures/step2-review-club.mjs report
```

Six fixtures through `create_fixture` as the review Club Admin: two match days
at Claro Road on the same morning and on different pitches (so Pitch Allocation
has something to arrange), one at Pannal Playing Fields, one away, one already
played with a result, and one still To Be Determined — which is what the
Control Centre's attention band is for.

What that makes reviewable without any further setup: the Control Centre with
its period stepper, match type, venue and pitch; Fixture Search; the Calendar's
team filter with quiet teams filed; Match Centre and its return path; Pitch
Allocation with two bookings on one morning; and the away fixture reading
"Opposition v Under 12 Boys".

`enrich-fixtures` is idempotent and refuses to touch a club that already has
fixtures — the product owner's own fixtures are review material, not clutter
for a script to tidy.
