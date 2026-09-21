# Convergence Step 12 — BEFORE/AFTER functionality matrix

Counted at `83edbe5` by reading the schema, the RPC inventory, the capability
bundles and the routes — not from memory. A function is a thing the product does
for somebody, counted once wherever it is implemented.

## FUNCTIONS BEFORE: 52

### Safeguarding Officer — authority and lifecycle — 22

| # | function | state |
|---|---|---|
| 1 | nominate an officer (`nominate_club_safeguarding_officer`, `nominate_safeguarding_officer`) | visible |
| 2 | the `PENDING_CONFIRMATION` seam — an assignment that confers **no** safeguarding authority | server-derived |
| 3 | AN-6 Ovalball confirmation (`confirm_safeguarding_officer`) | visible (Site Admin) |
| 4 | deactivate an officer (`deactivate_safeguarding_officer`) | visible |
| 5 | invite an officer through the canonical invitation (`invite_safeguarding_officer`) | visible |
| 6 | invitation preview (`get_safeguarding_officer_invitation_preview`) | visible |
| 7 | accept an invitation (`accept_safeguarding_officer_invitation`) | visible |
| 8 | resend an invitation | visible |
| 9 | revoke an invitation | visible |
| 10 | pending nominations (`pending_safeguarding_nominations`) | visible |
| 11 | a club's officers (`get_club_safeguarding_officers`) | visible |
| 12 | the club's **published** safeguarding contact (`club_safeguarding_contact`) | visible to every member |
| 13 | update officer contact details (`update_safeguarding_officer_contact`, `@self`) | visible |
| 14 | site safeguarding review (`site_safeguarding_review`) | visible (Site Admin) |
| 15 | the `SO` capability bundle — 22 capabilities, view-only outside safeguarding | server-derived |
| 16 | `is_active_safeguarding_officer` / `active_safeguarding_officer_ids`, **CONFIRMED-gated** | server-only |
| 17 | safeguarding conversations — start, send, view, handle | visible |
| 18 | safeguarding thread reviews | visible |
| 19 | notify a club's officers (`notify_club_safeguarding_officers`) | server-only |
| 20 | `/club/settings/safeguarding`, with pending and confirmed split and an explanation | visible |
| 21 | `/admin/safeguarding` (site) | visible |
| 22 | `/invite/safeguarding-officer` | visible |

### Age and age-grade — 17

| # | function | state |
|---|---|---|
| 23 | `resolve_player_regulatory_age` — season-based regulatory age with a governing reference | **server-only, no UI caller** |
| 24 | `resolve_player_age_grade` — canonical category and age group for a season | **server-only, no UI caller** |
| 25 | `regulatory_school_year_start` — the school year an age is measured against | server-only |
| 26 | `player_effective_age(player, as_of)` | server-only |
| 27 | `person_is_established_adult` — **D-S5-1**: recorded DOB *and* not a minor | server-only |
| 28 | `person_is_minor` (D-S4-4) | server-only |
| 29 | `player_is_adult` | server-only |
| 30 | `resolve_player_chronological_age` | server-only |
| 31 | `next_age_grade` / `next_age_grade_for` | server-only |
| 32 | `highest_youth_age_offered` | server-only |
| 33 | `age_fixture_band` | server-only |
| 34 | `enforce_fixture_age_eligibility` — a **trigger** on `fixtures`, enabled | server-only, unbypassable |
| 35 | `resolve_age_grade_rule_bundle` — regulatory facts with `primary_source_key` per fact | server-only |
| 36 | `resolve_adult_category` — the adult men's/women's classification | visible |
| 37 | `player_adult_transition` (Step 9/10) | visible |
| 38 | minor prohibitions — staff roles are never held by an under-18 | server-derived |
| 39 | `age_grade_rollover*` — rollover and graduation planning | visible |

### Dispensation — 6

| # | function | state |
|---|---|---|
| 40 | request a dispensation (`request_player_dispensation`) | visible |
| 41 | decide one — REQUESTED → SOURCE TEAM → CLUB → GOVERNING BODY → APPROVED, stage-ordered | visible |
| 42 | revoke one (`revoke_player_dispensation`) | visible |
| 43 | expire due dispensations (`expire_due_dispensations`) | server-only |
| 44 | `dispensation_team_ids` / `safeguarding_dispensation_team_ids` | server-only |
| 45 | `/club/player-moves` dispensation panel | visible |

### Educational and regulatory content — 7

| # | function | state |
|---|---|---|
| 46 | `get_rugby_hub_safeguarding_content` | visible |
| 47 | `get_rugby_hub_safeguarding_by_identity` — **already context-aware** | visible |
| 48 | `get_rugby_hub_safeguarding_routes` | visible |
| 49 | `resolve_safeguarding_reporting_routes` | server-only |
| 50 | `regulatory_reporting_routes` + `regulatory_reporting_route_citations` | server-derived |
| 51 | `/rugby-hub/safeguarding` and `/rugby-hub/safeguarding/contact` | visible |
| 52 | `/legal/safeguarding` | visible (public) |

## FUNCTIONS AFTER: 58
## FUNCTIONS LOST: 0

Every one of the 52 still exists, unchanged in scope and behind no new
capability. The SO bundle was not altered, no capability was granted or widened,
and no existing function was moved or rewritten — `internal.match_side_is_adult`
keeps its name, its signature and its answer, and now delegates. Verified by
re-running `safeguarding_authority_matrix` (130), `safeguarding_officer_foundation`
(24), `safeguarding_officer_security` (36),
`safeguarding_officer_dispensation_notifications` (8), `minor_prohibitions` (11),
`age_eligibility_matrix` (44), `player_age_resolver` (21),
`player_playing_pathway` (20), `step8_operational_access` (69),
`step9_family_and_availability` (41), `step10_team_experience` (29) and
`step11_match_community` (59) — all green.

### The 6 Step 12 adds

| # | function | where |
|---|---|---|
| 53 | **one canonical adult answer for a side**, shared with Match Centre's electorate | `internal.team_is_adult_side` |
| 54 | a player's age-grade position against one side, as a status and a sentence | `internal.team_age_grade_status` |
| 55 | what a team's staff must attend to — **only** the players who need it, never a date of birth | `public.team_age_grade_attention` |
| 56 | a family's own age-grade position, in the same words the club sees | `public.my_player_age_grade_status` |
| 57 | the Team page's Age Grade — Needs Attention panel (renders nothing when nothing is outstanding) | `components/teams/team-age-grade.tsx` |
| 58 | a guardian's own note on the same page, beside who they are to the team | same component |

### What was deliberately not built

- **No second age model, and no new rule.** Step 12 adds no age arithmetic: it
  calls `resolve_player_age_grade` and `resolve_season_for_date`.
- **No Dispensation v2.** The staged chain already exists and is untouched.
- **No safeguarding workspace.** `/club/settings/safeguarding` already exists;
  navigation follows the jobs.
- **No medical or case-note surface**, and no widening of any existing read.
- **No regulatory facts invented.** Nothing new was written into a migration as
  a governing-body rule.
- **No capability granted, widened or created.** Step 12 reads through
  `team.roster.view` and the guardian/self relationship only.
