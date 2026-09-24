# Rugby Hub — web → native parity map

One Rugby Hub, two clients. This map lists every web Rugby Hub route, what it
reads, and what the mobile app does with it. It is the forensic map the
convergence started from (RH-M0) and the record of where it ended.

**Statuses**

| Status | Meaning |
|---|---|
| NATIVE PARITY | The same destination exists natively, reads through the same shared reader, and shows the same content, relationships and sources. |
| SHARED-CONVERGED | The logic was moved into `packages/contracts` and both clients now run the same code. |
| INTENTIONAL EXTERNAL HANDOFF | The app deliberately opens something outside itself (the system browser, Mail, the phone dialler). |
| NOT APPLICABLE | A web mechanism that has no native equivalent and needs none. |
| BLOCKED | Could not be completed in this pass, with the reason. |

## The shared layer (RH-M1) — SHARED-CONVERGED

31 modules moved from `lib/app-context/*` and `components/rugby-hub/nav/hub-nav-groups.ts`
into `packages/contracts/src/rugby-hub/`, unchanged. Each web path is now a
re-export shim (`export * from "@ovalball/contracts/rugby-hub/<module>"`, with
`import "server-only"` kept where it was). Nothing on the web changed its
imports; `supabase/tests/js/mobile_rugby_hub.test.mts` fails if a shim grows an
implementation again.

| Module | Holds |
|---|---|
| `rugby-hub-data` | team options, audience, identity context, Rules / Rules-of-Play / Safeguarding / Welfare readers (own-team and by-identity), source metadata, officer projections |
| `team-choice` | whose Rugby Hub: the one context-aware team rule both clients apply, and the website's per-context cookie shape (RH-M0.2) |
| `rugby-hub-format` | section labels, value formatting, obligation labels, pitch grouping |
| `rugby-hub-search` | `searchRugbyHub` over the one `search_hub_content` RPC, with type labels and canonical hrefs |
| `ia` | `HUB_GROUPS`, `HUB_START_HERE`, `findActiveDestination` — the five-group product IA |
| `game-knowledge-*`, `glossary-*`, `officiating-*`, `teams-competitions-*`, `international-*`, `clubs-*`, `people-*`, `development-*`, `coaching-*`, `parents-*`, `position-explorer-*`, `skills-explorer-*`, `heritage-*` | the bundle readers and their types / helpers |
| **`destinations`** (new) | `parseHubHref` / `hubHrefFor`: the canonical web href ↔ a typed `HubDestination`, including `?identity=`, `?code=` and `#section-` |

## Web route → native destination

Mobile routes live under `apps/mobile/app/(tabs)/hub/`. The web address and the
app route deliberately mirror each other (`/rugby-hub/game/x` ↔ `/hub/game/x`).
Every mobile screen reads with the app's own authenticated client through the
shared reader named; RLS and the SECURITY DEFINER RPCs decide what comes back.

| Web route | Domain / data | Shared contract | Native destination | Status | Notes |
|---|---|---|---|---|---|
| `/rugby-hub` | landing; `HUB_GROUPS`, `HUB_START_HERE`; personal strip from team options + identity RPC | `ia`, `rugby-hub-data` | `/hub` | NATIVE PARITY | Canonical app header; search field first; personal strip only when a real team resolves; "Viewing" team switch only with >1 real team (web `TeamSwitcher`). IA is imported, not copied. |
| `/rugby-hub?q=` + header `HubSearch` | `search_hub_content` via `searchRugbyHub`, viewer identity as grouping signal | `rugby-hub-search` | `/hub/search?q=` | NATIVE PARITY | Same RPC, same limit semantics (20 on mobile for thumb scanning), results grouped by type label in rank order; recent searches kept locally, cleared on sign-out. Every result opens through `parseHubHref` → route table. |
| `/rugby-hub/game` | GAME_CONCEPT (13); beginner journey + families; default code from identity | `game-knowledge-data` | `/hub/game` | NATIVE PARITY | Code switch seeded from own code, else Union. |
| `/rugby-hub/game/[conceptKey]` | concept + positions/skills/related/regulatory facts | `game-knowledge-data` | `/hub/game/[conceptKey]` | NATIVE PARITY | Same sections; `how-a-game-flows` carries the native `GameFlow` (same seven nodes, vertical). |
| `/rugby-hub/rules` (+ `?identity=`, `#section-`) | `get_rugby_hub_rules` / `_by_identity`, `get_rugby_hub_rules_of_play` / `_by_identity`, `resolve_public_source_metadata` | `rugby-hub-data`, `rugby-hub-format`, `team-choice` | `/hub/rules` (+ `identity`, `section` params) | NATIVE PARITY | Two layers (General Laws, then the age grade's Rules of Play grouped by the register's categories), own-team and browse modes, three notice tones, tier badge, competition overlay, Pitch merge, obligation badge, official source link, section/category scroll. RH-M0.2. |
| `/rugby-hub/officiating` | OFFICIATING_CONCEPT (20) by family | `officiating-data` | `/hub/officiating` | NATIVE PARITY | |
| `/rugby-hub/officiating/[contentKey]` | concept + signalled / misunderstanding callouts | `officiating-data` | `/hub/officiating/[contentKey]` | NATIVE PARITY | |
| `/rugby-hub/positions` → `[code]` | redirect to own code | `rugby-hub-data` | `/hub/positions` (+ `code`) | NATIVE PARITY | Own code, else Union; "Based on … / You're exploring …" line. |
| `/rugby-hub/positions/[code]` | `get_position_explorer` bundle with identity only when own code maps directly | `position-explorer-data` | `/hub/positions?code=` | NATIVE PARITY | Native SVG pitch with a real button per position (anchors from data), grouped list, code-level age-stage banner. |
| `/rugby-hub/positions/[code]/[positionKey]` | position detail | `position-explorer-data` | `/hub/positions/[code]/[positionKey]` | NATIVE PARITY | Same sections; "What makes a good X" card; related positions. |
| `/rugby-hub/glossary` | 38 terms; A–Z + code filter in memory | `glossary-data` | `/hub/glossary` | NATIVE PARITY | Letter rail scrolls within the list; dimmed letters are not targets. |
| `/rugby-hub/glossary/[termKey]` | definition + aliases + Read more + relationships + rule | `glossary-data` | `/hub/glossary/[termKey]` | NATIVE PARITY | |
| `/rugby-hub/skills` | `get_skills_explorer` with viewer identity (contact gate) | `skills-explorer-data` | `/hub/skills` | NATIVE PARITY | |
| `/rugby-hub/skills/[skillKey]` | skill detail; superseded redirect | `skills-explorer-data`, `-types` | `/hub/skills/[skillKey]` | NATIVE PARITY | Technique steps, contact gate note, positions, related (Learn first), Develop This Further, Coaching This Skill, sources. Superseded key → `router.replace` to successor. |
| `/rugby-hub/development` (+ `?code=`) | PLAYER_DEVELOPMENT_CONCEPT (19) | `development-data` | `/hub/development` | NATIVE PARITY | Journey with Start Here, "What Should I Work On?", family sections, governing-body-sourced line only when true. |
| `/rugby-hub/development/[conceptKey]` | concept + facts + skills + positions + related + sources | `development-data` | `/hub/development/[conceptKey]` | NATIVE PARITY | |
| `/rugby-hub/coaching` (+ `?code=`) | COACHING_CONCEPT (27); intents | `coaching-data` | `/hub/coaching` | NATIVE PARITY | "I Want To…" shortcuts are links, nothing remembered. |
| `/rugby-hub/coaching/[conceptKey]` | concept + facts + chips by kind + sources | `coaching-data` | `/hub/coaching/[conceptKey]` | NATIVE PARITY | |
| `/rugby-hub/story` | heritage eras + 42 entries; code filter | `heritage-data` | `/hub/story` | NATIVE PARITY | Era markers, code and certainty badges; filter never splits the shared root. |
| `/rugby-hub/story/[entryKey]` | entry + sources (per-entry read) + relatives + prev/next | `heritage-data` | `/hub/story/[entryKey]` | NATIVE PARITY | Myth/legend warning beside the title; sources with tier, publisher, supports. |
| `/rugby-hub/competitions` (+ `?code=`) | COMPETITION_GUIDE (25) | `teams-competitions-data` | `/hub/competitions` | NATIVE PARITY | Explainers first, named competitions second. |
| `/rugby-hub/competitions/[contentKey]` | guide + editorial source + glossary/related/history | `teams-competitions-data` | `/hub/competitions/[contentKey]` | NATIVE PARITY | |
| `/rugby-hub/international` (+ `?code=`) | RUGBY_TEAM national/representative + competitions | `international-data` | `/hub/international` | NATIVE PARITY | |
| `/rugby-hub/international/teams/[teamKey]` | team + honours (59 rows across teams) + competitions + history | `international-data` | `/hub/international/teams/[teamKey]` | NATIVE PARITY | Team type and gender as text badges; no crest, no squad. |
| `/rugby-hub/clubs` (+ `?code=`) | RUGBY_TEAM club (curated) | `clubs-data` | `/hub/clubs` | NATIVE PARITY | |
| `/rugby-hub/clubs/[clubKey]` | club + honours + people + related + history + sources | `clubs-data` | `/hub/clubs/[clubKey]` | NATIVE PARITY | No crest is shown (none is registered for a famous club; a kit is never used as one). |
| `/rugby-hub/people` | RUGBY_PERSON (14) by role | `people-data` | `/hub/people` | NATIVE PARITY | |
| `/rugby-hub/people/[personKey]` | person + teams + honours + related + history + sources | `people-data` | `/hub/people/[personKey]` | NATIVE PARITY | Role badges; team links open the international team screen. |
| `/rugby-hub/parents` | PARENT_GUIDE (25); journey; intents; authority links | `parents-data` | `/hub/parents` | NATIVE PARITY | |
| `/rugby-hub/parents/[guideKey]` | guide + facts + chips by kind + sources | `parents-data` | `/hub/parents/[guideKey]` | NATIVE PARITY | Welfare & Safety guides carry the official-guidance callout. |
| `/rugby-hub/player-welfare` (+ `?code=`, `?identity=`, `#section-`) | `get_rugby_hub_welfare` / `_by_identity`, audience-aware | `rugby-hub-data`, `rugby-hub-format` | `/hub/player-welfare` | NATIVE PARITY | Obligation badges; own-team and browse modes. |
| `/rugby-hub/safeguarding` (+ browse params) | `get_rugby_hub_safeguarding_content` / `_routes` / `_by_identity`; officer projections via RLS | `rugby-hub-data`, `rugby-hub-format` | `/hub/safeguarding` | NATIVE PARITY | Three separate blocks as on the web. **Public guidance and a contact only** — no concern, case or report is read or written. |
| `/rugby-hub/safeguarding/contact` | `start_or_get_safeguarding_officer_conversation` (OVALBALL) / registered email (EMAIL) | — (existing RPC, unchanged) | `/hub/safeguarding/contact` | NATIVE PARITY | Confirmation only after sending, exactly as the web. Neither client's inbox model lists safeguarding-officer conversations (documented risk below). |
| Reporting route `mailto:` / `tel:` / `url` | governing-body contacts | — | system Mail / dialler / browser | INTENTIONAL EXTERNAL HANDOFF | The contact is the governing body's, never Ovalball's. |
| Official source links (`canonical_url`), editorial sources, heritage sources | registered source metadata | `rugby-hub-data` | system browser | INTENTIONAL EXTERNAL HANDOFF | Never an embedded browser. |
| `/legal/safeguarding` footer link | website legal page | — | system browser | INTENTIONAL EXTERNAL HANDOFF | Website-owned page. |
| `HubNav` (web secondary navigation) | — | `ia` | — | NOT APPLICABLE | The phone has the tab bar and the landing; a Hub screen's bar carries Back, its section and Search. |
| `RUGBY_HUB_TEAM_COOKIE` / `setRugbyHubTeam` server action | team preference | `rugby-hub-data` | per-context AsyncStorage preference, `src/hub/team-resolution.ts`, `HubIdentityProvider` | SHARED-CONVERGED | Same options and server validation; the app adds "the selected context leads" and keys the remembered choice per context (RH-M0.1). Cleared on sign-out. |
| `generateMetadata` / `<title>` | page metadata | — | — | NOT APPLICABLE | |

## Deep links

`apps/mobile/src/links/intents.ts` resolves any `/rugby-hub…` URL (custom
scheme, Expo Go, https) into `{ kind: "RUGBY_HUB", destination }` using the
shared parser, and `src/hub/route-table.ts` maps the destination to a screen.
An address the vocabulary does not know resolves to **nothing** (never a
plausible guess); it is reported by the intent, and the only case that leaves
the app is a related-content href of that shape, which opens on the website in
the system browser. No such href exists in the current content.

## What was deliberately not built

- No WebView, no duplicate content store, no hard-coded article text, no
  mobile-only law. Every screen reads the database through the shared reader.
- No child/team selector beyond the viewer's own real team relationships (the
  web's own `TeamSwitcher` rule).
- No safeguarding operational data. The Hub reads guidance, routes and the
  club's registered officer contact, and calls the existing conversation RPC.
- No new migration. Every RPC and every RLS policy used already existed.

## Documented risks (outside this pass)

- **Safeguarding-officer conversations are not listed by either client's
  inbox model** (`messenger-view-model` knows request / fixture / club /
  support / announcement / direct). The web contact form confirms and stops;
  the app does the same. Surfacing the thread in Messages is a messaging-slice
  decision, not a Hub one.
- The recommended-content RPC (`get_hub_recommended_content`) is not consumed
  by any web page today and is therefore not consumed by the app either.


## CA-M6 — verified against HEAD, and the experience layer

**Verification (2026-09-24).** Every web Rugby Hub page under `app/(app)/rugby-hub/**` (33 pages:
landing, 16 sections, their details, positions by code, safeguarding contact) has the native
destination listed above, reading through the same shared reader; no web route was added since the
map was written and none lacks a native screen (`supabase/tests/js/mobile_rugby_hub.test.mts` pins the
vocabulary ↔ screen mapping). Canonical content at HEAD: GAME_CONCEPT 13, OFFICIATING_CONCEPT 20,
COACHING_CONCEPT 27 (+ 2 COACHING_GUIDANCE), PLAYER_DEVELOPMENT_CONCEPT 19, PARENT_GUIDE 25,
COMPETITION_GUIDE 25, RUGBY_TEAM 25, RUGBY_PERSON 14, glossary 38 terms (18 term relationships, 68
content links), positions 28, skills 12, team honours 59, person–team 21, person–honour 3, content
relationships 215 (RELATED_KNOWLEDGE 193, CONCEPT_RELATED 22), sources 133, heritage links 23,
regulatory facts 167 (82 Hub references). Search is the one `search_hub_content` RPC across content
items, positions, skills, glossary, verified rules and heritage. **Parity totals: 33 NATIVE PARITY,
2 SHARED-CONVERGED, 3 INTENTIONAL EXTERNAL HANDOFF, 2 NOT APPLICABLE, 0 BLOCKED.**

**The experience layer (added, both clients' data, one projection).**

| Capability | Where it comes from | Native surface | Visual experience |
|---|---|---|---|
| Related content | `packages/contracts/src/rugby-hub/related.ts` — one typed projection over the bundles' own relationship maps; type derived from the canonical href, never the title; deduped by href | `HubExploreNext` rail and `HubKeepExploring` foot on every detail screen | — |
| Quick Check | `quick-check.ts` — deterministic derivation from canonical fields (definition / summary + same-family siblings, stable hash, no randomness) | game, glossary, coaching, development, parent details | — |
| What Would You Call? | `quick-check.ts` `officiatingCall` — scenario = the concept's own "what happens", options = same-family concepts, explanation = how it is signalled, the misunderstanding, the referenced laws | officiating DECISIONS_AND_SIGNALS details | TACTICAL / SPATIAL ILLUSTRATION (`scene-offside`, `scene-knock-on`, `scene-cards`) |
| Show Me / See It | `apps/mobile/src/hub/visuals/manifest.ts` — hotspots and steps that reference canonical entities only; labels and explanations read at render time (`hub_visual_manifest.test.mts`) | game, officiating, coaching, parent details (Show Me); glossary terms (See It) | CONCEPT ILLUSTRATION per `RUGBY_HUB_VISUAL_ASSET_MANIFEST.md` |
| Step-through | manifest `steps` (tackle → ruck → decision; arrive → meet → warm up → play → after) | the same explainer | INTERACTIVE EXPLAINER BACKDROP |
| The pitch | `apps/mobile/src/hub/pitch-explainer.tsx` — native vector pitch with standard union markings; tappable areas open canonical glossary terms | `the-pitch-and-direction-of-play` | ATMOSPHERIC SECTION ART behind the vector |
| Section heroes | `SECTION_HEROES` | landing and the five groups | EDITORIAL HERO / ATMOSPHERIC SECTION ART |
| From the Story of Rugby | the heritage bundle (a real entry, chosen by day) | landing | — |

**Visual-experience decisions by domain:** Game Knowledge — CONCEPT ILLUSTRATION for the spatial
concepts (ruck/breakdown, scrum, lineout, play-the-ball, penalties/advantage, scoring, the pitch);
NO GENERATED VISUAL for the objective, possession/territory, moving the ball, how play restarts,
tackle count (text and relationships carry them). Officiating — scenario illustrations for offside,
knock-on/forward pass, cards, the referee; none for the respect, communication and becoming-a-referee
concepts. Coaching — spatial illustrations for breakdown decisions, space/time/numbers, contact
safety, tackle-count decisions; none for approach, communication, inclusion and reflection concepts.
Parents — match day (step-through) and what a new player needs (object visual); none for the other
guides. Glossary — See It for ruck, maul, scrum, lineout, breakdown only. Rules & Laws, Player
Development, Welfare & Support, competitions, teams, clubs, people, story — NO GENERATED VISUAL
(trust, identity and canonical-media surfaces; generated atmosphere never stands in for a real crest,
portrait or event).

**Visual assets, as banked:** 24 approved Higgsfield generations (Nano Banana Pro) in
`apps/mobile/assets/hub/`, 40 generated and 16 rejected by eye; hotspot coordinates corrected against
the approved images and alt text rewritten to describe them. Proof: `hub_visual_manifest.test.mts`,
the CA-M6 browser walk (landing, search, every domain detail, See It with the picture and its "In
words" equivalent, What Would You Call?, the vector pitch) on the served web export, and the iOS
export carrying every image and label. Physical-iPhone review of the explainers is owed
(`HARDENING_RELEASE_READINESS_LEDGER.md` H23).
