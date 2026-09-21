# Convergence Step 11 — BEFORE/AFTER functionality matrix

Counted at `e1be6af` by reading the route, the component set, the server view
model and the schema — not from memory. A function is a thing the product does
for somebody, counted once wherever it is implemented.

## FUNCTIONS BEFORE: 33

### Match identity and presentation — 16

| # | function | where | state |
|---|---|---|---|
| 1 | one canonical Match Centre route per physical fixture | `app/(app)/fixtures/[fixtureId]/page.tsx` | visible |
| 2 | status shown as one of six narrowed states | `hero.tsx` | visible |
| 3 | kickoff date | `hero.tsx` | visible |
| 4 | kick-off time, `TBC` when unset | `hero.tsx` | visible |
| 5 | meet time, display-only (Fixture Management owns the form) | `hero.tsx` | visible |
| 6 | the home side is named first | Step 7 `fixtureSides` | visible |
| 7 | club crest per side | Step 6 resolver | visible |
| 8 | club kit per side | `match-centre-data.ts` → `KitConfig` | visible |
| 9 | competition identity | `match-centre-data.ts` | visible |
| 10 | cancellation reason | `hero.tsx` | visible |
| 11 | venue name, address lines, postcode | `match-conditions.tsx` | visible |
| 12 | venue coordinates and geocode status | `match-centre-data.ts` | partially surfaced |
| 13 | pitch label | `match-conditions.tsx` | visible |
| 14 | pitch diagram | `pitch-diagram.tsx` | visible |
| 15 | weather forecast, with a calm unavailable state rather than a guess | `match-conditions.tsx` | visible |
| 16 | safe return context back to where the viewer came from | `lib/fixtures/return-context.ts` | visible |

### Availability and participants — 7

| # | function | where | state |
|---|---|---|---|
| 17 | the viewer's own availability answer, per person | `attendance-panel.tsx` | visible |
| 18 | `canRespond` authority with a stated reason when refused | `get_my_attendance_authority` | server-derived |
| 19 | aggregate counts — attending, cannot attend, unsure, awaiting | `participant-list.tsx` | visible |
| 20 | staff-visible participant roster | `participant-list.tsx` | visible, capability-gated |
| 21 | each participant's response | `participant-list.tsx` | visible, capability-gated |
| 22 | avatar state `PHOTO_ALLOWED` / `INITIALS_ONLY`, signed URL, initials fallback | `match-centre-data.ts` | visible |
| 23 | call-up markers — requested, approved, rejected, revoked | `match-centre-data.ts` | visible |

### Conversation and communication — 6

| # | function | where | state |
|---|---|---|---|
| 24 | read the fixture conversation | `messaging-panel.tsx` | visible, gated |
| 25 | post to the fixture conversation | `messaging-panel.tsx` | visible, gated |
| 26 | moderate the fixture conversation | `messaging-panel.tsx` | visible, gated |
| 27 | message an opposition contact directly | `message-opposition.tsx` | visible |
| 28 | list opposition contacts | `opposition-contacts.ts` | server |
| 29 | staff fixture communication actions | `communication-panel.tsx` | visible, gated |

### Server authority and projection — 4

| # | function | where | state |
|---|---|---|---|
| 30 | `get_match_centre_capabilities` — participants, message, manage | RPC | server-only |
| 31 | `get_my_attendance_authority` — can respond | RPC | server-only |
| 32 | privacy filtered **before** render, not hidden in React | `match-centre-data.ts` | server-only |
| 33 | public fixture projection carrying **no** score and no participants | `public.public_club_fixtures` | visible (public) |

### Community and rewards — 0

Polls, Kudos, nominations, votes, awards, recognition, badges and match-reward
records: **none exist**. See the archaeology §1 for the search that establishes
it and for the two false positives (referral rewards, safeguarding nominations)
that must not be conflated with this domain.

### Adjacent, owned elsewhere, and not Step 11's to move

Recorded so that nothing looks lost later: the **result** (`home_score`,
`away_score`, `result_status`) is recorded and displayed in Fixture Management,
the admin fixture editor, the Calendar and the result confirmation flow in
Messages. Match Centre displays **none** of it today. The post-match write-up has
a canonical home in `public.club_articles` with `category = 'MATCH_REPORT'`,
which carries no `fixture_id`.

## FUNCTIONS AFTER: 55
## FUNCTIONS LOST: 0

Each of the 33 above still exists, unchanged in scope and behind no new
capability. Verified by re-running their own suites: `match_centre_core` (22),
`match_centre_capabilities` (7), `calendar_match_centre_link` (18),
`step10_team_experience` (29), `step9_family_and_availability` (41),
`step8_operational_access` (69), and the browser journeys
`50-team-home-journey` (22), `49-family-availability-journey` (25) and
`53-fixture-authority` (14) — all green.

### The 22 Step 11 adds

| # | function | where |
|---|---|---|
| 34 | the result of a played match, read-only, in the hero where the fixture said "VS" | `hero.tsx` |
| 35 | a canonical award catalogue, each category carrying its electorate | `public.match_award_categories` |
| 36 | the electorate follows the side's age — the families of a youth side, the players of an adult one | `internal.match_award_can_vote` |
| 37 | and so does the canonical name — Parents' Player, Players' Player | `internal.match_award_display_name` |
| 38 | a team switches on the awards it runs | `set_team_award_category` |
| 39 | and may display its own name for one, presentation only | `team_award_category_settings.display_name_override` |
| 40 | staff see the catalogue and their team's switches before anything is opened | `get_match_community_admin` |
| 41 | open an award, but only on a match that was played | `open_match_award` |
| 42 | cast a vote | `cast_match_award_vote` |
| 43 | change it while voting is open | same, one row |
| 44 | withdraw it | `withdraw_match_award_vote` |
| 45 | close an award to a server-decided outcome — winner, tie, or nobody voted | `close_match_award` |
| 46 | the winner, shown to the team | `get_match_community` |
| 47 | the count, shown to staff and only once closed | same, `total_votes` |
| 48 | the names an eligible person may choose between — and nothing without eligibility | `get_match_recognition_squad` |
| 49 | an opposition award where the opposition is on Ovalball, and a named refusal where it is not | `internal.match_other_side` |
| 50 | give Kudos from a fixed positive vocabulary | `give_match_kudos` · `match_kudos_kinds` |
| 51 | change what it was given for | same, one row per giver and recipient |
| 52 | take your own back | `withdraw_match_kudos` |
| 53 | staff remove recognition: it leaves the surface, the record of the removal stays | `remove_match_kudos` |
| 54 | Kudos displayed aggregated and unattributed | `get_match_kudos` |
| 55 | the match report, belonging to its match and reachable from it | `club_articles.fixture_id` |

### What was deliberately not built

- **No live-match anything.** There is no LIVE state in the schema and none was
  invented.
- **No points, currency or granted badge.** A player's recognition history is
  derivable from rows that already exist; the reader that would put it on a
  profile belongs to the Player profile surface and is named in the report
  rather than built here.
- **No free text about children.** Kudos has a closed vocabulary, so there is
  no text to moderate.
- **No second article model** for write-ups, and **no second media, storage or
  permission model** anywhere in this step.
