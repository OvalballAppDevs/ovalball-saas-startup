# Convergence Step 10 — BEFORE functionality matrix

The gate is §48: **`FUNCTIONS AFTER >= FUNCTIONS BEFORE`, `FUNCTIONS LOST = 0`.**

Built from the Team surfaces and the RPCs behind them before behaviour changed.
It counts what a real person can do, including functions reachable only by URL —
an unreachable function is still one that must not be lost.

`BEFORE` is `8c2567f`.

---

## A. The team page itself

| # | function | canonical source | BEFORE | AFTER |
|---:|---|---|:--:|:--:|
| 1 | Open a team by its canonical id | `/teams/[teamId]` | ✅ | ✅ |
| 2 | See its canonical display name | `teams.display_name` | ✅ | ✅ |
| 3 | See that it has been folded | `teams.active`, `folded_at` | ✅ | ✅ |
| 4 | See its full identity label — category, age grade, pathway, squad | `fullTeamLabel` | ✅ | ✅ |
| 5 | Edit the team's identity where authorised | `TeamIdentitySection` | ✅ | ✅ |
| 6 | Set or clear a team alias | `set_team_alias` / `clear_team_alias` | ✅ | ✅ |
| 7 | Fold a team, with a reason | `fold_team` | ✅ | ✅ |
| 8 | Reactivate a folded team | `reactivate_team` | ✅ | ✅ |
| 9 | See fixtures a fold would strand, and request restoration | `list_restorable_fixtures` | ✅ | ✅ |
| 10 | Be told plainly what you may not do here | the page's closing sentence | ✅ | ✅ |

## B. The team's people

| # | function | canonical source | BEFORE | AFTER |
|---:|---|---|:--:|:--:|
| 11 | See the team's coaches, players and parents in one list | `team_people` | ✅ | ✅ |
| 12 | Assign a club member to the team as staff | `set_team_access` | ✅ | ✅ |
| 13 | Remove a team assignment | `remove_team_access` | ✅ | ✅ |
| 14 | Archive a player's team membership | `archive_player_team_membership` | ✅ | ✅ |
| 15 | Restore an archived player membership | `restore_player_team_membership` | ✅ | ✅ |
| 16 | Approve a pending team membership | `approve_pending_team_membership` | ✅ | ✅ |
| 17 | Decline a pending team membership | `reject_pending_team_membership` | ✅ | ✅ |
| 18 | See and action player requests for this team | `/teams/[teamId]/player-requests` | ✅ | ✅ |

## C. Joining

| # | function | canonical source | BEFORE | AFTER |
|---:|---|---|:--:|:--:|
| 19 | Issue a team join code | `issue_invitation(TEAM_JOIN_CODE)` | ✅ | ✅ |
| 20 | See the team's live join codes | `teamJoinCodes` | ✅ | ✅ |
| 21 | Revoke a team join code | `revoke_invitation` | ✅ | ✅ |
| 22 | Share a join code, including as a QR | Step 3's canonical joining | ✅ | ✅ |

## D. Team news

| # | function | canonical source | BEFORE | AFTER |
|---:|---|---|:--:|:--:|
| 23 | Reach the team's news | `/teams/[teamId]/news` | ✅ | ✅ |
| 24 | Write a team article | `/news/new` | ✅ | ✅ |
| 25 | Publish a team announcement | `/news/announcements/new` | ✅ | ✅ |
| 26 | Read a published team article or announcement | `/news/[articleId]` | ✅ | ✅ |

## E. The team list and creation

| # | function | canonical source | BEFORE | AFTER |
|---:|---|---|:--:|:--:|
| 27 | See the club's teams | `/teams` | ✅ | ✅ |
| 28 | Create a team from the canonical catalogue | `create_team` | ✅ | ✅ |
| 29 | Pick a category from the canonical team types | `team-category-picker` | ✅ | ✅ |
| 30 | See and manage Mini-Rugby group calendars | `mini-rugby-calendars-section` | ✅ | ✅ |
| 31 | See a club's teams as a Site Admin | `/admin/clubs/[directoryId]` teams panel | ✅ | ✅ |

## F. Reached from elsewhere, about a team

| # | function | canonical source | BEFORE | AFTER |
|---:|---|---|:--:|:--:|
| 32 | The team's Calendar | `/calendar?team=` | ✅ | ✅ |
| 33 | The team's fixtures in the Control Centre | Step 7 | ✅ | ✅ |
| 34 | A team fixture's Match Centre | Step 7 | ✅ | ✅ |
| 35 | The team's training sessions | Training Centre | ✅ | ✅ |
| 36 | The team's availability summary, for staff | `fixture_availability_summary` | ✅ | ✅ |
| 37 | Team-scoped agenda for staff | `AgendaScope` `teams` | ✅ | ✅ |

---

## Totals

Every one of the 37 is still present and reached the same way. Step 10 removed
no operation, moved none to a different actor and narrowed none.

### Added by Step 10

| # | function | canonical source | added |
|---:|---|---|:--:|
| 38 | **See what you are to this team** — every relationship, as a list | `my_team_relationship` | ✅ |
| 39 | See a Parent/Guardian relationship named with the child it is about | same | ✅ |
| 40 | **See what is next for this team** — fixtures and training together | `loadAgenda` | ✅ |
| 41 | **See recent results** | same | ✅ |
| 42 | **Answer availability on the team's own row**, as a family | Step 9's control | ✅ |
| 43 | Open a team fixture's Match Centre from the team | Step 7's identity | ✅ |
| 44 | **Come back to the team** from Match Centre | Step 7's allowlist, one declared surface | ✅ |
| 45 | Give a team its own cover photo | `teams.cover_image_path` | ✅ |
| 46 | A deterministic cover fallback — team cover, then club crest, then nothing | `lib/teams/team-cover.ts` | ✅ |

| | |
|---|---:|
| **FUNCTIONS BEFORE** | **37** |
| **FUNCTIONS AFTER** | **46** |
| **FUNCTIONS LOST** | **0** |

### One behaviour changed, and it was a lockout, not a function

`canView` no longer requires the active context's club to match the team's.
Nobody lost a capability: `team.team.view` is resolved by the engine at this
team, and a Club Admin of one club still cannot see another's. What changed is
that **a guardian in All Children mode, and a player in their own context, can
now open their own team** — they were redirected to `/dashboard` before.
