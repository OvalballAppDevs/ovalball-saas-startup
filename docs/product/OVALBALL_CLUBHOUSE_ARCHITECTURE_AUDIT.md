# Ovalball Clubhouse — Architecture & Product Discovery Audit

**Status: READ-ONLY AUDIT. Nothing described as "Clubhouse" has been built. No migration, application code, or database data was changed to produce this document. See §0 for the exact working-tree state this audit was run against.**

Prepared against `main`, evaluating whether the existing Ovalball architecture (Next.js web at the repo root, Expo/React Native mobile at `apps/mobile/`, Supabase/Postgres at `supabase/migrations/`) could support a future first-class "Clubhouse" product — a club-to-club rugby network: a map of clubs, partner clubs, fixture requests/opportunities, compatible-opposition discovery.

---

## 0. Current working tree

```
branch: main
HEAD:   bf6d87c feat(fixture-requests): canonical counter-proposal negotiation state (CA-M11.5)
```

`git status --short`:
```
?? "public/icons/Ovalball Square Logo.png"        (protected untracked asset — never touched)
?? "public/icons/Overball Logo Low Res.png"        (protected untracked asset — never touched)
?? supabase/migrations/20270554000000_looking_for_opposition.sql
```

The one untracked file needs an honest note. Immediately before this audit request arrived, this session was mid-way through implementing CA-M11.5's second half ("Looking for Opposition" open fixture opportunities) under an earlier, separate, explicit authorization. It had just finished **drafting** `20270554000000_looking_for_opposition.sql` — a `fixture_opportunities`/`fixture_opportunity_responses` schema, RLS policies, and six RPCs — when this audit's read-only instruction arrived and explicitly superseded that authorization.

That file:
- **has never been applied** to the local database (confirmed directly: `select to_regclass('public.fixture_opportunities')` returns null — the table does not exist in the running Postgres instance),
- **has never been committed**,
- **has not been touched since** this audit began, and won't be.

It is preserved exactly where it sits so nothing is lost, and referenced in §23–26 below as a concrete worked design (not as evidence the feature exists — it doesn't). Recent checkpoint history leading up to HEAD:

```
bf6d87c feat(fixture-requests): canonical counter-proposal negotiation state (CA-M11.5)
f3a904c feat(fixture-requests): web parity for the shared scheduling calendar (CA-M11.4)
eaa1bb8 feat(fixture-requests): shared scheduling calendar for the request flow (CA-M11.4)
ac40867 feat(pitch-allocation): Grounds & Pitches capacity configuration (CA-M11.2)
6f0b7de fix(pitch-allocation): size-aware pitch capacity, not raw headcount (CA-M11.2)
153d942 fix(mobile): pitch allocation header seam + compact concurrent-booking lanes (CA-M11.2)
```

Pitch Allocation, Pitches & Venues, CA-M11.4's shared calendar, social auth, and everything else already banked are untouched by this audit.

---

## 1. Executive summary — the single most important finding

**Ovalball is not starting Clubhouse from zero. A working, database-backed prototype of most of the concept already exists, live, on the web app, at `app/(app)/partner-clubs/`.** It renders every recognised UK rugby club (claimed or not) on a Leaflet map with marker clustering, distinguishes "On Ovalball" from "Not on Ovalball" from "Partner," supports search and status/rugby-code filtering, and lets a user request a partnership or invite an unclaimed club to Ovalball — all today, all committed, all reachable in the product.

What does **not** exist: any of this on mobile (it is 100% web-only), an "opportunities" domain (Looking for Opposition), and a unifying "Clubhouse" identity that ties club discovery, partners, fixture requests, and calendar comparison into one destination. The gap is real, but it is a **mobile-native + product-convergence** gap layered on solid, already-correct data architecture — not a from-scratch data-modelling problem. This reframes several of the audit's own questions: the "smallest first shippable version" is closer to "bring the existing Partner Clubs feature to mobile, natively" than to "invent a map feature."

---

## 2. Mobile navigation architecture (§2, §4)

**File:** `apps/mobile/app/(tabs)/_layout.tsx`, driven by `apps/mobile/src/context/tab-projection.ts`.

**Actual current bottom tabs, verified from source, in order:**

| # | Tab | Route group |
|---|-----|-------------|
| 1 | Home | `index` |
| 2 | Fixtures | `fixtures` |
| 3 | Calendar | `calendar` |
| 4 | Rugby Hub | `hub` |
| 5 | More | `more` |

This confirms the brief's expectation with one correction: **Messages is not a tab.** It used to be (an earlier, superseded decision the code comments call "M3"), but was moved into the persistent global header alongside Notifications and Support, freeing the fourth cell for Rugby Hub.

**Implementation.** File-based via Expo Router `Tabs`. Every route-group folder under `(tabs)/` must be declared in an `ALL` array or it silently gets Expo Router's default "missing icon" glyph — a real bug the codebase hit once (CA-M11.1) and now guards against with a comment. Icons are Lucide (`House`, `CalendarDays`, `BookOpen`, `Ellipsis`), except Fixtures, which uses a custom `OvalIcon` brand glyph (Lucide has no rugby ball). **Tab-bar badges are explicitly disabled** (`badge={0}` hardcoded on every cell, with a comment "NO UNREAD IN THE BAR ANY MORE") — unread counts live only in the global header, sourced from one canonical RPC `my_unread_counts()`.

**Context-dependent behaviour.** `projectTabs()` in `tab-projection.ts` currently returns **the same five tabs for every context** — team, club, family/player, Site Admin — by deliberate, documented design: *"ONE ARRANGEMENT FOR EVERY CONTEXT... a bar whose shape changes when you switch context costs more in confusion than a tailored cell saves."* The function signature still accepts `{ kind, canSeeTeamSubscriptions }` "so the projection stays the place this decision is made" if that policy ever changes, but as written it is inert. What *does* vary per context is the content inside each tab and inside "More" (`apps/mobile/app/(tabs)/more.tsx`), gated by `active?.kind` plus server-answered capability probes — with an explicit code comment that this in-tab conditional rendering "is a projection, not an authority": every route still re-checks the server.

**Hidden routes** (reachable only via header/More/deep link, never the bar): `messages`, `notifications`, `support` (header only); `subscriptions` (declared as a route group but never included by `projectTabs`, appearing vestigial relative to an earlier "capability-aware fifth cell" ambition mentioned only in comments); `admin`, `team`, `family`, `profile`, `club`, `security`, `news`, `announcements`.

**Could a new destination safely become a bottom tab?** Structurally, yes, and cheaply — the bar is entirely data-driven from one array (`EVERYDAY`) plus one icon switch and one `ALL` declaration list; the architecture explicitly anticipated exactly this kind of change. **But replacing Rugby Hub outright would cut directly against a stated design principle in the code** — the comment that muscle-memory position stability for Home/Fixtures/Calendar/Rugby Hub is "worth more than a perfectly tailored bar." A sixth cell is mechanically trivial; removing/replacing one of the existing four is a deliberate reversal of a documented decision, not a mechanical one. See §4 below for Option A vs B.

---

## 3. Rugby Hub audit (§3)

**Location:** `apps/mobile/app/(tabs)/hub/` and a full web equivalent at `app/(app)/rugby-hub/`, driven by a shared canonical IA in `packages/contracts/src/rugby-hub/ia.ts` (`HUB_GROUPS`) — the mobile app's own comments state it deliberately mirrors the web IA rather than inventing its own ("the mobile app does not have its own idea of where Glossary lives... imported, not copied").

**Five canonical groups, confirmed from source:**

1. **Learn the Game** — Game Knowledge, Rules, Officiating, Positions, Glossary
2. **Play & Develop** — Skills, Player Development
3. **Coach Rugby** — Coaching Knowledge
4. **Explore Rugby** — The Story of Rugby, Teams & Competitions, International Rugby, **Famous Clubs**, People & Rugby Legends
5. **Welfare & Support** — Parents & Guardians, Player Welfare, Safeguarding

**Verdict: genuinely educational/reference content, not club discovery.** Confirmed by reading source directly — `hub/clubs/index.tsx` is titled "Famous Clubs," described in its own comment as "the clubs that shaped rugby history... a small, deliberately curated first set" — editorial/historical content, not a directory or a way to find/contact a real club to play against. `hub/safeguarding/contact.tsx` hands off to a *specific club's own* registered Safeguarding Officer, an internal welfare contact, not inter-club coordination. Nothing under Rugby Hub touches fixture requests, opponent search, partner clubs, or a map — that functionality lives entirely in Partner Clubs / Fixture Requests (§8, §15), architecturally and conceptually separate today.

**Web equivalent:** full parity. `packages/contracts/src/rugby-hub/destinations.ts` treats the web `href` as canonical ("the website was built first and its links are its addresses") and provides `parseHubHref`/`hubHrefFor` so mobile parses/builds the same URLs.

**Moving-pieces implications:** `HUB_ROOT = "/rugby-hub"` is a hard-coded constant; every hub URL is prefixed with it. Relocating a section (e.g. "Famous Clubs") into a future Clubhouse would require updating the shared `HUB_GROUPS`/`HUB_SECTION_SLUGS`/`parseHubHref`/`hubHrefFor` contracts, physically moving the route folder on both clients, and handling stale inbound links (`parseHubHref` already falls back to `{kind:"web", href}` for anything unrecognised rather than guessing — a stale link degrades gracefully rather than crashing, but doesn't redirect either). On web, `Rugby Hub` is injected as a persistent top-level nav item across nearly every context (`lib/app-context/build-nav-items.ts`) — it is treated as a universal utility link, not role-scoped. Hub content is also per-team-identity-aware (rugby code, age grade drive which Rules/Safeguarding/Positions content renders) via `HubIdentityProvider` — that personalization would need to be preserved wherever content ends up.

**Answer to §3's core question:** Rugby Hub is (B) — a coherent collection of rugby discovery/reference content, cleanly separable from club-to-club coordination because nothing in it currently does club-to-club coordination. "Famous Clubs" is the only section with any conceptual adjacency to Clubhouse, and it is editorial content about historic clubs, not a live directory.

---

## 4. Sixth tab vs. replacement — options, not a decision

| | Option A: add a 6th tab | Option B: fold Hub into Clubhouse | Option C (source-informed) |
|---|---|---|---|
| Shape | Home / Fixtures / Calendar / Rugby Hub / **Clubhouse** / More | Home / Fixtures / Calendar / **Clubhouse** / More (Hub content absorbed) | Home / Fixtures / Calendar / Rugby Hub / More, **Clubhouse reached from within Fixtures/Calendar/Club context** (no new tab) |
| Mobile space | 6 tabs is above the code's own stated "bottom-nav ≤5" convention (also a UI/UX guideline) and would need a redesign of tab-cell width/typography | Stays at 5 | Stays at 5 |
| Discoverability | High (permanent, always visible) | High, but conflates "look up rugby knowledge" with "coordinate with clubs" under one label | Lower at first touch, but matches the pinned "Ovalball mobile Club Admin parity is default" and "Bottom navigation is exactly Home / Fixtures / Calendar / Rugby Hub / More" standing instruction — **this instruction explicitly forbids adding tabs**: *"Two arrow controls that appeared in the bar were to be removed and not replaced."* |
| Existing route contracts | Additive, low structural risk | Breaking — every `hubHrefFor()` caller and every persistent web nav injection of `/rugby-hub` would need rework | None broken |
| Mental model | "Clubhouse" and "Rugby Hub" are different jobs (network vs. knowledge) and arguably deserve separate top-level status | Risks users not finding rugby rules content because it's now nested under a club-network-sounding label | Matches how Partner Clubs is reached TODAY (nested under a club-context nav section, not top-level) |

**This audit does not choose.** But it flags a real tension the brief should resolve explicitly: the **pinned standing instruction in this session's memory says the mobile bottom navigation is fixed at exactly five named cells and that a sixth was previously proposed and explicitly rejected** ("Two arrow controls that appeared in the bar were to be removed and not replaced" — a different case, but the same standing constraint: the bar's shape is locked and any change to it needs the owner's explicit sign-off, not an agent's judgement call). Given that, **Option C is the only one consistent with existing standing product policy without a fresh, explicit owner decision to change it.**

---

## 5. Club Directory / identity model (§5–8, §55, §59–60, §81)

Two tables carry club identity, and the split is explicit, deliberate, and repeatedly documented — this is close to exactly what §6 is asking whether Ovalball has.

**`public.club_directory`** (`20260830143455_club_directory.sql`) — *"Master lookup of all recognised rugby clubs from governing-body sources. Not all rows are activated in Ovalball."* Columns: `name, rugby_code, country, nation, region, county, town, home_ground, address, postcode, website, official_email, source, external_id, source_url, source_updated_at, active, verification_status, notes, constituent_body, normalized_key`, plus later additions `logo_storage_path`, `bio`, `facebook_url`, and a full geocoding block (`latitude`, `longitude`, `geocoded_at`, `geocode_status`, `geocode_source`).

**`public.clubs`** (`20260830143457_clubs.sql`) — *"Activated Ovalball club profile. One row per claimed club_directory entry."* `directory_id uuid not null unique references club_directory(id)` is the load-bearing link. Every activated-club field (bio, facebook_url, logo, address, lat/long) has a directory-level seed/fallback and a clubs-level override, resolved at read time, never copied (`lib/app-context/club-logo.ts`, `club-public-profile.ts`): *"the club's own value wins, directory value is the seed/fallback... no sync step."*

**Real current numbers (queried directly against the live local database, not a code comment):**

```
club_directory total rows:        1,396
  with successful geocode:          105  (7.5%)
clubs (activated Ovalball tenants):   6
club_partnerships:  2 pending, 1 revoked, 0 active
```

Note: one research pass found a migration comment claiming "43" activated clubs — that is a snapshot from whenever that migration was written, not the current review database's live state. Always trust the live query over a historical comment; the two will legitimately diverge as review data accumulates and resets.

**Source diversity in `club_directory.source`** (28 distinct values, live query): genuine governing-body and public provenance — `welsh_rugby_union` (284 rows), `scottish_rugby` (177), `irish_rugby` (12), several **RFU regional bodies individually** (`rfu_london_se_current_league`, `south_west_rfu_current_league`, `yorkshire_rfu_current_league`, `lancashire_rfu`, `gloucestershire_rfu`, `devon_rfu`, `northumberland_rugby_union`, `nld_rfu_current_league`, `dorset_wilts_rfu_current_league`, `rfu_midlands_current_league`, `rfu_south_west_competition_lineup`, `rfu_club_page`, `rfu_london_current_league`), plus `wikipedia_candidate_population`/`wikipedia_current_league_page` (381 combined), `companies_house` (4), and two local council sources. This is genuinely-sourced UK club data, **not fabricated** — but coverage is uneven: Wales (WRU) and Scotland are comparatively strong; England (RFU) is fragmented across many small regional-body sources; **only ~7% of all 1,396 rows have a resolved postcode/geocode at all**, so the overwhelming majority could not get a map pin under the current pipeline without further data work.

**External/opposition club model (§7).** Fixtures and fixture requests both use the same raw-text + progressively-resolved-reference shape (`raw_opposition_text` always preserved; `opponent_directory_id`/`opponent_team_id`/`opponent_club_id` populated only as far as confidently resolved). There is **no per-club-owned "opposition club" record** — every opponent identity resolves against the single, global `club_directory`. New directory rows are not created ad hoc from a fixture screen; they go through `public.directory_requests`, Site-Admin-reviewed via `approve_directory_request()`. **Duplicates can and do occur by design**: `club_directory.name` is explicitly not unique (only `(source, external_id)` is), and the migration comment states plainly: *"a normalized-name collision is a candidate for manual review, not an automatic block."* An admin view (`admin_club_overview`) already computes `flag_duplicate_normalized_key`/`flag_duplicate_external_id`, but **there is no automated merge tool** — de-duplication today is manual, flag-only.

**§81's explicit product questions, answered directly from evidence:**

- **Can current Ovalball represent a club that does not use Ovalball? YES.** — every unclaimed `club_directory` row.
- **Can it distinguish that from an Ovalball tenant? YES.** — `clubs.directory_id` (unique FK) is exactly that distinction, used consistently throughout the codebase (the Partner Clubs map already renders this distinction today).
- **Do clubs have map coordinates? PARTIAL.** `club_directory` and `venues` both have a live, actively-maintained postcode→coordinate pipeline (postcodes.io-backed, `pg_cron`-driven, see §6). **`clubs.latitude/longitude` exist as columns but appear to be dead/legacy** — inherited from an old CSV import, "nullable since they were null in the source data," and not fed by any active geocoding code path found. Anything reading a club's location for a map should read the `club_directory` row's coordinates (via `clubs.directory_id`), not `clubs.latitude/longitude` directly.

---

## 6. Geographic data & map architecture (§9–13, §34–37, §61–67)

**Coordinates exist and are live-maintained**, but only via UK postcode geocoding — **no PostGIS, no geography/geometry column, no spatial index anywhere** (the only extension in the whole schema is `pgcrypto`). Plain `numeric` lat/lng pairs.

**The pipeline** (`lib/geocoding/postcodes-io.ts`, `lib/geocoding/backfill.ts`, and for venues specifically a full async queue: `internal.venue_geocode_requests`, `pg_net` HTTP calls to postcodes.io, a `pg_cron` job `process-venue-geocoding` running every minute, `internal.record_venue_geocode()` as the sole writer). `geocode_status` is `pending | success | no_postcode | failed`; **map/UI code only ever trusts `success`** — a deliberate, documented decision (`20260901100000_club_directory_geocoding.sql`): *"The map renders a pin only for success — every other status stays search/list-only, never an invented location."*

**Coverage today is genuinely low** — confirmed by direct query: 105 of 1,396 club_directory rows (7.5%) have `geocode_status='success'`; 1,287 are `no_postcode` (i.e. the source data itself never carried a postcode to geocode from). This is the single biggest concrete gap between "the architecture supports a UK club map" (true) and "the map would be useful on day one" (currently: mostly empty, outside the ~105 clubs with real coordinates).

**Map architecture already exists — on web.** `app/(app)/partner-clubs/` (`map-data.ts`, `club-map.tsx`, `club-map-card.tsx`, `partner-clubs-explorer.tsx`) is a real, working Leaflet (`leaflet` + `react-leaflet` + `leaflet.markercluster`) implementation: clustering, custom `L.divIcon` pins distinguishing on-Ovalball/not-on-Ovalball/partner, a status/rugby-code filter, and a client-side text search over name/town/postcode. **This is precedent, not something to copy verbatim to mobile** — it fetches the *entire* directory once (paged past PostgREST's 1000-row cap) and filters/searches in-memory client-side, which works fine at ~1,400 rows but is explicitly not a server-side geo query and would not scale cleanly to "thousands of clubs" (§37) without moving to bounding-box/server-side filtering.

**Mobile has nothing.** No map dependency, no `expo-location`, no `react-native-maps`/MapLibre package, confirmed by reading `apps/mobile/package.json` directly. Expo SDK is `^57`, React Native `0.86.3`, React `19.2.3`, running in **managed workflow with no EAS Build / custom dev client currently configured** (no `eas.json`, no `expo-dev-client` dependency). This matters a great deal for feasibility:

- **react-native-maps** and **MapLibre GL** (`@maplibre/maplibre-react-native`) are both native modules — **neither works in Expo Go.** Choosing either is really a decision to stand up EAS Build + a custom development client for the first time, which is new infrastructure this project has never needed before, not a config tweak.
- react-native-maps wraps Apple Maps (iOS) / Google Maps (Android); clustering needs a companion library (`react-native-map-clustering`); Google Maps SDK usage on Android carries Google's own usage-based billing terms beyond a free tier.
- MapLibre GL's renderer is open-source (no API key for the renderer itself) with native clustering support built into its vector-tile source model, but still needs a tile *provider* (MapTiler, Stadia Maps, etc.), which typically does need its own key/plan unless self-hosted.
- **No bottom-sheet library is installed.** The one existing `BottomSheet` component in the whole mobile app is a small hand-rolled `Modal`-based sheet used only in one safeguarding screen, not a shared/reusable design-system component. `react-native-gesture-handler` and `react-native-reanimated` — the two dependencies a real gesture-driven sheet library (`@gorhom/bottom-sheet`) would need — are already present, so that specific piece is low-incremental-cost.

**Accessibility (§67).** Nothing about a map-first UI is accessible by default; a genuine list-view fallback using the same query/filter model is a hard requirement, not a nice-to-have, and the existing web `partner-clubs-explorer.tsx` already models this correctly — it falls back to a list row ("Location unavailable") for any club without a resolved pin rather than hiding it, which is the right instinct to carry to mobile.

**Search (§38).** No third-party search service (Algolia/Typesense) anywhere in the repo. Real Postgres full-text search (`tsvector`+GIN+`pg_trgm`) exists but is scoped entirely to Rugby Hub *content*, not clubs/teams. Every club/team name search found (admin club search, fixture-request opponent search, mobile opponent search, signup club search) is a plain `ILIKE '%query%'`, unindexed by any trigram/GIN index on `club_directory`. At current scale (1,396 rows) this is fine; it is not a search index and would need one before "thousands of UK rugby clubs" (§37) is a reasonable ambition.

**Distance (§36).** No PostGIS means no server-side `ST_DWithin`/geography distance query today. A radius filter would need either (a) a bounding-box pre-filter in plain SQL using lat/lng arithmetic (workable at current scale, imprecise near poles/dateline — irrelevant for UK-only data), or (b) enabling PostGIS and adding a `geography(point)` column. Distance should stay factual (miles from the viewer/venue), never a "best club" score — consistent with the brief's own instruction and with how this codebase treats every other ranking-adjacent feature (community recognition doctrine explicitly bans scoring people; the same instinct applies here).

**Analytics (§70).** None wired up anywhere — no PostHog/Segment/Amplitude/Vercel Analytics, no bespoke event-log table. Any Clubhouse usage metric would be genuinely new infrastructure.

---

## 7. Partner Clubs — the existing feature (§15–17, §40)

This is the closest thing Ovalball already has to Clubhouse, and it should be treated as **prior art to reconcile, not a greenfield feature.**

**Schema.** `public.club_partnerships`: `requesting_club_id`, `partner_club_id` (both `references clubs(id)`, table check `requesting_club_id <> partner_club_id`), `status` (`pending | active | revoked` — note: **no separate `declined` value**; a declined pending request and a later-ended active partnership both land on `revoked`), `requested_by/at`, `responded_by/at`, `revoked_by/at`, `source_fixture_id` (set only when auto-created — see below). A **partial unique index** on `(least(a,b), greatest(a,b)) where status <> 'revoked'` is the real duplicate guard — direction-independent, and it deliberately allows re-requesting after a prior partnership was revoked. RLS carries no generic UPDATE policy at all — every transition goes through a SECURITY DEFINER RPC, because "accept must come from the non-requesting side; revoke may come from either side" isn't expressible as one `USING` clause.

**Auto-creation.** `public.accept_fixture_request` inserts a `pending` (never auto-active) `club_partnerships` row on first cross-club acceptance between two active clubs, with `source_fixture_id` stamped — confirmed directly in the migration this session itself extended earlier today (§8/§18 below).

**Lifecycle & authority.** `respond_to_club_partnership(id, approve)` — only the **invited** side (or a Site Admin) may accept/decline, via capability `club.partners.manage` (held by Club Admin and Fixtures Secretary role bundles at club scope). `revoke_club_partnership(id)` — **either** side may end it at any time. There is no "reactivate" path; a fresh row is required.

**What partnership actually grants — precisely two things, nothing broader:**
1. **Calendar visibility**: `get_partner_team_availability`/`get_scheduling_group_availability` refuse to answer at all without an active partnership (*"No active calendar-sharing agreement with this club"*), and even then only ever return coarse busy/free markers, never raw fixture rows (opponent, venue, notes stay private).
2. **Messaging auto-acceptance**: `start_or_get_club_conversation` skips the normal pending-approval step for an active partner pair only — a partner's first message is auto-`accepted` rather than requiring a `respond`.

No other RLS policy anywhere joins `club_partnerships` — **partnership does not grant roster, fixture, or document visibility.** This answers §17 directly and precisely: partnership privacy is exactly as narrow as it should be, already.

**Mobile parity: none.** Every partner-management action (view partners, request, approve/decline, cancel, revoke) exists only on web (`app/(app)/partner-clubs/`). Mobile's only touchpoints are (a) read-only consumption of partner availability data *inside* the fixture-request creation flow, and (b) an "Invite a Club to Ovalball" button that simply deep-links out to the web page rather than implementing anything natively. Under the pinned standing instruction that mobile Club Admin functionality must match the website by default, **this existing gap is already a documented violation of that standard**, independent of any Clubhouse decision — worth flagging to the owner regardless of what happens with Clubhouse.

**Notifications.** Request received, and accept/decline (with a considerate reassurance message on the auto-created-from-fixture decline path: *"Your fixture remains confirmed"*) all notify correctly. **Revocation notifies nobody** — a real, if minor, gap: the other side only discovers a revoked partnership by revisiting the page.

---

## 8. Fixture Requests, Counter-Proposals, Shared Calendar (§18–22)

This is current, first-hand knowledge from this same session's own work (CA-M11.4/CA-M11.5), not third-party research — reported directly rather than re-audited by an agent.

**Fixture requests** (`fixture_request_groups` + `fixture_requests`, one row per club-to-club negotiation batch and one row per team within it respectively) are governed by exactly two capabilities: `fixture.request.create` (raise a request — held by Coach, Team Manager, Fixtures Secretary, Club Admin) and `fixture.request.respond` (answer one — Fixtures Secretary/Team Manager/Club Admin only, deliberately narrower). `accept_fixture_request` is the one canonical acceptance path: resolves opponent venue/pitch by name match against the host's own venues, creates the real `fixtures` row (or completes an existing one, for the fixture-editor confirmation path), auto-creates the `club_partnerships` row described in §7, sends notifications to both sides.

**Counter-proposals — verified today, confirmed real.** `'counter_proposed'` had existed in `fixture_requests.status_check` since the table's creation but, until this session's own `20270553000000_a_club_may_suggest_another_time.sql` (committed at `bf6d87c`), **nothing had ever written it** — a real, previously-documented gap (found by this session's own CA-M11.4 forensic audit). The smallest canonical extension now exists: `counter_fixture_request` (propose an alternative date/kick-off/venue; only the side that did *not* make the current standing proposal may call it, enforced via a `last_proposed_by_team_id` turn-tracking column), and `accept_fixture_request` was extended (never duplicated) to accept the *current standing* terms — original or countered — with optional `p_expected_updated_at` stale-write protection on both RPCs. `fixture_request_history()` surfaces the negotiation trail from the pre-existing generic `audit_log`, not a new history table. This is committed, tested (24 self-seeding assertions, registered `CANONICAL_GATE`), and verified against the full 215-suite gate with no regressions.

**Shared calendar/availability** (CA-M11.4, `team_scheduling_availability` RPC) returns coarse per-day status (`fixture | training | club_event | request_pending | available`) for any team the caller could legitimately raise a request against, gated on the *viewer's own* fixture-request authority — not target-club membership, which is exactly the right authority shape for a "Compare Calendars" feature: it can already answer "when is this compatible team free" without exposing anything more than that.

**What Clubhouse can reuse directly:** all of it, unmodified — the request/counter/accept state machine, the availability RPC, the shared TypeScript contracts (`packages/contracts/src/fixtures/{availability,resolve-home-away-groups}.ts`, `packages/contracts/src/team/requests.ts`) already consumed identically by both clients.

---

## 9. Open Fixture Opportunities — "Looking for Opposition" (§23–26)

**Confirmed: nothing currently represents this.** No table, RPC, or UI anywhere lets a team say "we have no fixture on this date, who wants one" without addressing a specific club first. Every existing mechanism (fixture requests, Partner Clubs invitations, planner tools) requires naming a counterparty up front.

**A concrete design exists — drafted, NOT applied, NOT committed** (§0's noted file, `20270554000000_looking_for_opposition.sql`), offered here as a worked example of the smallest conceptually-consistent domain, not as a recommendation to build it exactly this way without review:

- `fixture_opportunities` (one row: publishing team/club, date, optional kick-off, venue preference *relative to the publisher*, game type, note, status `open|filled|cancelled|expired`) and `fixture_opportunity_responses` (one row per interested team, status `pending|accepted|declined|withdrawn|superseded`, at most one live response per team per opportunity).
- **Both tables carry only a SELECT RLS policy** — every mutation goes through a SECURITY DEFINER RPC (`publish_fixture_opportunity`, `cancel_fixture_opportunity`, `respond_to_fixture_opportunity`, `withdraw_fixture_opportunity_response`, `decline_fixture_opportunity_response`, `accept_fixture_opportunity_response`), matching this codebase's existing convention that any write with side effects beyond a single row belongs behind a function, not a bare table policy.
- **Convergence, not a second negotiation system**, answering §25/§26 directly: accepting one response *creates an ordinary `fixture_request_groups`/`fixture_requests` pair* and hands off to the *existing, unmodified* `accept_fixture_request` for the actual fixture-creation logic (venue resolution, partnership auto-creation, notifications) — no duplicated logic. Every *other* pending response on the same opportunity is resolved to `superseded` in the same transaction, so a second response can never later be accepted into a duplicate fixture — this is the direct answer to §26's "multiple responses" scenario.
- **Discovery is a read-policy clause, not a bypass function** — the SELECT policy on `fixture_opportunities` encodes *"an open opportunity is visible to any team that could legally play it,"* via the same `internal.teams_can_play_fixture()` compatibility rule already used everywhere else (rugby-code isolation and age-grade eligibility fall out of that one call, never a second copy of either rule). Because `fixture.request.create` is a staff-only capability, a parent/player account structurally cannot see the discovery feed at all — this is the direct answer to §47's "youth team discovery must be capability-scoped server-side" requirement.

This design is offered as evidence the domain *can* be built cleanly on existing conventions with no new capability keys and no duplicated authority logic — not as a decision that it should be built exactly this way. It has not been reviewed, has not touched the database, and per this audit's own instructions will not be applied.

---

## 10. Club claiming, directory identity, and invitations (§27–32)

**Claiming exists today and is entirely reputational, not domain-verified — this is the single most important finding for §27–28.** A user submits `public.submit_club_claim(p_claimed_role, p_authority_declaration, ...)`: a self-selected title (e.g. "Club Chair") plus a free-text "why you're authorised" statement. **There is no automated proof mechanism anywhere** — confirmed by grepping for email-domain-matching logic across every claim/signup path and finding none. The one place email-domain inference is explicitly discussed in the codebase, it is *rejected* as unreliable even for internal analytics: *"inferring [a canonical marker] from an email domain... would make production analytics quietly wrong."* A `verification_method` column (`official_email | admin_review`) exists in the earliest schema but no live code path implements automated `official_email` verification — every real approval requires an explicit **Site Admin** decision (`site.claims.review` to triage, `site.club_roles.manage` additionally required to actually grant a role — deliberately split so a lower-privilege admin can triage without being able to grant authority). Critically, **the claimed title itself grants nothing** — the reviewer chooses the actual roles freely; the code comment is blunt: *"a title on a claim grants nothing by itself."*

Directly answers §28: Ovalball already treats email-domain matching as untrustworthy by explicit design decision elsewhere in the codebase; any Clubhouse claim flow should inherit that same scepticism rather than introduce domain-matching as a shortcut.

**Invitations.** Canonical `public.access_invitations` (hashed tokens only, replacing six legacy plaintext-token tables) has nine `kind` values, each with its own `issuer_capability`/`lifetime`/`issued_level`: `SITE_ADMIN`, `ACCOUNT_SETUP`, `CLUB_STAFF`, `SAFEGUARDING_OFFICER`, `GUARDIAN`, `PLAYER_ACCOUNT`, `TEAM_JOIN_CODE` (the only multi-use kind — QR/join-code invitations), `CLUB_REFERRAL`, `GOVERNING_BODY_OFFICER`.

**"Invite a club to Ovalball" already exists, separately, and is instructive.** `public.club_ovalball_invitations` is deliberately **not** part of `access_invitations` — because it invites a *club* (a `club_directory` row), not a *person*: `create_partner_invitation(inviting_club_id, club_directory_id, contact_name, contact_email)` first validates the target is genuinely unclaimed, requires the inviter to hold fixture-management authority, is one-pending-invite-per-pair, expires in 14 days. **Crucially, the invitation never auto-claims or fabricates an account** — when/if the invited club is later claimed through the normal (manual, Site-Admin-reviewed) claim path, `internal.reconcile_partner_invitations()` marks the invitation accepted and creates a `pending` (not auto-active) partnership, so the newly-claimed club still has to explicitly accept. **This is the clearest existing precedent for §29's "invite an unclaimed club to the network without creating spam/impersonation/unverified tenants" requirement** — it already solves exactly that problem, today, for Partner Clubs specifically, and the same pattern generalises directly to a Clubhouse "Invite to Ovalball" action from a map pin.

**Directory club detail (§31–32).** The existing `club_directory` schema already supports exactly the truthful fields the brief asks for an unclaimed sheet to show (name, crest via `club_directory.logo_storage_path` — see below, rugby code, location) and explicitly nothing else — there is no "availability"/"partner status"/"Ovalball teams" concept to fabricate for an unclaimed row, since those columns simply don't exist on `club_directory`. The danger the brief flags (§31, "do not show fake data for an unclaimed club") is naturally hard to violate here, because the unclaimed data model genuinely lacks those fields rather than requiring an application-level filter to hide them.

**Crest for unclaimed clubs — already solved.** `club_directory.logo_storage_path` was added specifically because the original design "had nowhere to store a crest and no UI to set one" for an unclaimed club; a Site Admin can now set one via an admin-only uploader. Self-service upload still requires activation (an unclaimed club cannot upload its own crest — nobody has claimed it yet), which is the correct boundary.

---

## 11. Safeguarding — what already enforces the required boundaries (§44, §46–49)

All confirmed directly in RLS/capability code, not inferred:

- **Opposition messaging is staff-only**, via `messaging.fixture_conversation.participate`, granted only to Club Admin/Fixtures Secretary (club scope) and Coach/Team Manager (team scope) — never to plain membership, never to parent/player role bundles. The resolver checks this at *either side's* club/team and explicitly removed a prior blanket Site Admin read.
- **Ordinary direct messaging is separately, independently age-gated**: `messaging.direct.send` is adult-to-adult only, enforced by `internal.is_adult_messaging_user()`, which treats any account linked to a minor player as non-adult — *"A person under 18 may message nobody, and nobody may message them, through this path"* — and there is no opposition-scoped direct-message capability at all, so a parent/player has no path anywhere in the capability catalogue to message an opposition contact directly.
- **No arbitrary youth-roster browsing**: `team.roster.view` is a separate capability from fixture-management capabilities, deliberately — the codebase records fixing exactly this as a defect (*"Fixtures Secretary reads team rosters/family graph → DENY... Seeing a fixture has never required seeing the squad's family graph"*), and it is only ever grantable per club/team, never cross-club.

**This directly answers §44's expected product boundary**: the existing capability catalogue already structurally prevents parent/player accounts from reaching inter-club coordination surfaces (fixture requests, opportunities, partner management, availability comparison) — they hold none of the capabilities those surfaces gate on. A Clubhouse implementation that reuses `fixture.request.create`/`.respond` and the same capability-gated discovery pattern shown in §9 inherits this boundary automatically, the same way `respond_to_fixture_opportunity`'s design does — it does not need a bespoke "is this a family account" check bolted on top.

**Site Admin (§45).** Confirmed platform-scoped throughout — `site.claims.review`/`site.club_roles.manage` for claim review, `site.clubs.profile.manage` as the "master" equivalent of `club.partners.manage`. Nothing in the capability catalogue treats Site Admin as a club participant; any legitimate Clubhouse Site Admin role would be administrative oversight (claim review, directory de-duplication) — never a stand-in for club membership.

---

## 12. Notifications / Action Centre (§50–51)

**`public.notifications` has no `resolved` concept at all** — only `read_at`, immutable once written except that one column (a trigger enforces this). This is deliberate and load-bearing, and the codebase states it about as plainly as a comment can:

> *"THIS IS NOT A TABLE. There is no task store, no `resolved` flag and no row that has to be closed. An attention item is a PROJECTION of canonical domain state... it disappears when the domain says the job is done, and only then... READ IS NOT RESOLVED."* — `packages/contracts/src/attention/model.ts`, `apps/mobile/app/(tabs)/notifications/index.tsx`

"Needs Attention" (the Action Centre-equivalent) is entirely re-derived live from the owning domain table's own status (`fixture_requests.status`, `club_join_requests.status`, etc.) via `packages/contracts/src/attention/{model,club,team,family,load}.ts` — a resolved job is simply not returned by the projection, never flagged "resolved but still shown." **Any Clubhouse event that should appear in Needs Attention (a pending fixture request, a pending partnership, a pending opportunity response) must be added as a new `AttentionSourceType` reading the real domain table's status — never a new boolean on `notifications` itself.** This is a hard architectural constraint, not a style preference.

Partnership notifications cover request-received and accept/decline correctly (with a considerate cross-notification on the fixture-driven decline path); **revocation notifies nobody today** — a genuine, minor, pre-existing gap.

---

## 13. Clubhouse information architecture (§33, §41–45, §53–54, §62–67)

The brief's proposed `MAP / ACTIVITY / PARTNERS` + prominent `FIND A FIXTURE` structure is coherent with what already exists — it essentially names three things the codebase already builds separately (the Partner Clubs map, the notification/attention feed, the partner list) and adds one action (Find a Fixture) that composes the existing opponent-search + availability-compare + request-creation flow the mobile fixture-request screen already does today, just not from a club-network entry point.

**Team/Club/Family context (§42–44).** Team context should preselect the team in Find a Fixture — this is a straightforward extension of the existing pattern (`apps/mobile/app/(tabs)/fixtures/new.tsx` already threads a selected team through opponent search and availability). Club context coordinating multiple teams' requests/opportunities has no existing mobile precedent (Partner Clubs is web-only) but a direct web precedent to port. Family/Player context should not reach any inter-club coordination surface at all — see §11.

**Web (§53–54).** Clubhouse's data/query layer (club geo read model, filters, compatibility) should be one shared contract package function, consumed by a native map renderer on mobile and Leaflet (already proven) on web — matching this codebase's existing discipline of one canonical TypeScript contract per domain concept consumed identically by both clients (`packages/contracts/src/fixtures/availability.ts` is the direct precedent, already built this session).

**Marker states / visual model (§61, §65).** The existing web map already distinguishes exactly three states (on-Ovalball / not-on-Ovalball / partner) via marker styling — a fourth ("Looking for Opposition") should be a small badge overlay on the existing club marker, not a second pin, to avoid the noise the brief itself warns against (§65).

---

## 14. Canonical data boundaries (§55)

| Concept | State | Evidence |
|---|---|---|
| Rugby Club Directory | **EXISTS** | `club_directory`, 1,396 rows, genuine governing-body provenance |
| Ovalball Organisation/Tenant | **EXISTS** | `clubs`, linked via `directory_id` |
| Club Location | **PARTIAL** | live on `club_directory`/`venues` via postcode geocoding; only ~7.5% coverage; `clubs.latitude/longitude` are dead columns |
| Venue | **EXISTS** | `venues`, own geocoding pipeline, better real-world coverage expected (asked for at club setup) |
| Team | **EXISTS** | canonical team directory, already governed by strict rugby-code isolation (§ CLAUDE.md) |
| Club Partnership | **EXISTS** | `club_partnerships`, full lifecycle, narrow well-scoped grants |
| Fixture Opportunity | **MISSING** | nothing exists; a drafted-but-unapplied design is in §9 |
| Fixture Request | **EXISTS** | mature, this session extended it with counter-proposals |
| Fixture Proposal (counter) | **EXISTS** | `counter_fixture_request`, committed today |
| Fixture | **EXISTS** | canonical `fixtures` table, the one authoritative record |
| Notification | **EXISTS** | `notifications`, deliberately un-resolvable, paired with a separate live "attention" projection |
| Calendar Availability | **EXISTS** | `team_scheduling_availability`, partnership-gated, coarse-status-only |

---

## 15. Reuse matrix (§80)

| Capability | Current implementation | Reuse as-is | Extend | New | Risk |
|---|---|---|---|---|---|
| Club search | Client-side `.includes()` filter over a fully-fetched directory (web) | — | Yes, to server-side ILIKE/trigram at scale | — | GREEN at current scale; AMBER at "thousands of clubs" |
| Map | Leaflet + clustering (web only) | Data model & query shape | Mobile needs a genuinely new native renderer (react-native-maps or MapLibre) | New EAS/dev-client infrastructure | AMBER — new native build pipeline, not just a package |
| Partners | `club_partnerships` + RPCs | Yes, entirely | Mobile-native UI (currently zero) | — | GREEN (schema/authority solid); AMBER (mobile gap is a standing-policy violation already) |
| Fixture request | `fixture_requests` + `accept_fixture_request` | Yes, entirely | — | — | GREEN |
| Counter-proposal | `counter_fixture_request` | Yes, entirely (shipped today) | — | — | GREEN |
| Calendar availability | `team_scheduling_availability` | Yes, entirely | — | — | GREEN |
| Compatibility | `internal.teams_can_play_fixture` | Yes, entirely | — | — | GREEN |
| Notifications | `notifications` + attention projection | Yes | New `AttentionSourceType` entries per Clubhouse event | — | GREEN |
| Action Centre | attention projection | Yes | Same as above | — | GREEN |
| Opportunities | — | — | — | New (design drafted, unapplied — §9) | AMBER — spam/abuse surface, needs rate-limiting thought |
| Directory | `club_directory` | Yes | Geocoding coverage, dedup tooling | — | AMBER — data quality, not architecture |
| Claiming | `club_claims` + Site Admin review | Yes | — | — | GREEN (deliberately manual, matches product philosophy) |
| Invite-to-Ovalball | `club_ovalball_invitations` | Yes, directly generalisable | — | — | GREEN |

---

## 16. Risk register (§74)

| Risk | Rank | Why |
|---|---|---|
| Directory data provenance / coverage gaps | **AMBER** | Real sourced data, but only 7.5% geocoded and RFU coverage is fragmented across many small regional sources — a map would look sparse honestly, not wrong |
| Club claiming — no technical ownership proof | **AMBER** | Entirely reputational today; acceptable at current scale under manual Site Admin review, but doesn't scale trust as the network grows |
| Duplicate club identity | **AMBER** | Flag-only detection exists; no merge tool. A larger network makes manual triage harder |
| Youth-team privacy / opposition discovery | **GREEN** | Structurally enforced by existing staff-only capabilities; a Clubhouse discovery feed following the §9 pattern inherits this automatically |
| Map scale (thousands of clubs) | **AMBER** | Current web implementation fetches-all/filters-in-memory; would need bounding-box/server-side querying before real scale |
| Geo data / PostGIS absence | **GREEN-AMBER** | Not a blocker at UK-only, current scale; becomes a real decision point only if distance/radius features grow more sophisticated |
| Counter-proposal concurrency | **GREEN** | Already solved and shipped today — optional stale-write protection via `p_expected_updated_at` |
| Opportunity spam/abuse | **AMBER** | Not yet designed with rate-limiting; the drafted §9 schema has no publish-frequency guard |
| Invitation abuse (club-to-club invite spam) | **GREEN** | Existing `club_ovalball_invitations` is already narrowly scoped (one pending per pair, 14-day expiry, requires real fixture-management authority to send) |
| Cross-club RLS | **GREEN** | This codebase's RLS discipline around fixture/partnership/messaging data is mature and consistently capability-gated; nothing found during this audit weakens it |
| Mobile native module infrastructure | **AMBER** | Any real map crosses from Expo Go-compatible to requiring EAS Build/dev client for the first time — genuine new operational surface, not just a library |

---

## 17. First shippable version & dependency graph (§71–72)

Recommended sequencing, derived from what's actually reusable vs. genuinely new (not a recommendation to build any of it without owner sign-off):

```
FOUNDATION (mostly already exists)
  club_directory / clubs / club_partnerships / fixture_requests / notifications-attention
       ↓
CLUBHOUSE V1 — bring EXISTING Partner Clubs to native mobile parity
  - native map (new EAS/dev-client infrastructure — the one genuinely new
    piece of platform work in V1)
  - existing club_directory data, existing club_partnerships lifecycle
  - existing Find-a-Fixture flow (already native, just not reached from here)
  - existing Activity via the attention projection
       ↓
FIXTURE EXCHANGE POLISH
  - counter-proposal UI on both clients (schema already shipped today)
  - Compare Calendars UI reusing team_scheduling_availability as-is
       ↓
OPPORTUNITIES ("Looking for Opposition")
  - the one genuinely new domain (design drafted, §9, NOT built)
       ↓
DIRECTORY GROWTH / CLAIMING AT SCALE
  - geocoding coverage work, dedup tooling, possibly stronger claim
    verification if the network grows past what manual Site Admin review
    can sustain
```

This is closer to the brief's own suggested sequence than a from-scratch alternative — the main correction the evidence supports is that **V1 is "give mobile what web already has," not "build a map from nothing."**

---

## 18. Migration / RPC / contract / screen forecasts (§75–79) — not created

**Likely migrations** (none created): a Clubhouse-specific read model/view over `club_directory` + `clubs` + `club_partnerships` for map payload shaping (avoid shipping full club rows to a map client); the `fixture_opportunities`/`fixture_opportunity_responses` schema from §9 if/when authorized; possibly a trigram index on `club_directory(name, town, postcode)` if search moves server-side before a search service is introduced.

**Likely RPCs**: a bounding-box-aware "clubs in view" query (server-side, to replace the fetch-everything pattern before scale); the six opportunity RPCs from §9; a partnership-revocation notification (small, standalone fix, independent of Clubhouse).

**Likely shared contracts**: `packages/contracts/src/clubhouse/{map-read-model, discovery}.ts`, following the existing `fixtures/availability.ts` pattern exactly — one contract, both clients.

**Likely native screens**: a Clubhouse map/list toggle screen, a club detail bottom sheet (claimed and unclaimed variants), a Find-a-Fixture entry composing existing opponent-search + availability-compare + request-creation.

**Likely web screens**: an evolution of `app/(app)/partner-clubs/` rather than a parallel build, per the brief's own "not pixel-identical, same business outcome" instruction and this codebase's own Match Centre precedent for one-shared-surface design.

None of the above has been created. This section exists to answer §75–79 as requested, not to propose a plan of record.
