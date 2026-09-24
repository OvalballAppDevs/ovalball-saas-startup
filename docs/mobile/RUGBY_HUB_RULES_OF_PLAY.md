# RH-M0.2 — the Rules of Play reach the platform

One canonical read, two clients, the same answer. This records what RH-M0.2
changed and how it was proved. RH-M0.1's forensic report
(`RUGBY_HUB_AGE_GRADE_REPORT.md`) found that both clients agreed with the
canonical Rules bundle — and that the bundle was the same for every RFU age
grade, because the governing bodies' age-grade Rules of Play sat in the
regulatory register unread. This pass reads them, on the platform, for both
clients, and closes the two web findings (W1, W2) that report left open.

## 1. The canonical read

`internal.resolve_age_grade_rules_of_play(p_rugby_code, p_regulatory_identity_id,
p_as_of_date, p_gender_pathway)` (migration `20270538000000`) answers "which
VERIFIED Rules-of-Play facts apply to THIS regulatory identity today":

- `regulatory_fact_applicability` rows for the identity, with no competition
  overlay, and (where a row is pathway-scoped) matching the side's pathway or
  unscoped;
- `regulatory_facts` with `status = VERIFIED`, `topic = RULES`, the same rugby
  code, effective as of the date;
- **not** already presented as a General Law (or Tier-1 variation) through a
  published RULES content set of the same code — a fact is never on the page
  twice, and the migration asserts it across every identity.

Each row carries the fact's category as `section_key` (`fact_type`, with pitch
length, width and the pitch-safety variation folded into `PITCH`), its value
columns, `display_title`, the governing body's note as `body`,
`obligation_level`, its primary citation, and `applies_to_count` (how many
identities of the code share it). Existing shape, existing citation logic:
the CTE is the one `resolve_age_grade_rule_bundle` already uses.

Two public readers mirror the two existing Rules readers and are granted to
`authenticated` and `service_role` only (`regulatory_facts` has no public read
policy; the perimeter manifest lists both):

| reader | authorises by | answers |
|---|---|---|
| `get_rugby_hub_rules_of_play(p_team_id, p_as_of_date)` | `internal.regulatory_context_for_team` — `team.team.view`, or an active player or guardian relationship; 42501 otherwise | the viewer's own team; nothing for `NO_DIRECT_MAPPING` or an unmapped canonical type |
| `get_rugby_hub_rules_of_play_by_identity(p_identity_key)` | signed in | browse mode — the destination a search result lands in |

## 2. Age and code resolution

Nothing new. `teams.canonical_team_type_id` + `teams.rugby_code` →
`regulatory_identities` (`regulatory_context_for_team`), exactly the path
`get_rugby_hub_rules` already walks. No client, contract or SQL added in this
pass names an age grade, a regulatory identity key or a rule's text; the test
suite refuses any of them in the Rules screens, the identity provider, the
format helpers and the team rule.

Canonical applicability, measured (`current_date` = 2026-09-24):

| identity | Rules of Play | of which categories | General Laws |
|---|---|---|---|
| RFU-U6 | 0 (every applicable fact is a World Rugby law) | — | 20 |
| RFU-U7 | 17 | 12 | 20 |
| RFU-U8 | 17 | 12 | 20 |
| RFU-U12 | 18 | 12 | 20 |
| RFU-U15 | 12 | — | 20 |
| RFU-SENIOR-COLTS | 0 | — | 20 |
| RFL-U12 | 2 | 2 | 13 |
| RFL-GIRLS-U12 | 2 (Ball, Match Length) | 2 | 18 (13 general + 5 Tier-1) |
| RFL-OPEN-AGE | 4 | — | 13 |

U7 and U8 share nine of their seventeen; U8 and U12 share nine of theirs. The
two age grades in the review world therefore differ — the RH-M0.1 finding.

## 3. Web changes

- `app/(app)/rugby-hub/rules/page.tsx` — two layers under one title: **General
  Laws** (the existing cards, unchanged) and **Rules of Play for {whose team} ·
  {code}**, grouped by the register's categories through the shared
  `groupRulesOfPlay` / `presentRuleOfPlay` / `presentPitch`, each card with
  the governing body's value or wording, note, obligation badge and source
  link. A context line says whose rules these are; browse mode (`?identity=`)
  shows both layers for that identity under the existing banner. Each category
  is an anchor (`#section-PLAYER_COUNT`); `PITCH` yields to the General Laws'
  own pitch card when both exist so no id repeats.
- `app/(app)/rugby-hub/active-team.ts` — **W1 closed.** One
  `resolveHubTeamForRequest(supabase, ctx)` reads the app-wide selected context
  (`ovalball_ctx`, the same cookie the shell's switcher writes) and applies the
  shared rule; every Rugby Hub page, the layout and the search action use it.
  The Hub's "Viewing" choice is now remembered **per context**
  (`rugby_hub_team_id` = `<contextKey>|<teamId>`, `encodeHubTeamCookie`), so a
  choice made while viewing one child never applies while viewing another.
  The old bare-team-id cookie is not honoured. The cookie-only resolver
  `resolveActiveRugbyHubTeamId` is retired, not left as a second answer.

## 4. Mobile changes

- `apps/mobile/app/(tabs)/hub/rules.tsx` — the same two layers from the same
  readers and helpers, native: `HubHeading` / `HubOverline` groups,
  `HubFactCard` with value, body, obligation and source, the context line, the
  Viewing switch, the browse strip; `?section=` scrolls to a category or a
  General Law section. The reset-on-switch scope still drops every row before
  the next read.
- `apps/mobile/src/hub/team-resolution.ts` — a shim; the rule lives in
  `packages/contracts/src/rugby-hub/team-choice.ts`. `identity.tsx` passes the
  context's club so a club context resolves to that club's team.

## 5. Search changes — W2 closed, and a deeper finding

- `internal.regulatory_fact_primary_occurrence(p_fact_id, p_viewer_identity_id)`
  gains an applicability path after the skill and content-set paths: the Rules
  page of an identity the fact applies to, at the section its category names —
  the viewer's own identity first, else the first by key. The one-argument
  form is dropped (a defaulted second argument replaces it; an overload would
  have made every existing call ambiguous).
- `get_regulatory_fact_search_context(p_fact_ids, p_viewer_identity_id)` —
  both clients pass the viewer's identity, so a fact that applies to several
  age grades resolves to theirs. Titles come from `RULES_OF_PLAY_LABELS` merged
  under `RULES_SECTION_LABELS`.
- **Measured facts were unsearchable** (migration `20270539000000`).
  `regulatory_facts.search_vector` was generated from `value_text` alone; 65 of
  139 verified RULES facts — every rule stated as a number — had an empty
  vector. The generated column now indexes the rule's words (A), its title
  (A), its category in words (B) and the governing body's note (C); the GIN
  index is rebuilt; `search_hub_content`'s RULE snippet falls back to title
  then note. "ball size" now returns the Ball rule; before it returned three
  coaching articles.

No orphan result: the migration and `hub_rules_of_play.sql` assert that every
currently-effective applicable RULES fact has a destination naming an identity
and a section that renders. Three U8 rules (lineout, restart, scrum
configuration) resolve to skill pages by the existing precedence — a skill that
teaches the rule outranks the Rules page — and that is asserted, not hidden.

## 6. Context changes

Web and app now apply one rule (`resolveHubTeam`): the Hub's remembered choice
for THIS context, else the team the context IS (parent / player / team; a club
context → the first of the club's teams), else the first real option. The
website's context switcher and the app's header both move the Hub.

## 7. Proof

- `supabase/tests/hub_rules_of_play.sql` (CANONICAL_GATE, 16/16): two sides of
  one code resolve to two identities and get different answers; no fact is
  both a General Law and a Rule of Play; every row has a category, an
  obligation and a source; code isolation; the guardian reads, the club admin
  reads, a stranger is refused 42501; browse-by-identity answers the same rows;
  anon holds no grant; no orphan search result; a shared fact resolves to the
  viewer's identity; "ball size" finds the viewer's Ball rule.
- `supabase/tests/js/mobile_rugby_hub.test.mts` (25/25): the shared rule and
  its cookie binding; every web Hub page through the one helper; both clients
  on the same readers and category list; no client rules list, age grade or
  identity key; category order, presentation and "no per-half suffix";
  search asks for the viewer's identity.
- `perimeter_manifest.test.mts` (12/12) with the new readers declared;
  `security_perimeter_guard`, `hub_search_and_recommendations`,
  `hub_rules_law_of_the_game`, `regulatory_coverage`, `hub_glossary_explorer`
  green; content, Hub-architecture and Match-Centre guards green; web and
  mobile typecheck clean.
- Browser matrix (`scratchpad/hub/matrix-rop.mjs`, Playwright, 390 px, web dev
  server and the iOS-equivalent web export of the app): for the guardian's two
  children and the unmapped adult player, the canonical count, the web cards
  and the mobile cards agree layer by layer; the context line is identical on
  both clients; browse mode for RFL-GIRLS-U12 and RFU-U7 agrees; a "ball size"
  search lands on the Rules page's Ball section on both clients; switching
  Ava → Ben on both clients changes the page with no stale rows, and the
  website's real desktop dropdown moves the Hub. Results in
  `matrix-rop/matrix.json` and screenshots beside it.
