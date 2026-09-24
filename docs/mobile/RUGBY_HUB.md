# Rugby Hub on mobile

The whole web Rugby Hub, natively, as another client of the same platform.
This is the how; `RUGBY_HUB_PARITY_MAP.md` is the route-by-route what.

## The shape

```
packages/contracts/src/rugby-hub/      the one Rugby Hub: readers, types, IA, search, destinations
lib/app-context/<module>.ts            web shims (export * from the package; server-only kept)
components/rugby-hub/nav/hub-nav-groups.ts   web shim for the IA

apps/mobile/app/(tabs)/hub/            34 route files: landing, search, 16 sections + details
apps/mobile/src/hub/
  identity.tsx      whose team the personal parts are about (HubIdentityProvider / useHubIdentity)
  bundles.ts        one hook per shared reader, with the app's authenticated client
  cache.ts          in-memory bundle cache: stale-while-revalidate, cleared on sign-out
  route-table.ts    HubDestination -> expo-router route (pure; no React Native import)
  routes.ts         openHubHref / openExternal (the only place a Hub href is opened)
  ui.tsx            the Hub's furniture: hero, rows, chips, badges, callouts, notices, facts, sources
  screen.tsx        the inner-screen shell: Back · section · Search, one scroll, safe insets
  team.tsx          the "Viewing" team switch (only with more than one real team)
  positions.tsx     the native pitch and the age-stage banner
  game-flow.tsx     the flagship "How a Game Flows" cycle
  heritage.tsx      code and certainty badges for the Story of Rugby
  editorial-source.tsx  "Source: … · Retrieved …" for editorial facts
  recent.ts         recent searches, local only
  experience/       CA-M6: Explore Next rail, Keep Exploring foot, Quick Check, What Would You Call?,
                    explanations resolver, landing order and story-of-the-day (all over the shared
                    projections in packages/contracts/src/rugby-hub/related.ts and quick-check.ts)
  visuals/          CA-M6: the visual manifest (hotspots and steps that name canonical entities only),
                    the app-owned asset keys, HubVisualExplainer, Show Me / See It
  pitch-explainer.tsx  CA-M6: native vector pitch, regions open canonical glossary terms
```

## The rules it keeps

**One content store.** Every screen calls the same contracts reader the
matching web page calls, with the app's own Supabase client, so RLS and the
SECURITY DEFINER RPCs decide what comes back. There is no article text in the
app, no mobile-only law, no second search index, and the only cache is memory
for the life of the process.

**One IA.** The landing renders `HUB_GROUPS` and `HUB_START_HERE` from the
package. A destination added on the web appears in the app on the next build.

**One address.** Related-content chips, search results and deep links all
carry the canonical web href; `parseHubHref` (shared) makes it a typed
destination and `route-table.ts` makes that a screen. `?identity=`, `?code=`
and `#section-` are browsing state and travel as params; nothing in a link is
authority, and every screen re-derives what the viewer may see.

**One identity rule, shared by both clients** (`packages/contracts/src/rugby-hub/team-choice.ts`;
corrected in RH-M0.1, moved into the shared package and adopted by the web in
RH-M0.2). `HubIdentityProvider` (app) and `app/(app)/rugby-hub/active-team.ts`
(web) resolve "whose Rugby Hub" from the viewer's real team options (the shared
`getRugbyHubTeamOptions`) and the app-wide selected context: a choice
remembered for THIS selected context if it is still an option, else the team
the selected context is (parent / player / team, or the first of a club's
teams), else the first option — the "All Children" case. The remembered choice
is keyed per context (an AsyncStorage key per context on the phone; one cookie
whose value names the context on the web), so switching child or team in the
header — or the website's context switcher — always moves the Hub with it.
`get_rugby_hub_identity_context` then gives the code and regulatory identity;
no screen reads an age grade from a name. Choosing a team grants nothing.

**Rules are two layers from one register** (RH-M0.2). The Rules screen shows
the General Laws every age grade shares (`get_rugby_hub_rules`, a published
content set) and then the governing body's own Rules of Play for this age grade
(`get_rugby_hub_rules_of_play`, the VERIFIED facts attached to the team's
regulatory identity through `regulatory_fact_applicability`), grouped by the
register's categories in the one shared order (`RULES_OF_PLAY_CATEGORIES`).
The website renders the same two layers from the same readers; neither client
carries a rules list, a category list of its own, or an age number. See
`RUGBY_HUB_RULES_OF_PLAY.md`.

**What varies, canonically.** Rules, Safeguarding and Player Welfare are read
per team (code + regulatory identity + audience) and are never cached; the
Position Explorer's age stage and the Skills Explorer's contact gate are per
regulatory identity and their cache keys name it (`src/hub/cache-keys.ts`).
Everything else — Game Knowledge, Glossary, Officiating, Development,
Coaching, Parents, Story, Competitions, International, Clubs, People — is one
bundle for everybody because its shared reader takes no identity, exactly as
on the web. Contextual screens carry a "for Under 8 Mixed · Rugby Union"
line; universal screens carry none. See `RUGBY_HUB_AGE_GRADE_REPORT.md` for
the forensic result, including the platform gap this pass found.

**Same UI, different payload.** Rules, Safeguarding and Player Welfare answer
for the chosen team and the viewer's audience (a guardian reads the parent
wording). The Position Explorer's age-stage banner and the Skills Explorer's
contact gate are the governing body's answer for that identity. No screen is
branched on a role.

**Public only.** Safeguarding shows published guidance, official reporting
routes and the club's registered officer contact, and calls the existing
`start_or_get_safeguarding_officer_conversation` RPC. Nothing operational is
read or written.

## States

Every screen has loading (skeleton rows), failure (the app's error card with
retry where retrying can help), empty (a real answer, never an error), and
the Hub's three notices: reviewing, no mapping, unavailable. A bundle already
in memory shows instantly and refreshes in the background when old; pull to
refresh re-reads.

## CA-M6 — the experience and visual layer

The Hub already had native parity on every web route (`RUGBY_HUB_PARITY_MAP.md`); CA-M6 added the
layer that makes it a place to learn rather than a set of pages, without a second content system.

- **One related-content projection.** `relatedEntities` in `packages/contracts/src/rugby-hub/related.ts`
  reads the bundles' own relationship maps and returns typed entities whose type is derived from the
  canonical href, never guessed from a title. `HubExploreNext` shows the spread across types at the
  top of a detail; `HubKeepExploring` shows what the rail did not take at the foot. Every detail screen
  ends with Keep Exploring (`hub_experience.test.mts` pins this structurally).
- **Quick Check and What Would You Call? are derived, not authored.** `quick-check.ts` builds a
  question from the entity's own canonical definition or summary and same-family siblings, ordered by a
  stable hash — no LLM, no randomness, no invented rugby. What Would You Call? uses an officiating
  concept's "what happens" as the scenario, its family as the options and its "how it is signalled",
  common misunderstanding and referenced laws as the reveal.
- **Show Me / See It.** `apps/mobile/src/hub/visuals/manifest.ts` names, per canonical entity, an
  approved scene and hotspots that reference canonical entities only; the label and explanation under
  every hotspot are read from the database at render time, and the "In words" block beneath the picture
  is the textual equivalent. Hotspots are 44 pt buttons; Reduce Motion turns the transitions off.
  Images are app-owned (`apps/mobile/assets/hub/`, 24 files, 5.4 MB) and never canonical media —
  crests, portraits and event photographs keep their own resolvers, and no generated image stands in
  for a real club, person or competition. Provenance, prompts, approvals and rejections:
  `RUGBY_HUB_VISUAL_ASSET_MANIFEST.md`.
- **The landing** is editorial: a hero, search first, Start Here, the five groups with their section
  art in an order that follows the active context (parent/family → Welfare and Learn first; team or
  club staff → Coach and Play first) without ever hiding a group, and a "From the Story of Rugby" card
  chosen by day from the heritage bundle.
- **Boundaries unchanged.** Nothing in the layer carries a Message, Contact, Invite or DM action, no
  safeguarding case data reaches the Hub, and a family context is never required to read.

## Verifying it

- `supabase/tests/js/mobile_rugby_hub.test.mts` — vocabulary round-trips,
  route coverage, deep links, imported IA, shim purity, no WebView / role
  branch / service role, cache is memory only, tab bar unchanged.
- `supabase/tests/js/mobile_recovery.test.mts` — a Hub `#section-` anchor is the
  one fragment passed on, and a fragment on a recovery link is still not a way in.
- `supabase/tests/js/hub_experience.test.mts` — related projection typing and dedupe, deterministic
  Explore Next, Quick Check and What Would You Call? derivations, Keep Exploring on every detail, no
  chance and no messaging actions in the layer, landing order never hides a group.
- `supabase/tests/js/hub_visual_manifest.test.mts` — every hotspot and step in the visual manifest
  names a published canonical entity, asset keys are registered once, no prose lives in the manifest
  beyond alt text, no canonical bucket is referenced from the app-owned assets.
- Headless: `expo export --platform web`, served with single-page fallback,
  session copied from a website sign-in as a UAT persona, walked with
  Playwright through every section as a guardian and as a coach (see the
  banking report for the run).
