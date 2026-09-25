# Section 2 — Map & Club Discovery

## PURPOSE

Make the Clubhouse map feel like a flagship Ovalball surface, not an admin tool with pins on it — while never inventing data the canonical domain does not actually have, and closing the one real correctness gap Section 1 found: partnership state silently shown as "not partnered" for a viewer RLS has actually refused an answer to.

## BEFORE STATE (audited from source at checkpoint `735aa12`, before this section's changes)

- **Native route**: `apps/mobile/app/(tabs)/clubhouse/index.tsx` — a single screen: `Map`+`Camera`+clustered `GeoJSONSource`+`Layer`s (MapLibre native, `@maplibre/maplibre-react-native@11.4.0`), a `Map`/`List` toggle, three filter chips (All/On Ovalball/Partners), a text search, a native `BottomSheet` club detail.
- **Web**: `app/(app)/clubhouse/` — the renamed former `/partner-clubs`, still rendering with **Leaflet** (`club-map.tsx`), not MapLibre GL JS.
- **Map style source**: `https://demotiles.maplibre.org/style.json` (MapLibre's own keyless development demo tiles) — correctly documented as development-only, with production explicitly deferred as an owner decision (no free commercial tier exists at any researched provider).
- **Marker system**: native map rendered clubs as plain coloured circles (`CircleLayer`), never crest images on the map itself — crests rendered only in the List and the bottom sheet. This was a deliberate, documented V1 scope cut, not an oversight.
- **Layout**: a fixed chalk header block ("Clubhouse" title + search + filters) sat ABOVE the map, not floating over it — directly against this section's own "avoid a giant page title, the map should feel immersive" instruction.
- **Coordinate trust**: `hasLocation`/lat/lng were driven entirely by `club_directory.geocode_status = 'success'`, with no independent sanity check on the number itself.
- **Partnership state**: `readClubhouseMarkers` queried `club_partnerships` for every viewer with a club id, with no check on whether the viewer actually held the authority `club_partnerships_select_scoped` RLS requires — an empty (RLS-filtered) result silently became `"none"`. This is the bug Section 1 found and referred to this section to fix.
- **Distance**: not implemented at all — no filter, no origin, no calculation.
- **Team-context web entry**: not implemented — `/clubhouse` was Club Admin-only on web (Section 1's own deliberate, recorded scope boundary).
- **Tests**: 10 pure-function tests (`clubhouse.test.mts`) covering search/filter/authority-derivation, none touching partnership-unknown, coordinates, distance, or the marker/cluster payload shape specifically.

## SOURCE AUDIT

Re-confirmed directly, not assumed: `club_directory` still holds 1,396 rows with 105 (7.5%) geocoded (unchanged since the architecture audit); `club_partnerships_select_scoped` RLS requires `club.partners.manage` at club scope (`internal.club_ids_with(...)`), confirmed by reading the live migration; the architecture audit's own venue-pin incident (`20270202000000_a_venue_pin_agrees_with_its_address.sql`) was re-read as direct evidence that `geocode_status='success'` alone has, at least once, not been sufficient proof of a correct coordinate.

## DOMAIN REUSE

No new table, RLS policy, or RPC. Every fix in this section is either (a) a correctness fix to how `packages/contracts/src/clubhouse/map-read-model.ts` reads and represents EXISTING data, or (b) a client-side query composed from data the shared read model already returns (distance is haversine arithmetic over two already-fetched coordinates, never a new fetch).

## THE FIX: UNKNOWN PARTNERSHIP STATE

`ClubPartnershipStatus` gained a fifth value, `"unknown"`, and `readClubhouseMarkers` now asks `my_capabilities` for `club.partners.manage` at the viewer's own club **before** it even runs the `club_partnerships` query. Without that capability, the query is not run at all, and every marker's `partnershipStatus` is `"unknown"` — never `"none"`. `"none"` is now, structurally, only ever a *trusted* absence.

Two pure functions were extracted specifically so this could be pinned without a database: `resolvePartnershipStatus(knownStatus, viewerClubId, holdsPartnerAuthority)` and `buildPartnershipIndex(rows, viewerClubId, holdsPartnerAuthority)`. `deriveClubNetworkActions` (from Clubhouse V1) needed **zero changes** — every partner-specific action already checked for an exact `"active"`/`"pending_outgoing"`/`"pending_incoming"`/`"none"` match, and `"unknown"` matches none of them by construction, so "Partner with Club" (and every other partner action) is structurally unreachable from an unknown state. This was verified, not assumed: a permanent test calls it by the directive's own name.

The web card (`club-map-card.tsx`) and status pill (`club-status-pill.tsx`), and the native sheet/pill, all use the same `===` pattern — none needed changes either. They already degrade to their safe default ("On Ovalball", no partner button) for any status they don't explicitly recognise.

## DOMAIN REUSE, CONTINUED: TEAM-CONTEXT WEB ENTRY

`buildNavItems` gained a `teamClubhouseAccess` parameter, resolved by `app/(app)/layout.tsx` at **team** scope (`fixture.request.create` OR `fixture.request.respond` — never `hasClubFixtureAuthority`, which only ever looks at club-wide CLUB_ADMIN/FIXTURE_SECRETARY memberships and would wrongly exclude the exact Coach/Team Manager this was meant to include). When true, `/clubhouse` is pushed into the team-context item list and automatically receives the same first-class, ungrouped top-tier placement a club context gets — the promotion logic in `groupNavItems` was already generic, so no second mechanism was built.

## NATIVE UX

- **Layout**: the fixed chalk header block is gone. Search, filter chips, and (when available) distance chips now float as one card over the map/list, positioned below the app header, matching "the map should feel immersive... avoid wasting vertical space on a giant page title."
- **Distance**: a collapsible "Add distance filter" toggle appears only when the viewer's own club has a real, valid, geocoded location (`findDistanceOrigin`) — never offered as a dead control when there is nothing factual to measure from. 10/25/50/100 mile chips plus "Any."
- **List**: gained a `topInset` so rows are never hidden under the now-floating search card.
- **Sheet**: gained a factual distance line (`"· 23 mi"`) next to town/county, shown only when both the origin and the target club have real coordinates — never fabricated, never shown for the viewer's own club.

## WEB UX

Not changed in this pass beyond the team-context nav decision above and the shared partnership-unknown fix (which both clients inherit automatically through the shared read model). The Leaflet renderer, its layout, and its existing map-card/status-pill components were deliberately left alone — see MAP INFRASTRUCTURE below for why a web MapLibre migration was not attempted here.

## MAP INFRASTRUCTURE

**Renderer**: MapLibre remains the foundation on native (`@maplibre/maplibre-react-native`). Web still renders with Leaflet — **not yet migrated to MapLibre GL JS**. This is a deliberate, recorded scope decision: the directive itself permits not destabilising a working surface merely to unify renderers, and the shared BUSINESS layer (`packages/contracts/src/clubhouse/*` — the marker read model, the partnership/distance/coordinate logic, all of it) is already fully unified between clients. Only the rendering technology differs, and that boundary is exactly where the directive said it should sit ("Do not require identical rendering code... do not create a permanent Leaflet-vs-MapLibre BUSINESS divergence" — the business logic is not divergent; the paint is).

**Style/tile source (development)**: `https://demotiles.maplibre.org/style.json`, one named constant (`DEVELOPMENT_MAP_STYLE`), explicitly provided by the MapLibre project for exactly this use — keyless, serverless, terms-compliant for development.

**Production decision: still required, not made here.** No commercial provider researched (Stadia Maps, MapTiler) offers a free tier permitting commercial use; both require a paid plan (~$20–30/month minimum) and a real vendor account with a payment method. This session will not create that account or enter billing credentials on the owner's behalf.

**Attribution**: MapLibre demo tiles require no attribution beyond what their own style already embeds; a commercial or self-hosted OpenStreetMap-derived source would require the standard "© OpenStreetMap contributors" (and, for OpenMapTiles-derived styles, an OpenMapTiles.org credit too) — this has not yet been added to the UI anywhere, and must be before any production tile source ships.

## SELF-HOSTING FORECAST (planning only — nothing built)

| | A. Commercial (Stadia Maps / MapTiler) | B. Self-hosted UK/Ireland OSM-derived vector tiles |
|---|---|---|
| Setup complexity | Low — sign up, get a style URL, done | Moderate-high — an OSM import pipeline (e.g. OpenMapTiles: `imposm` + PostGIS + a tile-generation step), a UK/Ireland regional extract (Geofabrik), a tile server (TileServer GL or similar) or static MBTiles behind a CDN |
| Ongoing cost | ~$20–30/month minimum, scales with usage | Server/storage/CDN hosting cost (variable, but typically lower per-request at scale), **plus engineering time** |
| Storage | None (vendor-hosted) | A UK/Ireland-only vector tile set is materially smaller than a planet build — realistically low-to-mid single-digit GB, not the ~70GB+ a full-planet OpenMapTiles build needs |
| Update pipeline | Vendor's problem | Ours: periodic re-import of a fresh OSM extract, re-running the tile-generation pipeline, redeploying — needs a real, owned maintenance cadence, not a one-off build |
| UK-only feasibility | N/A — global by default, works immediately for UK/Ireland | Genuinely more feasible than a global self-host, since the region is small — this is real self-hosting's best case, not its hardest one |
| Portability | Locked to whichever vendor's style/tile format until migrated | Fully portable — the tiles are ours; the only lock-in is the generation tooling choice |
| Licensing | Vendor's commercial terms | CC-BY-SA (OpenStreetMap data) / CC-BY (OpenMapTiles schema) — both require visible attribution, not licensing cost |

**Conclusion, honestly stated**: self-hosting is not "mandatory" merely because two vendors charge — a UK/Ireland-only extract genuinely is a smaller, more tractable self-hosting target than the directive's own caution about "assuming paid SaaS is mandatory" implies. But it trades a monthly bill for real, ongoing engineering ownership (the import/update pipeline is not a one-time cost). Neither option was built in this section; this table exists so the owner's eventual decision is informed by a real comparison, not a guess.

## MARKERS

No change to the underlying marker SHAPE decision from V1: crests render in the List and the Sheet (trivial `<Image>` usage), never as a per-point raster on the map layer itself. The map layer's `CircleLayer` paint expression already correctly distinguishes own-club (pitch green), active-partner (pitch-600), on-Ovalball (forest), and directory-only (neutral grey) — verified this still degrades safely for `"unknown"` partnership status (falls through to the plain on-Ovalball colour, never a false "not partnered" grey).

## CLUSTERING

Unchanged from V1 — native `GeoJSONSource` clustering (`clusterRadius=45`, `clusterMaxZoom=11`), a `CircleLayer` for cluster circles sized by `point_count`, a `SymbolLayer` for the count label. Extracted into a shared, pure, directly-tested function this section (`buildClubMarkerFeatureCollection`) so the cluster source's payload shape is pinned, not just visually inspected.

## SEARCH

Unchanged logic (`matchesClubhouseQuery`), now visually floating rather than fixed. Confirmed by test that a non-geocoded club is still found by search.

## FILTERS

All/On Ovalball/Partners unchanged. Distance is new (see above) and is its own control, not a fourth chip in the same row, because it needs a factual origin the other three never did. "Partners" was re-verified to never include an `"unknown"` status (a permanent test).

## MAP/LIST

Unchanged shared-population design from V1, now with an explicit permanent test (`"Map and List share exactly one discovery population"`) proving the map's population is always a subset of the list's, filtered only by `hasLocation`, never independently fetched or independently filtered.

## SELECTED CLUB (sheet)

Gained: factual distance. Everything else (crest, name, town, rugby code, Ovalball status, partner state, actions) was already correct from V1 and is now additionally protected by the unknown-state tests.

## ACCESSIBILITY

Not materially changed this section beyond what floating the search card required (it remains a normal View/Pressable tree, no new custom gesture surface). The List remains the full accessible alternative to the map, unchanged. A deeper accessibility pass (VoiceOver wording review, Dynamic Type stress-testing, cluster accessibility labels) was not performed — see DEFERRED.

## PERFORMANCE

The coordinate-validation addition (`isValidClubCoordinate`) adds a constant-time check per row, negligible at current scale. No new query was added to the hot path (distance is computed client-side over already-fetched markers). Viewport/bounding-box querying remains explicitly deferred, matching V1's own documented threshold decision — 1,396 rows still does not need it.

## AUTHORITY

The one real authority-adjacent change this section makes is a client-side one: `readClubhouseMarkers` now asks `my_capabilities` before trusting `club_partnerships` silence. This is not a new grant or a new check on the server — `club_partnerships_select_scoped` RLS is completely unchanged — it is the client finally asking the SAME question the RLS already answers, instead of guessing from an empty result.

## PRIVACY

The marker/cluster payload was confirmed, by test, to carry exactly four fields (`directoryId`, `networkState`, `partnershipStatus`, `isOwnClub`) — no name, no crest URL, no location text. Distance is computed from two already-authorised coordinates, never a new location fetch, and never from a device-location permission (none was added or requested).

## TESTS

23 assertions total in `clubhouse.test.mts` (13 new this section): `resolvePartnershipStatus`/`buildPartnershipIndex` unknown-state behaviour, `deriveClubNetworkActions` with an explicit `"unknown"` marker, `applyClubhouseFilter`'s "partners" excluding unknown, `isValidClubCoordinate` (real UK/Ireland points accepted, Null Island/the North Pole/New York/NaN/Infinity rejected), non-geocoded search/list inclusion, Map/List population equality, the marker-payload sensitive-field check, a team-context safe-projection case, and the three distance functions (`distanceMiles`, `findDistanceOrigin`, `applyClubhouseDistanceFilter`). Plus 2 new navigation tests (`navigation_architecture.test.mts`): Clubhouse's team-context top-tier placement, and the `buildNavItems` call-signature regex updated for the new parameter. One genuine regression was found and fixed during this section's own proof pass: a doc comment accidentally introduced a second `CLUB_ADMIN` string literal, tripping `no_role_literals`'s shrink-list guard — fixed by rewording, not by widening the guard.

## PROOF

Both clients typecheck clean (`npx tsc --noEmit`). `next build` succeeds. The full canonical gate (215 SQL + 121 TS suites) was run twice this section — once surfacing the `no_role_literals` regression, once confirming the fix — and returned to exactly the pre-existing 14-failure baseline with zero new failures on the second run.

**No native device/simulator proof was performed** — this environment has no Xcode/Android Studio/EAS access. Every native claim in this document is backed by a clean TypeScript compile against MapLibre's real shipped type definitions and passing unit tests over the pure logic, never a screenshot or a run that did not happen. **No screenshots were captured**, for the same reason, on either client.

## DEFERRED

- Web MapLibre GL JS migration (deliberately, see MAP INFRASTRUCTURE).
- Production tile/style provider selection and provisioning (owner decision, real recurring cost).
- Distance shown on List rows (only added to the Sheet this pass — a real, named scope trim, not an oversight).
- Camera "fit to results"/"search-result focus" behaviour — the directive asked for deliberate camera motion on search/filter changes; this pass left camera control exactly as V1 built it (cluster-tap zoom only) rather than adding new, visually-unverifiable camera logic in an environment with no way to see it move.
- Cluster accessibility labels and a full VoiceOver/Dynamic Type pass.
- "Near me" (device-location) discovery — explicitly optional per the directive, not built.
- Self-hosted tile infrastructure (planning only, per this document's own forecast table).
- Bounding-box/viewport server-side marker queries (documented threshold not yet reached).

## SECTION 3 HANDOFF

Section 3 (Directory & Geo Coverage) inherits: the real, live figure that only 7.5% of the directory is geocoded; the now-defensive `isValidClubCoordinate` bound (49-61°N, -11.5-2°E) as the map's own last line of defence, which Section 3's own geocoding-quality work should be aware of rather than duplicate; and the open question of whether `clubs.latitude/longitude` (confirmed dead/unfed by any active pipeline in the original architecture audit) should be removed, migrated, or left alone.
