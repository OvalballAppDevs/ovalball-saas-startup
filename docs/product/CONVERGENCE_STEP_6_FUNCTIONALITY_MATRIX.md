# Convergence Step 6 — BEFORE / AFTER functionality matrix

§3 is a hard programme gate: **functions lost must be zero.** This is the
inventory the step is measured against, taken from the code and the schema
before implementation, and re-checked after.

Each row is a function the product legitimately performed. "Where" names the
canonical writer, because that is what a convergence step is allowed to move.

---

## Club identity and profile

| # | Function | Before | After |
|---|---|---|---|
| 1 | Create a canonical club directory record | `admin/clubs/actions.ts` → `club_directory` insert (RLS `site.directory.manage`) | unchanged |
| 2 | Edit directory name / town / county / postcode / website / code | `admin/clubs/actions.ts` field updates | unchanged |
| 3 | Edit directory `notes`, `official_email`, provenance, verification | same | unchanged writer; **read** now via `site_club_directory_record` |
| 4 | Activate a club (create the `clubs` row) | club claim approval | unchanged |
| 5 | Edit club bio / website / socials / established year | `ClubProfileForm` → `clubs` | unchanged |
| 6 | Upload, replace and remove the club crest | `club/actions.ts` + `club-logos` bucket | unchanged |
| 7 | Directory crest as a seed/fallback for a club with no upload | `resolveClubLogoPath` | unchanged rule, **one** implementation (was 11) |
| 8 | Choose public visibility of website / ground / address / postcode | `clubs.show_*` flags | unchanged |
| 9 | Set home kit and away kit; "we play in our home shirts away too" | `upsert_club_kit`, `KitSection` | unchanged |
| 10 | Derive the club theme from the home kit | `resolveClubTheme` / `clubThemeVariables` | unchanged |

## Venues

| # | Function | Before | After |
|---|---|---|---|
| 11 | Create a venue | `create_venue` | `create_venue` (name, directions, default) **+ `set_venue_address`** |
| 12 | Name a venue / rename it | `update_venue` | `update_venue` |
| 13 | Record a venue address | **two ways**: `update_venue` (single line) *or* `set_venue_address` (structured) | `set_venue_address` **only** |
| 14 | Enter an address by search / autocomplete | `AddressLookupField` (setup only structured) | both surfaces structured |
| 15 | Enter an address manually, with no provider | supported | supported — now into structured fields |
| 16 | Record a postcode | `create_venue` / `update_venue` / `set_venue_address` | `set_venue_address` |
| 17 | Geocode a venue from its postcode | `geocodeVenueFromPostcode` after create/update | unchanged, both paths |
| 18 | Record directions / notes for a venue | `update_venue` | unchanged |
| 19 | Mark a venue the default home ground | `set_default_venue` / `is_default_home` | unchanged |
| 20 | Deactivate / reactivate a venue (never hard delete) | `set_venue_active` | unchanged |
| 21 | See a venue's address in Club Settings | `venues.address` only | derived line, **falling back to the structured parts** |
| 22 | Directions link from a venue | `directionsHref` | unchanged, now via the same derived line |

## Pitches

| # | Function | Before | After |
|---|---|---|---|
| 23 | Create a pitch, optionally attached to a venue | `create_club_pitch` | unchanged |
| 24 | Rename a pitch | `rename_club_pitch` | unchanged |
| 25 | Move a pitch between grounds, same club only | `set_club_pitch_venue` | unchanged |
| 26 | Reorder pitches | `reorder_club_pitches` | unchanged |
| 27 | Archive / restore a pitch | `set_club_pitch_active` | unchanged |
| 28 | Pitch size / lane metadata | `club_pitches` columns | unchanged |

## Teams

| # | Function | Before | After |
|---|---|---|---|
| 29 | Create a team from the canonical catalogue | Team Administration | unchanged |
| 30 | Seed teams from a claim's proposal | `internal.seed_teams_from_proposal` | unchanged |
| 31 | Confirm the team list during setup | `club_setup_state.teams_confirmed_at` | unchanged |
| 32 | Remove a provably pristine team during setup | `classify_team_removal` + `remove_setup_team` | unchanged |
| 33 | Fold a team that has history, keeping its identity | same pair | unchanged |
| 34 | Reactivate a folded team | Team Administration | unchanged |

## Setup

| # | Function | Before | After |
|---|---|---|---|
| 35 | Enter first-run setup as a legitimate administrator | `(app)/layout.tsx` + `club.profile.edit` | unchanged |
| 36 | Be told, without a redirect, that a club is unset up | `ClubSetupRequired` | unchanged |
| 37 | Resume setup at the first unfinished step | `club_setup_requirements` + `resumeStep` | unchanged |
| 38 | Re-derive every requirement from canonical data | `club_setup_requirements` | unchanged |
| 39 | Complete setup, server-validated and idempotent | `complete_club_setup` | unchanged |
| 40 | Reach configuration but not operations while gated | `isSetupAllowedPath` | unchanged |

## Fixtures and training consuming this data

| # | Function | Before | After |
|---|---|---|---|
| 41 | Set a fixture's venue | `update_fixture_venue` | unchanged **+ refuses a pitch/venue contradiction** |
| 42 | Set a fixture's pitch | `update_fixture_pitch` | unchanged **+ same check** |
| 43 | Set free-text pitch allocation where no pitch record exists | `update_fixture_pitch(p_pitch_text)` | unchanged |
| 44 | Schedule training at a venue and pitch | `create_training_session` | unchanged (already checked) |
| 45 | Override a training session's venue / pitch | `override_training_session` | unchanged (already checked) |

## Site Admin

| # | Function | Before | After |
|---|---|---|---|
| 46 | Search the club directory with suggestions | `/admin/lookups`, shared `Autocomplete` | unchanged |
| 47 | Administer any club's venues and pitches | `VenuesSection` with `readOnly` | unchanged |
| 48 | List, filter and export clubs | `admin_club_overview` | unchanged; view is now owner-rights **behind the same capability** |
| 49 | Open and edit one directory record | `select("*")` on the base table | `site_club_directory_record`, capability-gated |
| 50 | Data-quality counts and duplicate flags | `admin_club_overview` | unchanged |

## Public

| # | Function | Before | After |
|---|---|---|---|
| 51 | Public club home: name, crest, theme, public fields | `lib/club-public/*` | unchanged |
| 52 | Anonymous club directory search at signup | `club_directory` anon column grant | unchanged |
| 53 | Partner Clubs map from directory coordinates | `latitude`/`longitude` | unchanged — explicitly preserved in the L17 grant |
| 54 | Ovie opponent search by distance | same columns | unchanged — same |

---

## End-to-end proof references (§28)

Added by the closure pass. Every row below is now walked in a real browser, not
only asserted in SQL.

| Rows | Proved by |
|---|---|
| 6, 7 · crest upload and the directory fallback | `76-branding-propagation` S6BR-01/02/10/11/20, `75-first-club-setup-journey` S6S-10 |
| 9, 10 · kit and theme | `75` S6S-11, `76` S6BR-30/31 |
| 11–17, 19 · venue creation, structured address, postcode, default ground | `75` S6S-20/21, `74-club-venue-and-address` S6B-10/11/12 |
| 21, 22 · address redisplay and directions | `74` S6B-20/21 |
| 23, 28 · pitch created with its venue | `75` S6S-22/23 |
| 29–34 · teams listed and confirmed | `75` S6S-30/31 |
| 35–37 · setup entry, the bounded screen, resume | `75` S6S-01/02/03/04/05/06/07/13 |
| 38, 39 · server-derived requirements and completion | `75` S6S-12/40/43 |
| 41, 42 · fixture venue and pitch | `club_venue_pitch_integrity` S6VP-01…13 |
| 48, 49 · Site Admin club list and record | `76` S6BR-10/11 |
| 51 · public Club Home | `76` S6BR-01/10/20/30/31/40 |

Accessibility for the changed surfaces is `77-step6-accessibility` (19
assertions: axe on all three setup steps and the Club Settings venue editor,
semantics, keyboard order, validation focus, and the address combobox at 1440 /
390 / 320).

## Count

| | |
|---|---|
| **FUNCTIONS BEFORE** | **54** |
| **FUNCTIONS AFTER** | **54** |
| **FUNCTIONS LOST** | **0** |

### The four that moved, and why none is a loss

- **13 · Record a venue address.** Two writers became one. Both ways of
  *entering* an address — search or by hand — still work, on both surfaces. What
  was removed is the ability to write a display line that contradicts the
  structured columns, which was never a function anybody wanted.
- **21 · See a venue's address in Club Settings.** Strictly more than before: it
  now falls back to the structured parts when the derived line is absent.
- **41 / 42 · Fixture venue and pitch.** Both still settable. A contradictory
  *pair* is refused, with a message naming the two ways forward — and training
  already refused exactly this.
- **49 · Open a directory record.** Same data, same editor, reached through a
  capability instead of a table-wide grant.

### Added

| | |
|---|---|
| Structured address entry on the Club Settings venue editor (line 1, line 2, town, county) | previously setup only |
| `site_club_directory_record` | one capability-gated read of a directory record |
| `resolveClubLogoPathFrom` | the flat and unclaimed-opponent call shapes of the one logo rule |
