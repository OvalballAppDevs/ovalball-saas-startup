# Clubhouse Master Project Plan

**Owner decision recorded here:** Clubhouse is a major, first-class Ovalball product — the canonical experience for legitimate club-to-club rugby networking and coordination. Not another Partner Clubs screen, Fixture Requests screen, Rugby Hub screen, messaging screen, directory screen, or generic social network. Built section by section; no automatic progression between sections without explicit owner instruction.

This document is the whole destination. `CLUBHOUSE_PROGRAMME_LEDGER.md` tracks actual delivery status against it. `docs/product/clubhouse/SECTION_XX_*.md` holds each section's own detail.

---

## 0. Verified current state (source-checked, not assumed)

Before planning, every "Clubhouse V1 reportedly already established" claim was checked directly against source and the running database, not taken on faith:

| Claim | Verified |
|---|---|
| Canonical `/clubhouse` web destination | **YES** — `app/(app)/clubhouse/page.tsx`, compiles in `next build` |
| Old `/partner-clubs` redirects | **YES** — two-line `redirect()` shims at both `/partner-clubs` and `/partner-clubs/[clubId]` |
| Native Clubhouse tab | **YES** — `apps/mobile/app/(tabs)/clubhouse/`, bar order confirmed `["index","fixtures","calendar","clubhouse","more"]` in `tab-projection.ts`, pinned by `mobile_tab_projection.test.mts` |
| MapLibre native foundation | **YES** — `@maplibre/maplibre-react-native@11.4.0` installed, config plugin registered, written against the package's real shipped `.d.ts` |
| Directory map, clustering, search, filters | **YES**, native — `GeoJSONSource` with `cluster`, `matchesClubhouseQuery`, three filter chips (All/On Ovalball/Partners) |
| Native club sheet | **YES** — `ClubSheet` in `clubhouse/index.tsx`, real actions wired |
| Partner integration | **YES** — request/respond/revoke via `packages/contracts/src/clubhouse/actions.ts`, calling the unchanged `club_partnerships` RPCs |
| Find Fixture / Compare Calendar integration | **YES, as entry points** — both open the existing `/fixtures/new` composer; **no opponent-club deep-prefill yet** (a real, named gap, not silently missing) |
| Invite to Ovalball | **YES** — reuses `create_partner_invitation` exactly |
| Shared read model | **YES** — `packages/contracts/src/clubhouse/{map-read-model,club-detail,actions}.ts`, both clients call the same functions |
| Safeguarding/capability proof | **YES** — `deriveClubNetworkActions` pure function, 10 pinned tests including "parent/player gets every action false" |
| Directory scale | **1,396** `club_directory` rows, **105** geocoded (7.5%) — reconfirmed by direct query today, unchanged since the architecture audit |
| Looking for Opposition migration | **UNAPPLIED, UNCOMMITTED**, confirmed via `select to_regclass('public.fixture_opportunities')` returning null |

**One real gap found during this verification pass, not previously documented:** `club_partnerships_select_scoped` RLS requires the caller to hold `club.partners.manage` at **club** scope specifically (`internal.club_ids_with('club.partners.manage')`). A team-scoped Coach/Team Manager holds `fixture.request.create`/`.respond` at **team** scope, never `club.partners.manage` — so for a team-context viewer, every partnership-status query in `readClubhouseMarkers`/`club-detail.ts` silently returns zero rows (RLS filtering, not an error) and every club shows `partnershipStatus: "none"`, even where a real active partnership exists. This is not a security hole (RLS is correctly refusing data the viewer has no authority over) — it is an **accuracy gap**: mobile's Clubhouse tab is reachable from every context including team, so a team-scoped user today sees a map that silently under-reports partnership state. **This belongs to Section 5 (Partners), not Section 1** — noted here so it is never lost, and referenced again in that section's own plan.

---

## 1. Dependency graph

```
FOUNDATION (mostly complete: CA-M11.2/11.4/11.5 + Clubhouse V1)
  club_directory / clubs / club_partnerships
  fixture_requests / counter_fixture_request / accept_fixture_request
  team_scheduling_availability
  packages/contracts/src/clubhouse/*
       |
       v
SECTION 1 — Shell & Navigation  (THIS PASS)
       |
       v
SECTION 2 — Map & Discovery  ─────────────┐
       |                                   |
       v                                   v
SECTION 3 — Directory & Geo Coverage   SECTION 4 — Club Profile / Sheet
       |                                   |
       └───────────────┬───────────────────┘
                        v
              SECTION 5 — Partners
        (closes the team-scope RLS accuracy gap above)
                        |
                        v
              SECTION 6 — Find a Fixture ──────┐
                        |                       |
                        v                       v
        SECTION 7 — Find Clubs Free on Dates   SECTION 8 — Arrange a Fixture
                        |                       |
                        └───────────┬───────────┘
                                    v
                        SECTION 9 — Fixture Negotiation
                (domain already built: CA-M11.5 counter-proposal.
                 This section is mostly UI assembly, not new domain work.)
                                    |
                                    v
                        SECTION 10 — Club Messaging  [RED]
                                    |
                                    v
                        SECTION 11 — Clubhouse Activity
                                    |
                        ┌───────────┴───────────┐
                        v                       v
        SECTION 12 — Referral Programme   SECTION 13 — Referral Tracking
                        |
                        v
                SECTION 14 — Club Claiming & Verification  [RED]
                        |
                        v
                SECTION 15 — Looking for Opposition
        (re-audit the parked migration from scratch; do not assume it)
                        |
                        v
                SECTION 16 — Opportunity Matching
                        |
                        v
                SECTION 17 — Recent Opponents & Network Memory
        (countFixturesTogetherThisSeason already exists in club-detail.ts --
         this section generalises it, does not start it from zero)
                        |
                        v
                SECTION 18 — Clubhouse Polish
                        |
                        v
                SECTION 19 — Cross-Client Convergence
                        |
                        v
                SECTION 20 — Release Hardening
```

**No change recommended to the given section order.** The dependency shape the directive proposed already holds: geography (2-4) before relationships (5) before coordination (6-9) before communication (10) before activity/growth (11-14) before the genuinely new domain (15-16) before memory/polish/hardening (17-20). The two adjustments worth recording are annotations, not reordering:

- **Section 9's real remaining scope is smaller than the directive's own description implies.** The state machine, stale-write protection, and history (`counter_fixture_request`, `accept_fixture_request`, `fixture_request_history`) were built and shipped in CA-M11.5, earlier this session. Section 9 is UI assembly (a negotiation-thread view inside Clubhouse) reusing that domain, not new server work.
- **Section 6/7's backend is substantially pre-built.** `team_scheduling_availability`, `readTeamAvailability`, `compareAvailability`, and `findGoodDates` (CA-M11.4) already answer "is this team free on this date" in the privacy-safe shape Section 7 describes. Both sections are primarily UI/query-composition work over an existing domain, not new privacy engineering — though Section 7's specific "clubs free across several dates within a radius" query does need new composition (a multi-date, radius-bounded fan-out over the existing per-team function), which is new work, just not new privacy design.

## 2. Functionality absorption map

| Section | Absorbs |
|---|---|
| 1 | Old `/partner-clubs` nav entry (done), Club Admin sidebar prominence |
| 2 | Nothing new absorbed — establishes the map surface itself |
| 3 | `lib/geocoding/*`, `app/(app)/admin/clubs/geocoding-actions.ts` |
| 4 | Old `/partner-clubs/[clubId]` detail page's content, `club-status-pill.tsx` |
| 5 | `club_partnerships` (full lifecycle), the former `/partner-clubs` list views |
| 6-8 | `apps/mobile/src/agenda/opponent-search.ts`, `app/(app)/fixtures/new/search-opponents.ts`, `compatible_opponent_teams`/`compatible_opponent_identities` |
| 9 | `counter_fixture_request`, `accept_fixture_request`, `fixture_request_history` (CA-M11.5, already built) |
| 10 | `club_conversations`/`start_or_get_club_conversation` (existing club-to-club messaging domain — **must be audited before any new UI**, per the directive's own instruction) |
| 11 | `packages/contracts/src/attention/*` (the existing "Needs Attention" projection pattern) |
| 12-13 | `club_ovalball_invitations`, `create_partner_invitation`, `internal.reconcile_partner_invitations` |
| 14 | `club_claims`, `submit_club_claim`, `decide_club_claim`, `internal.claim_suggested_roles` |
| 15-16 | The parked `20270554000000_looking_for_opposition.sql` draft — **to be re-audited, not assumed correct**, before any of it is built |
| 17 | `club-detail.ts`'s existing `countFixturesTogetherThisSeason`/`countCompatibleTeams` (already built in V1) |

## 3. Migration forecast (none applied — identified only)

| Likely migration | Section | Why | Avoidable? |
|---|---|---|---|
| Bounding-box/viewport marker query RPC | 2 or 3 | Today's fetch-whole-directory approach works at ~1,400 rows; will not at "thousands" | Deferrable until directory size actually grows — **not needed for Section 2 itself** |
| Geocoding coverage/confidence columns | 3 | If corrections/confidence tracking is required beyond today's `geocode_status` | Possibly avoidable if `geocode_status`'s existing states are judged sufficient |
| Club-to-club structured conversation extension | 10 | If `club_conversations` cannot cleanly represent Fixture Request / Partnership / Opportunity thread TYPES without a new column | Depends entirely on Section 10's own audit — genuinely unknown until that audit runs |
| Claim verification signal(s) | 14 | If the owner wants a stronger-than-reputational signal recorded | Explicitly deferred by the directive itself ("no single email domain should automatically prove ownership") — likely a Section 14 design question before any schema |
| Looking for Opposition domain | 15 | The parked draft itself | **Explicitly parked** — re-audit before deciding anything, including whether the existing draft is even the right shape |
| Referral incentive/tracking fields | 13 | Only if the owner approves an incentive programme | Explicitly gated: "DO NOT invent cash rewards, credits, discounts, points without owner approval" |

## 4. RED security sections

Per the directive's own test-governance framework:

- **Section 10 — Club Messaging.** Cross-club-to-club structured communication touches the same safeguarding boundary this codebase has enforced carefully throughout (`messaging.fixture_conversation.participate` is staff-only; `messaging.direct.send` is adult-only). Must audit existing `club_conversations` before any UI; must prove Parents/Players/Children get zero opposition-messaging surface, not just a hidden button.
- **Section 14 — Club Claiming & Verification.** Currently 100% reputational (a free-text declaration + manual Site Admin review, confirmed in the architecture audit). Any change here touches who can become a club's authorised representative — real impersonation/duplicate-tenant/hostile-claim risk.
- **Section 15/16 — Looking for Opposition / Opportunity Matching**, where security-sensitive (spam/abuse of a public-ish "we need a game" posting, and the multiple-response-resolution race the earlier drafted-but-unapplied migration was designed around).
- **Section 5 — Partners**, specifically the team-scope RLS accuracy gap found in this pass (§0 above) — not a new authority hole, but a correctness gap in an already-shipped surface that touches cross-club relationship visibility.

Everything else is GREEN (presentation/read-only) or AMBER (ordinary mutation, existing authority reused) by the directive's own classification.

## 5. Owner decisions genuinely required (not decidable in-session)

1. **Production map tile/style provider.** No free commercial tier exists at any legitimate provider researched (Stadia Maps, MapTiler); the cheapest is ~$20–30/month. This needs a paid vendor account — a real recurring cost and a payment method, which this session will not provision unilaterally.
2. **Referral incentive programme**, if any — the directive explicitly reserves this decision.
3. **Claim verification strength** (Section 14) — whether the existing reputational model is acceptable at Clubhouse's intended scale, or whether a stronger signal is worth the friction it adds to legitimate claims.
4. **Team-context web nav promotion.** Mobile already gives every context (including team) the Clubhouse tab; web's Section 1 promotion in this pass was scoped to Club Admin only, per the directive's literal wording ("Club Admin web navigation"). Whether team-context web users should also get a top-level Clubhouse link (matching mobile) is a real, small, but explicit product-consistency decision, not assumed here.
5. **Whether Discover/Fixtures/Activity/Partners should ever become distinct navigable surfaces** inside Clubhouse (e.g. as sub-tabs of the one screen) versus staying folded into the map + sheet + occasional dedicated screens shape V1 already established. The directive itself says "do not necessarily expose these as four permanent tabs if a stronger native/web UX exists" — a design call best made once Sections 2-4 give it something real to look at.

---

## 6. Section list (reference — full detail lives in `docs/product/clubhouse/SECTION_XX_*.md` as each section starts)

1. Shell & Navigation — **IN PROGRESS, this pass**
2. Map & Club Discovery
3. Club Directory & Geo Coverage
4. Club Profile / Club Card
5. Partners
6. Find a Fixture
7. Find Clubs Free on Certain Days
8. Arrange a Fixture
9. Fixture Negotiation
10. Club Messaging — RED
11. Clubhouse Activity
12. Referral Programme
13. Referral Tracking
14. Club Claiming & Verification — RED
15. Looking for Opposition
16. Opportunity Matching
17. Recent Opponents & Network Memory
18. Clubhouse Polish
19. Cross-Client Convergence
20. Release Hardening

No section beyond 1 is authorised to begin without explicit owner instruction.
