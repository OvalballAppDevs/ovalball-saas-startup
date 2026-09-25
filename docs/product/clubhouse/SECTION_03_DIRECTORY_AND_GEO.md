# Section 3 — Club Directory & Geo Coverage

## PURPOSE

Turn the existing rugby club directory into a trustworthy geographic foundation for Clubhouse — a repeatable, honest answer to "where is this club, and how do we know?" — without fabricating coverage. Every number in this document was queried directly against the live local database today, not carried forward from an earlier session's memory.

## BEFORE STATE (source-audited at checkpoint `1033e3b`)

Confirmed unchanged since the original architecture audit: 1,396 `club_directory` rows, 105 geocoded (7.5%), single geocode source (`postcodes.io`). What is NEW in this section's own audit, found by querying deeper than the original pass did:

- **All 1,396 rows are `rugby_code = 'union'`. Zero league clubs exist in the directory.**
- **Zero Republic of Ireland coverage.** `nation` breaks down as England 923, Wales 284, Scotland 177, Northern Ireland 12 — no rows at all carry `nation = 'Republic of Ireland'`, despite the check constraint explicitly allowing it. The 12 "Northern Ireland" rows come entirely from a source literally named `irish_rugby` — since the IRFU is an all-island governing body, this asymmetry (12 NI, 0 ROI) looks like an artefact of what got ingested, not a reflection of where Irish rugby clubs actually are.
- **Zero directory rows have a crest** (`logo_storage_path is not null` → 0 of 1,396). The Site-Admin crest-setting feature exists and is wired (confirmed in the original architecture audit) but has never been used.
- **A real, concrete "wrong-but-successful geocode" instance was found**, not merely theorised: Preston Grasshoppers RFC's directory postcode-centroid (53.786811, -2.644685) and its own `venues` row, "Lightfoot Green" (53.814141, -2.760304, entered by the club itself, `is_default_home`, `geocode_status='success'`), sit roughly 8km apart. Both carry `geocode_status='success'`. This is direct, current evidence for exactly the caution Section 2's documentation only cited from history.
- **`admin_verification_status` is `'TBD'` for all 1,396 rows** — a newer verification field exists in the schema but has never been exercised.
- **The "Online Directory Verification" research pipeline** (`club_directory_research_proposals`, `directory_verification_run_records` — found designed-but-unwired in the original audit) genuinely has zero rows in either table: confirmed still never run.

## DIRECTORY SCHEMA (queried directly, `\d public.club_directory`)

`id, name, rugby_code, country, nation, region, county, town, home_ground, address, postcode, website, official_email, source, external_id, source_url, source_updated_at, active, verification_status, notes, constituent_body, constituent_body_id, normalized_key, created_by, updated_by, created_at, updated_at, logo_storage_path, latitude, longitude, geocoded_at, geocode_status, geocode_source, bio, facebook_url, admin_verification_status`.

**No `location_precision`, `location_confidence`, or `location_method` column exists.** This is the real schema gap the directive anticipated — addressed below in LOCATION MODEL without a migration.

`club_aliases` (directory_id, alias, normalized_key, source) exists and is populated by governing-body naming variants — the alias/duplicate-detection infrastructure this section's DUPLICATES section relies on.

`clubs` (the activated-tenant table) still carries its own dead `latitude`/`longitude` columns, confirmed once again fed by nothing (unchanged finding from the original audit) — 6 of 6 activated clubs, 0 with those columns populated from any live pipeline.

## DIRECTORY COVERAGE (exact counts, queried live)

| Metric | Count | % of 1,396 |
|---|---|---|
| Total directory clubs | 1,396 | 100% |
| Rugby Union | 1,396 | 100% |
| Rugby League | 0 | 0% |
| Active | 1,396 | 100% |
| With lat/long (`geocode_status='success'`) | 105 | 7.5% |
| Geocode pending | 3 | 0.2% (all three are synthetic test fixtures, `99900000-...` seed IDs — not real clubs) |
| Geocode failed | 1 | <0.1% |
| Geocode no_postcode | 1,287 | 92.2% |
| With postcode | 106 | 7.6% |
| Without postcode | 1,290 | 92.4% |
| With address | 99 | 7.1% |
| With website | 76 | 5.4% |
| With crest | 0 | 0% |
| Linked to an activated Ovalball club | 6 | 0.4% |
| Directory-only (unclaimed) | 1,390 | 99.6% |
| Duplicate `normalized_key` groups | 0 | — |
| Duplicate `(source, external_id)` groups | 0 | — |
| Invalid coordinates (fail Section 2's UK/Ireland bound) among the 105 successes | 0 | — |
| Duplicate exact coordinate pairs among the 105 successes | 2 pairs | see DUPLICATES |

## COUNTRY / CODE COVERAGE

| Nation | Rows |
|---|---|
| England | 923 |
| Wales | 284 |
| Scotland | 177 |
| Northern Ireland | 12 |
| Republic of Ireland | **0** |

**Rugby League: entirely absent.** Every row is `rugby_code='union'`. RFL, and every league club anywhere in the UK, has zero representation. Given CLAUDE.md's own "Union and League are strictly isolated" doctrine, this means Clubhouse today can only ever be a union product on the map, honestly — there is no league data to isolate FROM yet, not a filtering gap.

## PROVENANCE

Re-confirmed from `source` (28 distinct values, live query): genuine governing-body and public provenance — `welsh_rugby_union` (284 rows, `wru_*_verified` statuses), `scottish_rugby` (177), `irish_rugby` (12, all classified Northern Ireland), numerous individually-named RFU regional-body sources, plus `wikipedia_candidate_population`/`wikipedia_current_league_*` (unverified, lower-trust), `companies_house` (4), and two local-council sources. `source_url` is populated for every row with a real governing-body page reference, giving a genuine, checkable provenance trail per row — this is not anonymous data.

`verification_status` (19 distinct values) ranges from `wru_professional_verified`/`source_verified_ground` (high trust — a named, checkable source and a stated verification method) down to `population_source_only`/`unverified` (4 rows) and `current_league_discovery`/`wikipedia_current_league_discovery` (613 rows combined — discovered via a league table or a Wikipedia page, not independently confirmed). **Nothing here is PROVENANCE UNKNOWN** — every row traces to a named `source` — but roughly 44% of rows (613 of 1,396) carry a verification status that is closer to "discovered" than "confirmed," and this should inform how confidently any future coordinate work treats a given row's own address/postcode fields, independent of geocoding.

## UK / IRELAND SCOPE

Confirmed, not assumed: England, Wales, Scotland, Northern Ireland are all represented (in that descending order of volume); Republic of Ireland is not, despite the schema explicitly anticipating it (`nation` check constraint). This is the clearest, most actionable coverage gap this audit found — not a geocoding problem, a **sourcing** problem, and squarely out of this section's scope to fix (the directive explicitly says not to bulk-import new governing-body datasets without established provenance/licensing, and IRFU/ROI data was not part of what this session verified as already-licensed).

## LOCATION MODEL

**No migration was needed.** The directive's own "two-tier" and "precision" asks (`EXACT_GROUND`/`VENUE`/`POSTCODE`/`TOWN`/`APPROXIMATE`/`UNKNOWN`) can be answered honestly from EXISTING schema, computed at read time, rather than stored as a new column:

- `"venue"` precision — the activated club's own `venues` row, `is_default_home = true`, `geocode_status = 'success'`, itself passing the same coordinate-plausibility check the directory is held to. This is the club's OWN entered address, with a direct incentive to be accurate.
- `"postcode"` precision — `club_directory.geocode_status = 'success'`, which today always means a `postcodes.io` postcode-centroid, never a ground survey.
- `"unknown"` — neither source is trustworthy. Never a town centroid presented as a ground, never a guess.

`resolveClubLocation(directory, venue)` in `packages/contracts/src/clubhouse/map-read-model.ts` is the one function implementing this precedence, pure and directly tested (5 new tests, including the real Preston Grasshoppers case as a literal fixture).

**Why this avoids the migration the directive warned might be needed**: a precision LABEL would only be genuinely useful once precision varies by more than "which table the value happens to live in" — e.g. once Ovalball has multiple geocoding methods, confidence scores, or manually-corrected coordinates worth distinguishing from an automated one. Today there is exactly one automated method (`postcodes.io`) and one manual source (a club's own venue entry), and the table a coordinate lives in already tells that story completely. If a future section adds a second geocoding method, manual admin correction, or confidence scoring, a stored `location_precision`/`location_method`/`location_confidence` column will become genuinely necessary — the migration below is designed and ready, but was not applied, because it is not needed yet.

## VENUE RELATIONSHIP

`venues.is_default_home` (a real, existing, per-club-unique constraint — `venues_one_default_per_club`) is exactly the "primary venue" concept the directive asked about; no new concept was needed. Of the 6 activated clubs, 2 have a successfully-geocoded default-home venue (Preston Grasshoppers, and the seeded UAT test persona). **`venues_select` RLS (`internal.can_view_venue`) restricts venue reads to the venue's own club's members** — a deliberate, pre-existing closure of a real prior leak (confirmed by reading `20270364000000_calendar_venue_training_authority_canonical.sql`'s own comment: "Closes the M-2 residue that let every signed-in person read every club's venues"). **This means venue-precedence only ever improves accuracy for a viewer looking at THEIR OWN club** — every other club on the map still shows its directory postcode-centroid, correct or not, regardless of whether that other club has a better venue coordinate on file. This is not a bug; it is RLS working as designed. Extending venue-precedence to every viewer, for every club, would require a new, deliberately public "primary venue coordinate" projection — a real, separate authority decision, not attempted here.

## COORDINATE QUALITY

- **Zero invalid coordinates** among the 105 successes, by Section 2's own UK/Ireland plausibility bound (49-61°N, -11.5-2°E) — re-verified live.
- **Two exact-coordinate collisions found**, neither a data-quality bug on inspection:
  - "Burnley RUFC" and "Ovalball UAT RUFC" share (53.819394, -2.234962) — "Ovalball UAT RUFC" is the seeded UAT review persona; its `venues` row shares this exact coordinate too, confirming it was deliberately seeded near a real club for realistic local testing, not a genuine directory error.
  - **"Cardiff Rugby" and "Cardiff Rugby Football Club"** share (51.479971, -3.183833), the same postcode (CF10 1JA), and the same `source` (`welsh_rugby_union`), but different `verification_status` (`wru_professional_verified` vs `wru_semi_pro_verified`) and different `source_url`s (a pro-clubs page vs. a fixtures-announcement page). This is a genuine duplicate CANDIDATE — see DUPLICATES.
- **A real dry-run finding on the "failed" row**: Rossendale RUFC's postcode (BB4 6RA) was queried live against `postcodes.io` as part of this audit (a single, read-only GET request). The result: `{"status":404,"error":"Postcode not found","terminated":{...,"year_terminated":2009}}` — the postcode was retired in 2009. `postcodes.io` still surfaces the terminated postcode's last-known centroid inside the `terminated` object, but the existing pipeline correctly does NOT treat that as a trustworthy current coordinate, and correctly recorded `geocode_status='failed'`. **This validates the existing pipeline's own caution as correct behaviour, not a bug to fix.**

## GEOCODING OPTIONS EVALUATED

| Option | Verdict |
|---|---|
| **postcodes.io** (already the established pipeline) | Genuinely the right tool for the 106 rows that HAVE a postcode — MIT-licensed, ONS/Ordnance-Survey-sourced, self-hostable if ever needed, explicitly supports bulk lookups. Already essentially exhausted: 105 of 106 postcode-bearing rows already succeeded; the one remaining ("failed") is correctly failed, not a retry candidate. |
| **Public Nominatim** | Explicitly discourages "bulk geocoding of larger amounts of data," caps at 1 req/sec even for a compliant one-off, forbids autocomplete-style client use. A ~1,300-record job is technically describable as a "smaller one-time task" under its own policy IF single-threaded, single-machine, capped and cached — but this only matters for rows that HAVE an address/postcode to feed it, and the real gap (1,290 rows with NO postcode) has no input to geocode in the first place. |
| **Photon / Pelias** | Both are Nominatim-adjacent open-source geocoders, typically self-hosted or run against a hosted instance with its own usage terms; not evaluated further because, like Nominatim, they solve "turn an address into a coordinate," and the real problem for 92% of the directory is "we do not have an address to turn," not "our geocoder is too weak." |
| **Self-hosting a UK/Ireland geocoder** | Feasible in principle (smaller, more tractable than the Section 2 map-tile self-hosting question), but solves the wrong problem for today's gap — see CHOSEN STRATEGY. |

## CHOSEN STRATEGY

**Complete the existing, already-approved `postcodes.io` pipeline for the tiny residual set, and explicitly do NOT attempt bulk third-party geocoding for the 1,290 rows without a postcode.**

The real bottleneck is not geocoding capability — it is that 92.4% of the directory has no postcode or address to geocode from at all. That is a **data-sourcing** problem (finding real postcodes/addresses for those clubs from their own governing bodies or websites), not a geocoding-technology problem, and pursuing it responsibly means either a deliberate future data-enrichment project against sources whose terms permit it, or accepting that those clubs remain map-absent-but-list-present, honestly, until better source data exists. Feeding a bare club name into Nominatim/Photon and trusting whatever comes back would produce exactly the "approximate location presented as if verified" risk this whole section exists to prevent — a club name is not an address, and a wrong or town-centroid result returned with unwarranted confidence is worse than no pin at all.

## DRY RUN

Performed against the entire non-`success` set (1,291 rows: 3 pending + 1 failed + 1,287 no_postcode), not simulated:

- **1,290 rows have no postcode** — zero eligible for `postcodes.io` (or any postcode-based) geocoding today. Not attempted.
- **3 "pending" rows are synthetic test fixtures** (`Auto Partner Test Home/Away/Deactivated RUFC`, UUID prefix `99900000-...`), not real clubs. No postcode, not real data, not eligible for or in need of geocoding.
- **1 "failed" row (Rossendale RUFC) was live-queried**: `postcodes.io` confirms its postcode is genuinely terminated (retired 2009) and the existing `'failed'` classification is correct. No safe re-geocode is possible without a corrected, current postcode — which this section does not have and did not fabricate.

**Result: zero rows are eligible for any legitimate geocoding action today.** This was the actual outcome of a genuine dry run, not a decision made in advance to avoid one.

## PRECISION MODEL

See LOCATION MODEL above — `"venue" | "postcode" | "unknown"`, computed at read time in `resolveClubLocation`, exported and pinned by 5 permanent tests.

## PROVENANCE MODEL

Existing `club_directory.source`/`source_url`/`source_updated_at`/`verification_status` already constitute a genuine provenance model at the ROW level (where did this club's facts come from). What does not exist, and is not needed today (see LOCATION MODEL), is a separate provenance model for the COORDINATE specifically — `geocode_source`/`geocoded_at` already cover that adequately for the one method (`postcodes.io`) currently in use.

## DUPLICATES

**Exact `normalized_key` and `(source, external_id)` matching found zero duplicate groups** — the directory is clean at that level. **One genuine candidate pair was found by cross-referencing coordinates, which exact-name matching missed**: "Cardiff Rugby" (`wru_professional_verified`) and "Cardiff Rugby Football Club" (`wru_semi_pro_verified`), same postcode, same source, different verification tier and source URL. **Not merged.** This is exactly the kind of case the directive asked to be produced as a candidate group with reasons, not auto-resolved — it plausibly represents a professional/community-tier distinction WRU's own data draws (in which case it is NOT a duplicate at all, but two real, related entities), or it could be the same entity captured twice from two different WRU pages during ingestion. Determining which requires a human decision this section does not make.

## MAP INTEGRATION

`packages/contracts/src/clubhouse/map-read-model.ts` — the one shared read model both clients already use — now returns `locationPrecision` on every marker, and prefers a viewer's own club's venue coordinate over its directory geocode when available and trustworthy. No second read model, no new table (`geo_clubhouse_clubs`/`mobile_map_clubs`/etc. were never created). The native sheet shows a plain, non-technical "Approximate location" pill when precision is `"postcode"` — never geocoder jargon.

## PERFORMANCE

Coverage did not numerically change (still 105/1,396 = 7.5% — venue precedence improves PRECISION for 2 rows, not the COUNT of geocoded rows), so Section 2's performance assumptions do not need re-evaluation this pass. The new venue query adds one additional request to `readClubhouseMarkers`, filtered to `is_default_home = true` — cheap at any realistic club count, since it is one row per activated club at most.

## SECURITY / PRIVACY

The venue query selects only `club_id, latitude, longitude, geocode_status` — no venue name, no address text, no access notes, no private operational detail — and is already governed by existing `venues_select` RLS, unchanged. Nothing new is exposed that RLS did not already permit that exact viewer to read.

## TESTS

18 new assertions in `clubhouse.test.mts` this section (28 total in the file): `resolveClubLocation`'s full precedence logic (5 tests, including the literal Preston Grasshoppers coordinates as a fixture), plus the tests already added in this same pass structure — coordinate validation, verified-vs-approximate precedence, venue-vs-directory precedence, unclaimed-club-can-never-reach-venue-precision. All pure, DB-free, run in milliseconds.

## MIGRATION DECISION

**No migration created. No migration applied.** The schema was judged sufficient for today's precision model (computed at read time — see LOCATION MODEL's own reasoning for why a stored column is not yet warranted). If a future section introduces a second geocoding method, manual correction, or confidence scoring, a `location_precision`/`location_method`/`location_confidence` column on `club_directory` (and/or `venues`) will become genuinely necessary at that point — not before.

## DATA-MUTATION DECISION

**No directory data mutated.** The Existing Data Mutation Rule's five conditions were walked through honestly: (1) source audit — done; (2) dry run — done, found zero eligible rows; (3) validation — `isValidClubCoordinate` exists and was applied; (4) rollback/export strategy — not needed, because nothing was written; (5) explicit confidence rules — not yet fully satisfiable without the (deliberately not-yet-applied) precision schema, for anything beyond what already exists. Since the dry run itself found zero legitimate candidates, the question of whether to proceed with a mutation never actually arose — there was nothing eligible to mutate.

## AFTER COVERAGE

Unchanged in raw count: 105/1,396 (7.5%) geocoded. **Precision improved for the viewer's own club specifically, in 2 of those 105 cases** (Preston Grasshoppers now resolves to its real venue for its own staff; the UAT test persona likewise) — a quality change, not a coverage-count change.

## DEFERRED

- Republic of Ireland club data (a sourcing project, not a geocoding one).
- Rugby League club data (same).
- Bulk postcode/address enrichment for the 1,290 rows lacking one (a real, separate, deliberate future project — not attempted here, and not something to bulk-automate against a generic geocoder without real address input).
- A public, cross-club venue-coordinate projection (would let venue-precedence help every viewer, not just a club's own staff — a real authority decision, not made here).
- Crest population (0 of 1,396 directory rows have one — infrastructure exists, unused).
- Formal merge tooling for the Cardiff Rugby / Cardiff Rugby Football Club candidate (and any future candidates the coordinate-collision check surfaces) — a human decision, not this section's to make.
- Viewport/bounding-box server-side marker queries — still not needed; coverage did not grow this section.
- A reusable, scriptable "map coverage report" utility beyond the raw SQL used to produce this document's own numbers — the queries used are recorded in this document and are trivially rerunnable, but were not wrapped into a standing tool this pass.

## SECTION 4 HANDOFF

Section 4 (Club Profile / Club Card) inherits: `locationPrecision` on every marker, ready to inform a fuller club-profile location display; the Cardiff Rugby duplicate candidate, unresolved; the crest-population gap (0 of 1,396); and the honest fact that "distance" and "location" displays anywhere in a deepened club profile should keep using the SAME `resolveClubLocation`/`hasLocation` read model this section established, never a second one.
