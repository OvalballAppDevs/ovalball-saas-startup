# RH-M0.1 — Rugby Hub age-grade / code-aware content: forensic report

**Owner observation:** "the rules/information changes as per age grade" — and the
mobile Hub did not appear to change appropriately when the selected team changed.

**Verdict in one line:** the observation was correct for one real mobile defect
(the Hub's remembered team outlived a context switch) and, underneath it, exposed
a platform truth that holds on the website too: the **Rules** page presents
general Law for every Rugby Union age grade, because the per-age-grade Rules of
Play exist canonically as facts but are in no published content set. Mobile is
corrected and banked; the platform gap is reported, not patched around.

## 1. Was the owner's observation correct?

Yes, in two parts.

- **Mobile defect (fixed).** The Hub remembered a "Viewing" team choice under one
  global key, so a choice made once outlived every later child/team switch in the
  header. A parent who switched from Ava to Ben in the header could keep seeing
  Ava's rules. Stale rows from the previous team could also remain on screen while
  the next team's rows loaded.
- **Platform content truth (not a mobile defect).** For every Rugby Union age
  grade the Rules page — on the website and therefore on mobile — presents the
  same 20 general-law facts. The substantive per-age-grade content the owner
  expects (Regulation 15 Rules of Play: pitch size, ball size, player numbers,
  scrum and lineout configuration, kicking, restarts, substitutions, contact
  progression, half lengths) is modelled canonically but not presented there.

## 2. Exact root cause

**Mobile.** `HubIdentityProvider` read the remembered team from the single key
`ovalball.rugby-hub.team` and let it take precedence over the selected context.
Contextual screens kept their previous `result` until the next read finished.

**Platform.** `internal.resolve_age_grade_rule_bundle(code, identity)` builds the
Rules page from `regulatory_content_sets` (topic RULES): the general Tier-2 set
plus a Tier-1 set for the identity when one exists. Published RULES sets today:

| Code | Identity | Facts |
|---|---|---|
| union | (general) | 20 |
| league | (general) | 13 |
| league | RFL-GIRLS-U12 | 5 (Tier-1) |

So every RFU identity resolves to the same 20 facts, 0 Tier-1. Meanwhile
`regulatory_fact_applicability` attaches VERIFIED Reg 15 facts per identity —
45 for RFU-U7/U8/U9, 46 for RFU-U12, 40 for RFU-U15 — of which 25–26 per
identity are in **no** content set and therefore reach no page. Search finds
them (RULE results) but `internal.regulatory_fact_primary_occurrence` gives an
unplaced fact no destination (occurrence_count 0), so it cannot route to them.

## 3–6. Which domains are universal, code-aware, age-grade-aware, both

Determined from the shared readers' signatures and the RPCs they call, not from
the screens.

| Domain | Universal | Code-aware | Age-grade-aware | Canonical field / relationship | Web resolver | Mobile resolver (now) |
|---|---|---|---|---|---|---|
| Game Knowledge | rows universal | rows carry `rugby_code` (presentation filter; both codes always visible) | no | `hub_content_items.rugby_code`; facts via `hub_regulatory_fact_references` (not identity-scoped) | `getGameKnowledgeBundle(supabase)` | same reader; cached `game` |
| Glossary | yes | `hub_glossary_terms.rugby_code` filter | no | as above | `getGlossaryBundle` | same; cached `glossary` |
| Officiating | yes | `rugby_code` badge | no | as above | `getOfficiatingBundle` | same |
| Teams & Competitions | yes | `rugby_code` filter | no | — | `getCompetitionBundle` | same |
| International | yes | `rugby_code` filter | no | — | `getInternationalBundle` | same |
| Famous Clubs | yes | `rugby_code` filter | no | — | `getClubsBundle` | same |
| People / Legends | yes | no | no | — | `getPeopleBundle` | same |
| Player Development | yes | `rugby_code` filter | no | facts via references, not identity | `getDevelopmentBundle` | same |
| Coaching Knowledge | yes | `rugby_code` filter | no | as above | `getCoachingBundle` | same |
| Parents & Guardians | yes | `rugby_code` (rare) | no | as above | `getParentsBundle` | same |
| Story of Rugby | yes | `code_scope` filter | no | — | `getHeritageTimeline` | same |
| **Positions** | pitch per code | **yes** (`hub_positions.rugby_code`) | **yes** — age stage only | `hub_position_age_stage(regulatory_identity_id)`: NOT_APPLICABLE for RFU-U6/U7/U8 & RFL-PRIMARY, EMERGING for RFU-U9/U10 & RFL-U12, else UNASSESSED | `getPositionExplorerBundle(code, regulatoryIdentityId)` with identity only when own code maps DIRECT/DERIVED | same reader; cache key `positions:<code>:<identity>` |
| **Skills** | rows universal | badge | **yes** — contact gate | `get_hub_regulatory_fact_applies('RFU-REG15-2026-CONTACT-NOT-PERMITTED-U7-U8', identity)` → RFU-U7, RFU-U8 | `getSkillsExplorerBundle(regulatoryIdentityId)` | same; cache key `skills:<identity>` |
| **Rules & Laws** | — | **yes** (general set per code) | **yes in model, no in Union content** — Tier-1 sets only for RFL-GIRLS-U12 | `regulatory_content_sets` + `internal.resolve_age_grade_rule_bundle` | `get_rugby_hub_rules(team)` / `_by_identity(key)` | same RPCs, per team, uncached, reset on switch |
| **Player Welfare** | — | **yes** | identity passed; only RFU-PREM-CHAMP-PWR has its own set; **audience-aware** (GENERAL/PARENT/PLAYER) | `resolve_player_welfare_content_bundle(code, date, identity, audience)` | `get_rugby_hub_welfare(team, audience)` | same |
| **Safeguarding** | — | **yes** (league set only today) | identity optional; **audience-aware** | `resolve_safeguarding_content_bundle` / `_reporting_routes` | `get_rugby_hub_safeguarding_content/routes(team)` | same |

## 7. Exact canonical age-grade resolver

`internal.regulatory_context_for_team(p_team_id)` → authorises the viewer
(`team.team.view` or an active player/guardian relationship on the team), then
joins `teams.canonical_team_type_id` + `teams.rugby_code` to
`regulatory_identities(ovalball_canonical_team_type_id, rugby_code)` and returns
`(rugby_code, regulatory_identity_id, mapping_type)`. Exposed as
`get_rugby_hub_identity_context(p_team_id)`. **No name is parsed anywhere**; the
test `no Hub file reads an age grade out of a team's name` now guards that on
mobile and in the shared resolver.

## 8. Exact canonical code resolver

`teams.rugby_code`, read by the same function; the identity join carries the
code so a shape that exists in both registers resolves to the right one.

## 9. Did the web have a defect?

Two findings, reported for owner decision and not changed in this pass.
**Both were closed by RH-M0.2** (see `RUGBY_HUB_RULES_OF_PLAY.md`): the web now
resolves the Hub team from the app-wide selected context through the shared
rule, and every applicable Rules-of-Play fact has a page and a section.

- **W1 — the web Hub does not follow the app-wide selected context.** The Hub
  team comes only from its own `rugby_hub_team_id` cookie, else the first real
  option; the sidebar's child/team switch does not move it. A parent must use
  the Hub's own "Viewing" dropdown. Mobile now follows the selected context and
  keys its remembered choice per context; aligning the web would mean scoping
  its cookie the same way.
- **W2 — search can surface an age-grade Rules-of-Play fact that no page can
  show.** RULE results resolve destinations through
  `regulatory_fact_primary_occurrence`; unplaced facts get none.

And the platform content gap (§2), which is neither client's defect.

## 10. Did mobile have a defect?

Yes — the two in §2, plus no visible statement of whose rugby a contextual screen
was answering for. Fixed:

- `src/hub/team-resolution.ts`: the selected context leads; remembered choice is
  per context (`ovalball.rugby-hub.team:<contextKey>`) and falls through when it is
  no longer a real option; club context → first of that club's teams, said as
  such; "All Children" → first option, said as such.
- Rules / Player Welfare / Safeguarding reset their result the moment the scope
  (team, browse identity, audience) changes.
- `HubContextLine`: "Rules for Ben Whitaker's Under 8 Mixed · Rugby Union" on
  Rules, Player Welfare, Safeguarding and Skills; nothing on universal screens.
- Sign-out clears every per-context remembered choice.

## 11. Cache-key result

`positions:<code>:<regulatoryIdentityId>` and `skills:<regulatoryIdentityId>`
name every dimension those bundles vary on; Rules, Welfare and Safeguarding are
not cached. The eleven universal bundles are keyed by domain because their
shared readers take no identity — the test asserts that on the readers'
signatures, so a reader that later grows an identity parameter fails the suite
until its key does too. Measured: switching U8 → U12 changed the positions
banner (NOT_APPLICABLE → none) and the skill gate (on → off) on mobile exactly as
on the web.

## 12. Parent multi-child result

uat.guardian.two (Ava — Under 12 Boys, RFU-U12; Ben — Under 8 Mixed, RFU-U8):

| Signal | Web (Ava) | Mobile (Ava) | Web (Ben) | Mobile (Ben) |
|---|---|---|---|---|
| Rules cards / tiers | 20 / General Law ×20 | all 20 present / ×20 | 20 / ×20 | all 20 / ×20 |
| Positions banner | none | none | NOT_APPLICABLE | NOT_APPLICABLE |
| Tackling: gate / steps | off / shown | off / shown | on / hidden | on / hidden |
| Welfare cards | 1 | 1 present | 1 | 1 present |
| Context line | — | "Rules for Ava Whitaker's Under 12 Boys · Rugby Union" | — | "…Ben Whitaker's Under 8 Mixed · Rugby Union" |

Live switch on the Rules screen: Ava → Ben changed the line and the payload;
no stale rows. "All Children" lands on the first option with the switch shown.

## 13. Coach multi-team result

uat.coach (Club Admin at the UAT club; the club's teams as options, chosen
through the Hub's Viewing switch, as the web's TeamSwitcher):

| Signal | Web U7 | Mobile U7 | Web U12 | Mobile U12 |
|---|---|---|---|---|
| Rules | 20 / ×20 | all 20 / ×20 | 20 / ×20 | all 20 / ×20 |
| Positions banner | NOT_APPLICABLE | NOT_APPLICABLE | none | none |
| Tackling gate / steps | on / hidden | on / hidden | off / shown | off / shown |
| Welfare | 1 | 1 | 1 | 1 |

A coach standing in a **team** context gets that team by rule (unit-tested);
the review world's coach persona holds a club-wide context only.

## 14. Rules & Laws comparison examples

- RFU-U8 vs RFU-U12: identical 20 general-law facts on both clients (canonical:
  no Tier-1 set). Differences that DO exist canonically but are unplaced: ball
  size, pitch length/width, player count, scrum configuration, kicking, restart,
  substitution, contact progression, half/day minutes, match-stop rule, half-game
  rule, mixed rugby ending at U12, league rugby from U15 (26 facts for U12).
- RFL-GIRLS-U12 (browse `?identity=`): 17 cards on both clients — 13 General Law
  + 4 "Your Age Grade's Variation" (5 Tier-1 facts, pitch length + width merged
  into one Pitch card), banner "Showing rules for RFL Girls Rugby League, Under 12
  (Rugby League)".

## 15. Tests / proof

- `mobile_rugby_hub.test.mts` 18/18 (7 new: selected-context rule, coach
  multi-team, club/family fallback, per-context remembered choice, no
  name-parsing, cache-key dimensions incl. universal-reader signatures,
  reset-on-switch + context line placement). `mobile_recovery`,
  `participant_routing`, `shared_contracts` green.
- Mobile typecheck clean; web unchanged (no shared-contract change).
- Playwright web-vs-mobile matrix (`scratchpad/hub/matrix/matrix.json`,
  screenshots): 4 team contexts × 4 signals + Tier-1 browse + live switch, all
  agreeing.
- iOS export succeeded.

## 16. Remaining domain-content gap (platform work required)

**Closed by RH-M0.2**, which took option 1 below: `internal.resolve_age_grade_rules_of_play`
with `get_rugby_hub_rules_of_play` / `_by_identity`, an applicability path in
`regulatory_fact_primary_occurrence`, and a search vector that indexes a
measured fact. The two adult teams remain unmapped (a Team Directory matter,
not a Hub one) and union still has no published SAFEGUARDING set.

**Age-grade Rules of Play are not presented.** Two honest options, both platform
work (a migration), neither started here:

1. **Present applicability facts on the Rules page.** A read RPC (or an extension
   of `resolve_age_grade_rule_bundle`) returning the VERIFIED facts applicable to
   the team's regulatory identity that sit in no content set, as a "Rules of Play
   for your age grade" block with its own sources — and a destination for them in
   `regulatory_fact_primary_occurrence` so search can land. `regulatory_facts` has
   no public RLS, so this needs a SECURITY DEFINER RPC: a migration.
2. **Publish Tier-1 RULES content sets per RFU identity** from the existing
   appendix facts (editorial work through the regulatory admin RPCs). The
   resolver already merges them; no code change.

Also noted: the review world's adult teams (Men's 1st, Women's 1st) have no
`canonical_team_type_id` mapping, so they resolve to "not yet mapped" on both
clients; and Rugby Union has no published SAFEGUARDING set, so Safeguarding
shows "being reviewed" for every union team on both clients.
