# Convergence Step 9 — BEFORE functionality matrix

The gate is §48: **`FUNCTIONS AFTER >= FUNCTIONS BEFORE`, `FUNCTIONS LOST = 0`.**

Built from the exported server actions and the RPCs they call, before product
changes. It counts what a real person can do, including functions that are
hidden, orphaned or reachable only by URL — an unreachable capability is still
one that must not be lost.

`BEFORE` is `c06dd1a`.

---

## A. A parent or guardian, about their children

| # | function | canonical mutation | BEFORE | AFTER |
|---:|---|---|:--:|:--:|
| 1 | See every child they are guardian of | `/parent/children` | ✅ | ✅ |
| 2 | See each child's club, team and next event | dashboard family panel | ✅ | ✅ |
| 3 | Switch between children, and to All Children | `listSwitchableContexts` | ✅ | ✅ |
| 4 | Add a child | `add_child_for_guardian` | ✅ | ✅ |
| 5 | Preview which team a child would be placed in | `preview_player_allocation` | ✅ | ✅ |
| 6 | Search clubs to place a child at | `searchClubs` | ✅ | ✅ |
| 7 | Ask to be linked to an existing child | `request_child_link` | ✅ | ✅ |
| 8 | Cancel their own pending link request | `cancel_guardian_link_request` | ✅ | ✅ |
| 9 | See their own pending link requests | `my_guardian_link_requests` | ✅ | ✅ |
| 10 | **Invite another guardian for a child** | `request_additional_guardian` | ✅ | ✅ |
| 11 | **Accept or decline being made an additional guardian** | `respond_to_additional_guardian_request` | ✅ | ✅ |
| 12 | Invite a child to have their own player account | `issue_invitation(PLAYER_ACCOUNT)` | ✅ | ✅ |
| 13 | Set or remove a child's photo | `set_player_avatar` | ✅ | ✅ |
| 14 | See and set what a child may do for themselves | `/parent/players/[id]/access`, `set_guardian_player_permission` | ✅ | ✅ |
| 15 | See and correct a child's recorded details | `/parent/players/[id]/details` | ✅ | ✅ |
| 16 | Record a child's gender where they are entitled to | `request_player_playing_pathway` family path | ✅ | ✅ |
| 17 | Manage a child's membership subscription | `/parent/players/[id]/subscription` | ✅ | ✅ |
| 18 | Answer a guardian link request about their child | `/guardian-requests`, approve / reject | ✅ | ✅ |

## B. Seeing the rugby

| # | function | canonical source | BEFORE | AFTER |
|---:|---|---|:--:|:--:|
| 19 | A family agenda across every child | `lib/parent/family-agenda.ts` | ✅ | ✅ |
| 20 | Filter the agenda to one child | agenda scope | ✅ | ✅ |
| 21 | Filter to what still needs an answer | `needsResponse` | ✅ | ✅ |
| 22 | A count of outstanding responses on the dashboard | family panel | ✅ | ✅ |
| 23 | The Calendar in a family context | `/calendar` | ✅ | ✅ |
| 24 | Match Centre for a child's fixture | `/fixtures/[fixtureId]` | ✅ | ✅ |
| 25 | Training Centre for a child's session | `/training/[sessionId]` | ✅ | ✅ |
| 26 | Your Clubs, per child | dashboard | ✅ | ✅ |

## C. Answering

| # | function | canonical mutation | BEFORE | AFTER |
|---:|---|---|:--:|:--:|
| 27 | Answer a fixture, in Match Centre | `respond_to_attendance` | ✅ | ✅ |
| 28 | Answer a training session | `respond_to_training_attendance` | ✅ | ✅ |
| 29 | Answer a club event | `respond_to_event_attendance` | ✅ | ✅ |
| 30 | Change an answer already given | same three | ✅ | ✅ |
| 31 | An adult player answering for themselves | `resolve_attendance_response_source` | ✅ | ✅ |
| 32 | A 16–17 year old answering with recorded consent | `guardian_permission_effective` | ✅ | ✅ |

## D. A player, about themselves

| # | function | canonical source | BEFORE | AFTER |
|---:|---|---|:--:|:--:|
| 33 | Claim a player account from an invitation | `accept_player_account_invitation` | ✅ | ✅ |
| 34 | Join a club as a player | `/player/join` | ✅ | ✅ |
| 35 | Withdraw their own club join request | `withdraw_player_club_join_request` | ✅ | ✅ |
| 36 | See their own club and team context | `linkedPlayerTeams` | ✅ | ✅ |
| 37 | See their own upcoming rugby | agenda, player scope | ✅ | ✅ |
| 38 | See their own payments | `/player/payments` | ✅ | ✅ |

## E. Club and team staff, about families

| # | function | canonical mutation | BEFORE | AFTER |
|---:|---|---|:--:|:--:|
| 39 | See a player's guardians at their club | `/club/settings/guardians` | ✅ | ✅ |
| 40 | Approve a guardian link request | `approve_guardian_link_request` | ✅ | ✅ |
| 41 | Reject a guardian link request | `reject_guardian_link_request` | ✅ | ✅ |
| 42 | See link requests awaiting the club | `guardian_link_requests_for_approval` | ✅ | ✅ |
| 43 | Remove a guardian relationship | `remove_guardian_relationship` | ✅ | ✅ |
| 44 | Transition a guardian relationship's state | `transition_guardian_relationship` | ✅ | ✅ |
| 45 | Review a duplicate player | `player_duplicate_reviews` | ✅ | ✅ |
| 46 | Approve a pending team membership | `approve_pending_team_membership` | ✅ | ✅ |
| 47 | Reject a pending team membership | `reject_pending_team_membership` | ✅ | ✅ |
| 48 | Approve a player's club join request and place them | `approve_player_club_join_request` | ✅ | ✅ |
| 49 | Decline a player's club join request | `decline_player_club_join_request` | ✅ | ✅ |
| 50 | Archive / restore a player's team membership | `archive_` / `restore_player_team_membership` | ✅ | ✅ |
| 51 | Move a player between teams | `move_player_team_membership` | ✅ | ✅ |
| 52 | See a team's guardian directory | `get_team_guardian_directory` | ✅ | ✅ |
| 53 | Read a fixture's availability summary | `fixture_availability_summary` | ✅ | ✅ |
| 54 | Read a training register | `get_training_register` | ✅ | ✅ |
| 55 | Send a replacement guardian invitation | `send_replacement_guardian_invitation` | ✅ | ✅ |

## F. Site Admin, about families

| # | function | canonical mutation | BEFORE | AFTER |
|---:|---|---|:--:|:--:|
| 56 | Link a guardian to a player | `site_link_guardian` | ✅ | ✅ |
| 57 | End a guardian relationship | `site_end_guardian_relationship` | ✅ | ✅ |
| 58 | Read a person's family history | `site_family_history` | ✅ | ✅ |
| 59 | Read a person's player team memberships | `site_player_team_memberships` | ✅ | ✅ |
| 60 | Set a player's team membership | `site_set_player_team_membership` | ✅ | ✅ |

## G. Invitations and joining, family-relevant

| # | function | canonical mutation | BEFORE | AFTER |
|---:|---|---|:--:|:--:|
| 61 | Preview a guardian invitation before accepting | `get_guardian_invitation_preview` | ✅ | ✅ |
| 62 | Accept a guardian invitation | `accept_guardian_invitation` | ✅ | ✅ |
| 63 | Preview a player-account invitation | `get_player_account_invitation_preview` | ✅ | ✅ |
| 64 | Redeem a team join code into a request | `redeem_invitation(TEAM_JOIN_CODE)` | ✅ | ✅ |
| 65 | Create a player for a guardian from an invitation | `create_player_for_guardian` | ✅ | ✅ |
| 66 | Link a guardian to an existing player from an invitation | `link_guardian_to_existing_player` | ✅ | ✅ |

---

## Totals

Every one of the 66 is still present and reached the same way. Step 9 removed
no operation, moved none to a different actor and narrowed none.

### Added by Step 9

| # | function | canonical mutation | added |
|---:|---|---|:--:|
| 67 | **Answer a fixture from the agenda row itself**, without leaving the list | `respond_to_attendance` via `respondFromAgenda` | ✅ |
| 68 | **Answer a training session from the agenda row itself** | `respond_to_training_attendance` via the same | ✅ |
| 69 | See where a player stands relative to the adult boundary, as of any date | `player_adult_transition` | ✅ |
| 70 | **An adult player ending one guardian's access to their own record** | `end_my_guardian_access` | ✅ |

| | |
|---|---:|
| **FUNCTIONS BEFORE** | **66** |
| **FUNCTIONS AFTER** | **70** |
| **FUNCTIONS LOST** | **0** |

### One thing was removed, and it was a duplicate, not a function

A linked player with a legacy `view_only` row on their own team was offered a
second context, `kind: "parent"`, captioned "Parent / Player (view only)". It
duplicated their own player context and framed their rugby as somebody else's
child. **An unmigrated parent with the same row still gets theirs** — asserted
by `identity_and_context.test.mts` 4g, so the duplicate was removed and the
relationship was not.
