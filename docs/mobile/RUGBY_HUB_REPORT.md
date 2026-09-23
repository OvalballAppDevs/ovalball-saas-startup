# Rugby Hub — web → native convergence: banking report

**Status: RUGBY HUB MOBILE PRODUCT IMPLEMENTATION COMPLETE — HARDENING / OWNER IPHONE REVIEW PENDING**

Banked locally only. No push, no deploy, no release, no migration, no
migration-history repair.

## The forty

| # | Item | Result |
|---|---|---|
| 1 | Forensic map of every web Hub route, reader, RPC, relationship and link shape | `docs/mobile/RUGBY_HUB_PARITY_MAP.md` |
| 2 | Platform-neutral logic extracted to `packages/contracts/src/rugby-hub/` | 31 modules moved unchanged + `destinations.ts` (new) |
| 3 | Web shims keep every original import path | 29 `lib/app-context` shims + `hub-nav-groups.ts`, each `export *`; guarded by test |
| 4 | Web typecheck after the move | `npx tsc --noEmit` clean |
| 5 | Shared-contracts guard | `shared_contracts.test.mts` 6/6 |
| 6 | Native landing with the five IA groups and Start Here, IA imported | `/hub` (`(tabs)/hub/index.tsx`) |
| 7 | Canonical app header on the landing; Back · section · Search bar on inner screens | `AppHeader` / `HubScreen` |
| 8 | Bottom navigation unchanged (Home · Fixtures · Calendar · Rugby Hub · More) | `tab-projection.ts` untouched; test pins it |
| 9 | Universal search reusing `search_hub_content` through `searchRugbyHub` | `/hub/search`, grouped by type in rank order |
| 10 | Recent searches, local only, cleared on sign-out | `src/hub/recent.ts` |
| 11 | Game Knowledge landing + concept, with the How a Game Flows cycle | NATIVE PARITY |
| 12 | Rules: own-team, browse-by-identity, tiers, overlay, Pitch merge, sources, `#section-` scroll and highlight | NATIVE PARITY |
| 13 | Officiating landing + concept (signalled / misunderstanding callouts) | NATIVE PARITY |
| 14 | Position Explorer: native pitch with a button per position, grouped list, code switch, age-stage banner, detail | NATIVE PARITY |
| 15 | Glossary A–Z with code filter and letter rail; term detail | NATIVE PARITY |
| 16 | Skills landing + detail: technique steps, contact gate from live regulatory data, superseded-key redirect | NATIVE PARITY |
| 17 | Player Development landing + concept | NATIVE PARITY |
| 18 | Coaching Knowledge landing (journey, I Want To…) + concept | NATIVE PARITY |
| 19 | Story of Rugby timeline (eras, code filter, certainty) + entry (sources, relatives, prev/next, myth warning) | NATIVE PARITY |
| 20 | Teams & Competitions landing + guide | NATIVE PARITY |
| 21 | International Rugby landing + team (honours, badges, no crest/squad) | NATIVE PARITY |
| 22 | Famous Clubs landing + club (honours, people, sources; no crest, no kit-as-crest) | NATIVE PARITY |
| 23 | People & Rugby Legends landing + person (roles, teams, honours, sources) | NATIVE PARITY |
| 24 | Parents & Guardians landing (journey, I Need Help With…, authority links) + guide | NATIVE PARITY |
| 25 | Player Welfare, own-team and browse, audience-aware, obligation badges | NATIVE PARITY |
| 26 | Safeguarding: club officer contact, official guidance, official reporting routes — public only | NATIVE PARITY |
| 27 | Safeguarding officer contact: existing RPC (OVALBALL) or registered email (EMAIL); confirmation only, as web | NATIVE PARITY |
| 28 | Relationships / sources / honours drawn by one shared presentation set | `src/hub/ui.tsx` |
| 29 | Every related-content href opens through the one parser + route table | `parseHubHref` → `route-table.ts` |
| 30 | Deep links: `/rugby-hub…` in scheme, Expo Go and https shapes → `RUGBY_HUB` intent → screen; unknown → nothing | `intents.ts`, `destinations.ts`, root layout |
| 31 | Whose team: same resolution rule as the web, seeded from the app context, "Viewing" switch only with >1 real team | `src/hub/identity.tsx`, `team.tsx` |
| 32 | No child-filter authority, no arbitrary child/team selector | options are the viewer's real team relationships only |
| 33 | Caching: memory only, stale-while-revalidate, pull-to-refresh, cleared on sign-out | `src/hub/cache.ts` |
| 34 | Loading / empty / error / three notice tones on every screen | skeletons, `EmptyState`, `ErrorState`, `HubNotice` |
| 35 | Accessibility: every control labelled, 44pt targets, headers announced, badges as text, live count on the glossary | throughout |
| 36 | Forest as feature colour on chalk reading surfaces; typography from the app's tokens | `ui.tsx` |
| 37 | No WebView, no duplicate content store, no hard-coded article, no mobile-only law, no service role, no RLS change, no migration | guarded by `mobile_rugby_hub.test.mts` |
| 38 | Focused suites: `mobile_rugby_hub` 11/11, `mobile_recovery` (fragment guard extended) green, `participant_routing` 21/21, `mobile_tab_projection`, `mobile_welcome` green | node:test |
| 39 | SQL Hub suites against the local database: search & recommendations, content RLS, rules, glossary, game knowledge | 0 errors |
| 40 | Guards: content standard, hub content architecture, availability one-product, match-centre shared | all ok |

## Proof runs

- Mobile typecheck: `npx tsc --noEmit -p apps/mobile/tsconfig.json` clean (typed routes regenerated).
- iOS export: `npx expo export --platform ios` succeeded (15 MB bundle).
- Web export served with single-page fallback; Playwright at 390×844 walked 30
  checkpoints as **uat.guardian.two** (Ben's Under 8 Mixed: contact gate shown,
  age-stage banner shown, rules for U8) and as **uat.coach** (Under 12: technique
  steps shown). 0 console errors, 0 failed requests, every Supabase call through
  RLS or the listed RPCs. Screenshots in the session scratchpad
  (`hub/guardian`, `hub/coach`).

## Explicit confirmations

- Mobile is another client of the platform: every Hub screen reads the same
  contracts reader as the web page it mirrors, with the app's authenticated client.
- No safeguarding operational data is read, written or routed. Public guidance,
  official routes and the club's registered officer contact only.
- No opposition messaging, no U18 messaging route, no new messaging path: the
  contact screen calls the existing RPC and confirms.
- No migration. Default NO MIGRATION held; nothing needed one.
- Protected brand assets untouched. `public/icons/*.png` remain untracked and unmodified.
- Local UAT personas: read only. No persona created, changed or removed.

## Known / documented

- Neither client's inbox lists a safeguarding-officer conversation; the app
  matches the web (confirmation only). A messaging-slice decision.
- `dismissTo` from a cold deep link lands on `/hub` with the article's params
  still in the URL (harmless; the landing ignores them). Same mechanism as
  Calendar and Fixtures.
- The coach persona also holds CLUB_ADMIN at the UAT club in the review world,
  so its first context is the club; this is persona data, not app authority.

## Owner iPhone walkthrough (A–W)

A. Open the app, tap **Rugby Hub**: landing with search, personal strip naming your team, Start Here, five groups.
B. Tap **Viewing** (if you have more than one team) and switch: the strip and Rules follow.
C. Search "scrum": grouped results; tap a Rule result: Rules opens in browse mode with the card highlighted.
D. Start Here → **Game Knowledge**: switch Union/League; open step 1; scroll; Back returns to the list.
E. Open **How a Game Flows**: tap nodes; switch code; "Learn more" opens the concept.
F. **Rules**: your team's laws with General Law / Your Age Grade's Variation badges; tap a source: Safari opens the governing body page.
G. **Officiating**: open a concept with "How it's signalled" and "Common misunderstanding".
H. **Positions**: pitch markers and list; tap #10; related positions chips; switch to the other code (exploring line).
I. **Glossary**: filter Universal / Union / League; tap a letter; open a term; "Read more".
J. **Skills**: open Tackling Technique — steps for a contact age grade, the governing-body note for U6–U8.
K. **Player Development**: Start Here row, What Should I Work On?, open a concept, "What the Law Actually Says".
L. **Coaching Knowledge**: "I Want To…" chips; open a concept; sources with retrieved dates.
M. **The Story of Rugby**: filter League; open an entry; previous/next; sources disclosure.
N. Open a MYTH/LEGEND entry: amber warning beside the title.
O. **Teams & Competitions**: explainers then named competitions; open one; editorial source line.
P. **International Rugby**: national → representative → competitions; open England; honours.
Q. **Famous Clubs**: open a club; Famous People chips open a person.
R. **People**: open a person; Teams Represented opens the team.
S. **Parents & Guardians**: I Need Help With…; open a Welfare & Safety guide: official-guidance callout.
T. **Player Welfare**: obligation badges; pull to refresh.
U. **Safeguarding**: three blocks; Message / Email Safeguarding Officer → contact screen; send (OVALBALL) or Mail (EMAIL).
V. Tap an official reporting route's phone: the dialler opens; its email: Mail opens.
W. From Safari, open `https://<web>/rugby-hub/glossary/advantage` (universal link when configured) or `ovalball://rugby-hub/rules?identity=RFU-U9#section-SCRUM`: the app opens the article; Back lands on the Hub landing.
