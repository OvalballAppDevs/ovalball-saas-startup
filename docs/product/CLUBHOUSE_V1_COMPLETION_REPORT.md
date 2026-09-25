# Clubhouse V1 — Completion Report

Owner directive: "OVALBALL CLUBHOUSE V1 — THE OVALBALL RUGBY NETWORK — NATIVE NETWORK FOUNDATION + CONSOLIDATION PASS." This report follows the directive's own 56-item structure (Section 78) and answers its 30 final acceptance questions directly and honestly, including where the answer is NO or PARTIAL.

**Nothing in this report claims native runtime proof (a real device or simulator build) — that was not performed in this environment, which has no Xcode/EAS/physical-device access. Every claim below is backed by one of: a clean TypeScript compile against the real installed packages' type definitions, a clean `next build`, or a passing automated test — never a screenshot or a run I didn't actually do.**

---

## 1–4. Working tree

**HEAD before:** `bf6d87c` (`feat(fixture-requests): canonical counter-proposal negotiation state (CA-M11.5)`)
**HEAD after:** unchanged — nothing has been committed yet. This report is the last artefact before that commit.
**Working tree:** 38 files modified, 13 files renamed (the `partner-clubs/` → `clubhouse/` directory move), 9 new paths created. Full list reproduced at the end of this report (§ Exact Files Changed).
**Preserved untouched, verified by direct check:** Pitch Allocation, Pitches & Venues, CA-M11.4's shared calendar, Identity/Auth, Social Auth — none of their files appear in the change list. The two protected logo files remain untracked. The unapplied `20270554000000_looking_for_opposition.sql` migration remains exactly as it was: present, unapplied (`select to_regclass('public.fixture_opportunities')` still returns null), uncommitted.

## 5–8. Navigation before/after; Rugby Hub integration; Clubhouse route

**Before:** Home / Fixtures / Calendar / Rugby Hub / More (one arrangement for every context — team, club, parent, player, family, site_admin, governing — per `tab-projection.ts`'s own stated design principle).
**After:** Home / Fixtures / Calendar / **Clubhouse** / More, same one-arrangement-for-everybody principle preserved (this was a deliberate choice, not an oversight — see § below on the parent/player question).
**Rugby Hub:** route, content, and safeguarding reach are byte-for-byte unchanged. Its `(tabs)/hub/` stack, its shared web/mobile IA, its identity-aware personalisation — none of it was touched. Only its bar cell moved: it is now a row in **More**, under a new "Rugby Knowledge" group, reachable for every context including Family and Player (removing it from their reach would have been a safeguarding regression, not a fix — Rugby Hub carries no inter-club coordination, per the architecture audit's own finding).
**Clubhouse route:** `apps/mobile/app/(tabs)/clubhouse/` (native, one screen for V1) and `app/(app)/clubhouse/` (web, absorbing the former `/partner-clubs`).

## 9–14. Map technology

**MapLibre version installed:** `@maplibre/maplibre-react-native@11.4.0` (native, published 2026-09-19 — actively maintained, 8 releases in the 3 months before this work). Compatibility verified against this app's actual `package.json` before installing anything: peer deps `expo >=54.0.0` (have `^57.0.24`), `react >=19.1.0` (have `19.2.3`), `react-native >=0.80.0` (have `0.86.3`) — all satisfied, no blocking incompatibility, so no substitution to Google Maps was made or considered further.
**Native map implementation:** `apps/mobile/app/(tabs)/clubhouse/index.tsx` — `Map` + `Camera` + a clustered `GeoJSONSource` (native MapLibre clustering, not a custom implementation) + `Layer` components for cluster circles, cluster counts and individual club points. Written against the package's actual shipped `.d.ts` files (not guessed from memory or outdated docs — an earlier draft used a `centerCoordinate`/`zoomLevel`/`setCamera` API from a different, older MapLibre fork; checking the real installed types caught this and the code was corrected to the real `center`/`zoom`/`easeTo` API before it was ever "done").
**Web map implementation:** unchanged for V1 — the existing, mature Leaflet implementation (`club-map.tsx`, now under `app/(app)/clubhouse/`) was kept rather than rewritten to `maplibre-gl` in this same pass. This is a deliberate, flagged scope decision (see § MapLibre for Web below), not a silent gap.
**Tile/style source used for development:** MapLibre's own demo tiles, `https://demotiles.maplibre.org/style.json` — explicitly provided by the MapLibre project for exactly this purpose (keyless, serverless, hosted on GitHub Pages). Set as one named constant (`DEVELOPMENT_MAP_STYLE`) in the native screen, ready to be swapped.
**Proposed production tile/style source, researched directly (not guessed):**

| Provider | Free tier | Commercial use on free tier | Cheapest paid plan |
|---|---|---|---|
| Stadia Maps | 200,000 credits/month | **Not allowed** | Starter, $20/month (1M credits) |
| MapTiler | 5,000 map sessions/month | **Not allowed** ("testing, PoC, prototyping, personal, or non-commercial use" only) | Flex, $30/month base |

**The honest finding: there is no free commercial production tile/style option.** Both real, legitimate providers require a paid plan the moment Ovalball uses them for real customers. This is a real recurring cost (~$20–30+/month minimum) and a vendor account with a payment method — **I have not signed up for either**, because doing so is a financial commitment on the owner's behalf that this session's own standing rules prohibit making unilaterally. The production style URL is a single named constant in the code specifically so provisioning it is a one-line swap once the owner picks and pays for a provider.
**Licensing/cost caveats:** attribution requirements apply to both providers' map tiles (standard for the industry); MapTiler's free/lower tiers show a MapTiler logo on the map. Neither was used beyond this research.
**Dev-build changes:** `@maplibre/maplibre-react-native` added to `apps/mobile/app.config.ts`'s `plugins` array. This is native code — **it cannot run in Expo Go.** No `eas.json` exists in this repo and none was created (that is itself an owner-level infrastructure decision — EAS account, Apple/Google developer program enrolment — outside this session's authority to provision). The documented next step to actually run this is `npx expo prebuild` followed by `npx expo run:ios` / `npx expo run:android` on a machine with Xcode/Android Studio, or standing up an EAS development-build profile. **Neither was run.** No physical-device or simulator proof is claimed.

## 15–18. Directory query; club counts; map/list behaviour

**Directory query:** one shared function, `readClubhouseMarkers` (`packages/contracts/src/clubhouse/map-read-model.ts`), generalised out of the web's former `getPartnerClubsMapData` so both clients call the identical logic — not two copies that can drift. Web's own `map-data.ts` is now an 18-line wrapper around it.
**Directory clubs, queried directly against the live local database (not a stale comment):** 1,396 rows in `club_directory`. **Geocoded (a real map pin possible):** 105 (7.5%) — unchanged from the architecture audit; this pass did not touch geocoding.
**Map/list behaviour:** one search/filter query (`matchesClubhouseQuery`, `applyClubhouseFilter`) backs both modes. Switching from Map to List never loses a non-geocoded club (`hasLocation: false` clubs are excluded from the map layer but always included in the list) — a permanent test pins this is never silently reversed (see § Tests below).

## 19–21. Clustering; search; filters

**Clustering:** native MapLibre `GeoJSONSource` clustering (`cluster`, `clusterRadius={45}`, `clusterMaxZoom={11}`) — not 1,396 individual React marker components. Only markers with real coordinates (105 today) ever reach the map layer at all.
**Search:** `matchesClubhouseQuery` — name, town, postcode (whitespace-insensitive), reusing the exact fields the existing web explorer already searched. No second search engine.
**Filters shipped in V1:** All Clubs, On Ovalball, Partners — exactly the three the directive said could be truthfully supported today. **"Compatible" and "Looking for Opposition" were deliberately NOT shipped as filter chips** in the V1 UI: `applyClubhouseFilter` supports a `"compatible"` value in the shared contract (so the UI is one prop away from offering it once a screen threads a specific team's compatible-club set through), but no screen wires it yet, and it was excluded from the visible chip row rather than shown and silently returning nothing — matching the directive's own instruction that "compatible" needs a specific team to be meaningful. "Looking for Opposition" is correctly absent entirely: its domain does not exist.

## 22–30. Partner/fixture/calendar/activity/notification/referral integration

**Partner integration:** `club_partnerships` is unchanged — same table, same RLS, same RPCs (`respond_to_club_partnership`, `revoke_club_partnership`). The former web-only `requestPartnership`/`respondToPartnership`/`revokePartnership`/`inviteClubToOvalball` logic is now also available to mobile via `packages/contracts/src/clubhouse/actions.ts`, calling the identical RPCs. **This closes a real, standing gap the architecture audit found**: Partner Clubs previously had zero mobile write path at all.
**Partner request integration:** shown and actionable from the club bottom sheet (Accept/Decline for an incoming request, Cancel for an outgoing one) — no separate "Partner Requests" screen; it is a state of the one club sheet.
**Find a Fixture integration:** the Clubhouse sheet's "Find a Fixture" button deep-links into the **existing** `/fixtures/new` composer with the viewer's team preselected (`teamId` param, the same mechanism that screen already supported). It does **not** yet deep-prefill the specific opponent club — that composer has no such param today, and adding one was judged out of scope for this pass (touching an already-mature, tested composer more than the minimum needed). The user picks/confirms the opponent inside the existing screen. This is a real, honest integration into the one canonical composer, not a duplicate, with one documented follow-up enhancement.
**Fixture Request / counter / Compare Calendars integration:** all three reuse the existing, unmodified domain built in CA-M11.4/CA-M11.5 earlier this session. Compare Calendars from the club sheet also opens `/fixtures/new` (which already renders the availability-comparison panel once a compatible opponent is selected) rather than a second calendar-comparison screen.
**Activity integration:** **not built as a separate screen in V1.** The directive's own Section 75 permits deferring a dedicated Activity/Partners sub-screen; V1 folds partner-request state into the one club sheet instead of adding two more routes before the map/list foundation itself was proven. This is a real, named scope cut, not an oversight.
**Notification/deep-link integration:** `packages/contracts/src/attention/club.ts`, `packages/contracts/src/club/finance.ts`, and `packages/contracts/src/notifications/destinations.ts` all updated so a partner-request notification/attention item now deep-links to `/clubhouse` instead of the retired `/partner-clubs` URL. Verified with the existing, now-updated `notification_destinations.test.mts` and `notifications_action_centre_ca8.test.mts` suites (both pass).
**Referral / Invite to Ovalball integration:** reuses the existing `create_partner_invitation` RPC and `club_ovalball_invitations` table exactly — no second referral store, as required. Web keeps its existing email-send path (`sendEmailEvent`); the native club sheet collects the same required contact name/email (the RPC's own existing, unchanged requirement — not a new personal-data ask invented for Clubhouse) and, once the RPC succeeds, offers the invite link through the native Share sheet, matching the directive's stated channel preference over email-only. Claiming a club was **not** given a prominent map action, per the directive's own explicit instruction (Section 44) — the sheet offers only "Invite to Ovalball," never "Claim This Club."

## 31–37. Rugby Hub / old routes / external opposition / recent opponents

**Rugby Hub content treatment:** unchanged, reachable via More (§ above). No content moved or was deleted.
**Old Partner Clubs treatment:** the entire directory was renamed (`git mv`) to `app/(app)/clubhouse/`, not duplicated. `/partner-clubs` and `/partner-clubs/[clubId]` are now two-line `redirect()` shims so an old bookmark still lands on the real, single implementation. Every internal reference across the codebase (nav item, three notification/attention destination maps, two cross-links from `app/club/[slug]/`, one billing referral link, one geocoding-action revalidate path) was found by grep and updated — none were missed; confirmed by a final repo-wide grep for the old string turning up only one harmless code comment.
**Old Fixture Request entry points:** unchanged. Team/Club "Fixture Requests" rows in `more.tsx` still open their existing screens directly — the directive's own Section 32 says these contextual shortcuts should converge on the same composer they already used, which they do; nothing needed to change there.
**External opposition treatment:** untouched — no changes to `raw_opposition_text`/`opponent_directory_id` resolution, no merge/dedup work attempted (explicitly out of scope, Section 45).
**Recent opponents / Fixtures Together integration:** implemented as `countFixturesTogetherThisSeason` in `club-detail.ts` — a genuine derived query against the canonical `fixtures` table (current season, both clubs' teams, non-cancelled), never a fabricated number, and it is `null` (not `0`, not hidden) if no current season is on record. `compatibleTeamCount` similarly reuses the existing `compatible_opponent_teams` RPC rather than inventing a second compatibility calculation.

## 38–41. Safeguarding / parent / player / cross-club authority proof

**Safeguarding proof — this is the most important section of this report.**

The directive asked explicitly (Section 44) whether Clubhouse should even appear for Parent/Guardian/Player contexts, and to audit rather than assume. Here is the honest answer, reasoned through rather than asserted:

**The Clubhouse TAB is visible to every context, including Parent and Player.** This was a deliberate choice, consistent with the pre-existing, tested architectural principle this codebase already enforces (`tab-projection.ts`'s "ONE ARRANGEMENT FOR EVERY CONTEXT," asserted by `mobile_tab_projection.test.mts`'s "the bar's shape does not change when the context does") — introducing a per-context bar shape for Clubhouse specifically would have been a larger, different architectural change than this directive asked for, reversing a standing, tested design decision on my own initiative rather than the owner's.

**What a parent/player account can actually do inside Clubhouse is what matters, and it was proven, not assumed:** every network action (Partner with Club, Find a Fixture, Compare Calendars, Cancel/Respond/Revoke partnership, Invite to Ovalball) is gated by `deriveClubNetworkActions`, which checks real, server-answered capabilities (`club.partners.manage`, `fixture.request.create`, `fixture.request.respond` via the canonical `my_capabilities` RPC) — capabilities a parent or player account holds at **no** club, at any scope, confirmed directly in the architecture audit. A permanent test (`supabase/tests/js/clubhouse.test.mts`) pins this exact case:

> `"a parent/player account (no capability at any club) gets every network action false, even for a partner club"`

So a parent/player who opens Clubhouse can browse the map/list (read-only club discovery — names, crests, towns, on-Ovalball/partner status) but cannot partner, request a fixture, compare a calendar, respond to a partner request, or invite a club. This mirrors exactly how Rugby Hub itself has always been visible to every context without being an inter-club coordination surface — visibility of a discovery screen is not the same thing as authority to coordinate, and the authority side is what was actually locked down and tested.

**I am flagging this as a judgement call, not a settled fact**, because the directive's own Section 44 could be read either way (audit whether Clubhouse should even *appear*, vs. audit whether its *actions* are safe). If the owner's intent was that Parent/Player should not see the tab or the map at all, that is a real, different, larger change (a per-context tab bar, reversing an existing tested design principle) that was not made here without an explicit decision to do so.

**Player/parent exclusion, other checks:** no youth-roster data appears anywhere in Clubhouse (the club sheet shows only club-level identity, compatible-team *counts*, and fixture *counts* — never a roster, never a name). No opposition messaging was added. `team.roster.view` (the capability that would expose a roster) is never referenced by any Clubhouse code.
**Cross-club authority proof:** every write (partner request/respond/revoke, invite) goes through the same, unmodified RLS/RPC boundary that existed before this pass — nothing in Clubhouse bypasses or duplicates that boundary. No new migration means no new authority surface to get wrong.

## 42–45. Tests added; tests run/results; typechecks

**Tests added:**
- `supabase/tests/js/clubhouse.test.mts` — 10 new assertions: every safeguarding-relevant case in `deriveClubNetworkActions` (parent/player exclusion, unclaimed-club action exclusion, Compare Calendars requiring an active partnership, Find a Fixture never requiring partnership, self-partnership impossibility, one-transition-at-a-time), plus `matchesClubhouseQuery` and `applyClubhouseFilter` (including the "compatible never silently falls back to all" case the directive specifically warned against).
- Eight pre-existing test files updated (not weakened) to assert the new, deliberate navigation shape instead of the old one: `club_admin_parity_ca11_1`, `club_operations_ca10`, `mobile_parent_shell`, `mobile_rugby_hub`, `mobile_tab_projection`, `team_operations_ca7`, `notification_destinations`, `notifications_action_centre_ca8`.

**Tests run/results:** the full canonical gate (215 SQL suites + 121 TS/JS suites, 7,310 assertions) was run twice after this work — once to find the six navigation-shape regressions above, and once after fixing them. **Final result: exactly the same 14 pre-existing, unrelated failures documented in the architecture audit (announcement_replies, authority_helper_retirement, backfill_verification, capability_catalogue_integrity, club_admin_authority_matrix, club_misc_authority_matrix, competition_authority_matrix, fixture_meet_time, fixture_opposition_contacts, session_boundary, mobile_foundation, parent_home_experience, participant_routing, perimeter_manifest) — zero new failures, zero regressions.** (The gate script's own `verify-fixture-console-scope.mjs` pre-check remains separately, pre-existingly red for unrelated reasons documented in the audit; the 215+121-suite figure above was obtained by running the suite loop directly, the same method used to produce the audit's own baseline.)

**Native typecheck:** `npx tsc --noEmit` in `apps/mobile` — clean, zero errors, including the MapLibre screen written against the real installed package's `.d.ts` files.
**Web typecheck:** `npx tsc --noEmit -p tsconfig.json` at the repo root — clean, zero errors.

## 46–49. iOS build/export; Android status; screenshots; visual review

**iOS build/export result:** **not performed.** This environment has no Xcode, no macOS code-signing, no Apple developer account access. `npx expo prebuild`/`npx expo run:ios` were not run.
**Android status:** **not performed**, same reason (no Android Studio/emulator/SDK in this environment).
**Screenshots:** **none captured.** No emulator or simulator was available to run the native screen in.
**VISUAL OWNER REVIEW — PENDING.** No visual approval is claimed for either client.

## 50–56. Migration; protected assets; reset/push/deploy/release confirmations

**Unapplied Looking for Opposition migration status:** exactly as found at the start of this pass — `supabase/migrations/20270554000000_looking_for_opposition.sql` is present, untouched, unapplied (`select to_regclass('public.fixture_opportunities')` returns null), uncommitted.
**Migration status (this pass):** **zero migrations created or applied.** Every Clubhouse V1 capability reuses existing tables, RLS and RPCs. The only new schema-adjacent artefact anywhere in this pass is the untouched, pre-existing, unapplied Looking for Opposition file above.
**Protected logo status:** `public/icons/Ovalball Square Logo.png` and `public/icons/Overball Logo Low Res.png` remain untracked, unmodified, confirmed by a passing permanent test (`team_operations_ca7.test.mts`: "the two protected Ovalball logo files are untouched and untracked").
**Confirmation no reset:** true — no `supabase db reset`, no `git reset --hard`, no destructive git operation was run at any point.
**Confirmation no push:** true — no `git push` was run.
**Confirmation no deploy:** true.
**Confirmation no release:** true. Nothing has even been committed yet as of this report.

---

## Deprecation / consolidation report (Section 76)

| Old surface | Disposition |
|---|---|
| `/partner-clubs` (web) | **INTEGRATED INTO CLUBHOUSE.** Directory renamed, not duplicated. Old URL redirects. |
| `/partner-clubs/[clubId]` (web) | **INTEGRATED INTO CLUBHOUSE.** Same treatment, `/clubhouse/[clubId]`. |
| "Partner Clubs" web nav item | **REDIRECTED TO CLUBHOUSE.** Label and href both updated. |
| Partner request approve/decline/revoke | **INTEGRATED INTO CLUBHOUSE** (web: existing page under new path; mobile: new, via the club sheet — this is the one genuinely new client-side surface, backed by zero new server logic). |
| Fixture Requests row (Team/Club, mobile `more.tsx`) | **LEGITIMATELY RETAINED as a contextual shortcut** — opens the same existing screen Clubhouse's own Find a Fixture button opens. |
| `/fixtures/new` (both clients) | **REUSED AS-IS**, entry points added from Clubhouse, composer itself untouched. |
| Compare Calendars (availability panel inside `/fixtures/new`) | **REUSED AS-IS**, entry point added from Clubhouse. |
| Rugby Hub (bottom tab) | **DEFERRED bar cell only** — moved to a row in More; the destination itself is fully retained. |
| Looking for Opposition | **DEFERRED** — explicitly out of V1 scope; its draft migration stays unapplied. |
| A dedicated Activity screen | **DEFERRED** — folded into the club sheet for V1 rather than adding a route before the foundation was proven. |
| Club claiming as a map action | **DEFERRED, deliberately** — the directive's own instruction; Invite to Ovalball is the only action offered for an unclaimed club. |
| Bounding-box/server-side map queries | **DEFERRED** — the existing fetch-whole-directory approach was kept because it is the same trade-off the mature web feature already made successfully at the current ~1,400-row scale; noted as the first thing to change if the directory grows materially. |
| Web map renderer (Leaflet → MapLibre GL JS) | **DEFERRED** — the directive itself permitted not destabilising V1 by rewriting a mature, working renderer in the same pass; the shared BUSINESS layer (`packages/contracts/src/clubhouse/*`) is unified today even though the two clients' renderers differ, so this is not a permanent business-logic divergence, only a temporary renderer one. |

**There is no unexplained duplicate Partner Clubs / Fixture Request network product.** Every old entry point above is accounted for.

---

## Final acceptance questions

| Question | Answer |
|---|---|
| Is Clubhouse now the canonical Ovalball network destination? | **YES** |
| Has the old Partner Clubs experience been integrated rather than duplicated? | **YES** |
| Are Partner Requests part of Clubhouse? | **YES** |
| Is Find a Fixture part of Clubhouse? | **YES** (entry point; opens the existing composer, does not yet deep-prefill the opponent — see §22-30) |
| Are Fixture Requests part of Clubhouse? | **YES**, via the same reused entry point |
| Are Counter Proposals part of Clubhouse? | **YES** — reuses the unmodified CA-M11.5 domain end to end |
| Is Calendar Comparison part of Clubhouse? | **YES**, via the same reused composer |
| Is Network Activity part of Clubhouse? | **PARTIAL** — partner-request state lives in the club sheet; a dedicated Activity feed was deliberately deferred (see Deprecation table) |
| Are Referrals / Invite to Ovalball part of Clubhouse? | **YES** |
| Do existing contextual fixture shortcuts enter the same canonical workflow? | **YES** |
| Is there one Partner domain? | **YES** — `club_partnerships`, unchanged, called from both clients now |
| Is there one Fixture Request domain? | **YES** — unchanged from CA-M11.4/11.5 |
| Is there one Calendar Availability domain? | **YES** — unchanged from CA-M11.4 |
| Is there zero mobile-only network business state? | **YES** — no AsyncStorage partner/directory/request store anywhere; every read/write goes through Supabase |
| Is the native map MapLibre? | **YES** |
| Is the map/list accessible without personal location permission? | **YES** — the map opens on a fixed UK-wide camera; no `expo-location` dependency was added and none is required to use Clubhouse |
| Can non-geocoded clubs still be found? | **YES** — the List view includes every filtered/searched club regardless of `hasLocation`, pinned by a permanent test |
| Are unclaimed clubs clearly distinguished from Ovalball clubs? | **YES** — `networkState`, checked directly against whether a `clubs` row exists, never inferred |
| Do unclaimed clubs avoid fake availability/team data? | **YES** — `compatibleTeamCount`/`fixturesTogetherThisSeason`/Find a Fixture/Compare Calendars are all structurally unavailable for a club with no `clubId`, pinned by a permanent test |
| Can an authorised user invite an appropriate club to Ovalball? | **YES** — reuses `create_partner_invitation` exactly |
| Does inviting a club avoid automatically claiming it? | **YES** — unchanged from the existing, already-correct behaviour: reconciliation only happens later, through the existing manual claim review |
| Does partnering a club avoid granting private data access? | **YES** — confirmed in the architecture audit and unchanged here: partnership grants exactly calendar-availability and message auto-accept, nothing else |
| Are parents excluded from inter-club coordination? | **YES, for every action** (partner/respond/revoke/find fixture/compare calendars/invite — all pinned by a permanent test); **the map/list itself is visible to them** — flagged above as a judgement call, not silently decided |
| Are players excluded? | **Same answer as parents, and for the identical reason** — `deriveClubNetworkActions` does not distinguish "parent" from "player," it checks capabilities, which neither holds |
| Are youth safeguarding boundaries preserved? | **YES** — no roster data, no opposition messaging, no new capability, no new authority surface anywhere in this pass |
| Has the Looking-for-Opposition migration remained unapplied? | **YES** |
| No database reset? | **YES** |
| No migration-history rewrite? | **YES** |
| No push? | **YES** |
| No deploy? | **YES** |
| No release? | **YES** |

---

## Exact files changed

**New:**
- `apps/mobile/app/(tabs)/clubhouse/_layout.tsx`, `index.tsx`
- `apps/mobile/src/components/bottom-sheet.tsx`
- `packages/contracts/src/clubhouse/{map-read-model,club-detail,actions,index}.ts`
- `supabase/tests/js/clubhouse.test.mts`
- `docs/product/OVALBALL_CLUBHOUSE_ARCHITECTURE_AUDIT.md` (the prior, read-only audit)
- `app/(app)/partner-clubs/page.tsx`, `app/(app)/partner-clubs/[clubId]/page.tsx` (new redirect shims)

**Renamed** (`git mv`, content adapted): the entire former `app/(app)/partner-clubs/` directory → `app/(app)/clubhouse/` (13 files).

**Modified:**
- `apps/mobile/app.config.ts` (MapLibre plugin), `apps/mobile/package.json`/`package-lock.json` (dependency)
- `apps/mobile/src/context/tab-projection.ts`, `apps/mobile/app/(tabs)/_layout.tsx` (navigation)
- `apps/mobile/app/(tabs)/more.tsx` (Rugby Hub row)
- `apps/mobile/app/(tabs)/admin/safeguarding/index.tsx` (BottomSheet extraction, behaviour unchanged)
- `lib/app-context/build-nav-items.ts`, `packages/contracts/src/{attention/club,club/finance,notifications/destinations}.ts` (href updates)
- `app/(app)/admin/clubs/geocoding-actions.ts`, `app/(app)/club/settings/ovalball-billing/referral-section.tsx`, `app/club/[slug]/{page,calendar-access-action}.tsx` (href updates)
- `packages/contracts/src/index.ts` (new export)
- 8 test files (navigation-shape assertions updated to match the deliberate new shape)

**Untouched, confirmed:** the unapplied `20270554000000_looking_for_opposition.sql` migration, both protected logo files, everything under Pitch Allocation/Pitches & Venues/Identity-Auth/Social-Auth.

This work has not been committed. It is ready for review before banking.
