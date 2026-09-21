# Convergence Step 15 — functionality accounting

**FUNCTIONS BEFORE 12 · FUNCTIONS AFTER 24 · FUNCTIONALITY LOST 0.**

## Before (Step 14's close, `83c37e0`)

| # | function |
|---|---|
| 1 | A rugby organisation exists as a canonical record (`constituent_bodies`, 35 verified rows) |
| 2 | With verified provenance — source, URL, checked-on date |
| 3 | A club is affiliated to one (`club_directory.constituent_body_id`) |
| 4 | Site Admin maintains that affiliation on the club's record |
| 5 | A person holds a role at an organisation (`constituent_body_roles`, three roles) |
| 6 | Governing authority resolves from that relationship (three fail-closed predicates) |
| 7 | An organisation can be *recorded* as a competition's organiser (`organiser_constituent_body_id`) |
| 8 | Read the organisation, with the viewer's own capabilities (`get_governing_body`) |
| 9 | List my organisations (`my_governing_bodies`) |
| 10 | List an organisation's affiliated clubs (`governing_body_clubs`) |
| 11 | Grant somebody a role (`set_governing_body_role`) |
| 12 | Reach the foundation page from the dashboard (`/governing/[bodyId]`) |

## After

All twelve above, unchanged in meaning, plus:

| # | function | how |
|---|---|---|
| 13 | **A governing body actually organises its competitions** — enter teams, draw, issue, record results | one added disjunct in `internal.can_organise_competition`, reached by all ten competition mutations |
| 14 | **Start a competition as an organisation**, in its own rugby code and the canonical season | `create_governing_body_competition` |
| 15 | **See what the organisation runs**, each with its current edition and real progress | `governing_body_competitions` |
| 16 | **The existing Competition Creator, from the organisation context** | `resolveOrganiserScope` carries the body; `requireEditionOrganiser` accepts it |
| 17 | **See who has access**, with role, state, and when it was given | `governing_body_people` |
| 18 | **Give access by the address on an existing Ovalball account** | `grant_governing_body_role_by_email` |
| 19 | **Take access away**, as a recorded state change and never your own | `revoke_governing_body_role` |
| 20 | **The affiliated clubs as a usable list** — search, location, ground, and the club's own public home | `governing_body_clubs` widened; `/governing/[bodyId]/clubs` |
| 21 | **A workspace home that says what needs doing**, derived from the same reads the pages use | `/governing/[bodyId]` |
| 22 | **The Governing Body is a first-class context** — switcher, identity block, its own navigation | `ActiveContextKind: "governing"` |
| 23 | **Switching in lands in the workspace and carries no club authority** | `use-switch-context`; `activeManageableClubId` refuses every kind but `club` |
| 24 | **The review organisation is reproducible from the canonical script** | `step2-review-club.mjs enrich-governing` |

## Functionality lost: zero, checked item by item

| could have been lost | proof it was not |
|---|---|
| Site Admin organising any competition | `step15_governing_product` **B2**; `competition_authority_matrix` 87/87 |
| A club organising its own competition | **B1**; the club disjunct is asserted present by the migration's own guard |
| The ten competition mutations' single authority chokepoint | **H6** — all ten still route through `require_edition_organiser` |
| Step 14's four RPCs and their refusals | `step14_governing_body` **25/25** |
| `governing_body_clubs`' original five columns | signature widened, never narrowed; Step 14 suite **B6** still passes |
| The dispensation chain's meaning | **H1**; migration guard on `decide_player_dispensation` |
| Club affiliation | **H2**; no Step 15 function writes `club_directory` |
| The five-scope capability engine | **H4**; `capability_decision` untouched |
| The dashboard for club, family and Site Admin contexts | unchanged; only a `governing` active context redirects, and it had no dashboard to lose |
| Step 14's Overview guarantees | suite **83** still 15/15 — two assertions now read the same guarantees at their new location, and say so |

## Two things this step changed rather than added

1. **The Overview was rebuilt.** Step 14's page listed club names and headed its gap "Coming next".
   Step 15's says how many clubs are affiliated and hands over to Clubs, which names them, and states
   the remaining gaps in a sentence. Nothing became unreachable.
2. **A role had two names and now has one.** The sidebar said *Organisation Administrator* while
   People & Access said *Administrator*, for the same row in the same table. Found by the Step 15
   browser journey; resolved to one authority, `lib/governing/roles.ts`, asserted by **D1b**.
