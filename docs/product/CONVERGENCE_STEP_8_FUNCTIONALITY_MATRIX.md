# Convergence Step 8 — BEFORE functionality matrix

The gate is §48: **`FUNCTIONS AFTER >= FUNCTIONS BEFORE`, `FUNCTIONS LOST = 0`.**

Built before anything was changed, from the exported server actions in `app/`
and the RPCs they call, not from documentation. Every row is an access or
role-management operation a legitimate person can perform today. Team and club
*identity* operations (aliases, folding a team, club branding) are deliberately
out of scope — they are not access management and belong to Steps 6 and 7.

`BEFORE` is what exists at `6c02412`. `AFTER` is filled in at Step 8 closure.

---

## A. Club Admin — `/people`, the Users & Permissions centre

| # | function | canonical mutation | BEFORE | AFTER |
|---:|---|---|:--:|:--:|
| 1 | See the club's people, with role and state | `get_club_member_directory` | ✅ | ✅ |
| 2 | Open one person's access detail | `/people/[membershipId]` | ✅ | ✅ |
| 3 | See WHY each answer is what it is, per capability | `explain_access` ×10 | ✅ | ✅ |
| 4 | Change a membership's primary club role | `set_primary_club_role` | ✅ | ✅ |
| 5 | Give somebody a team staff permission | `set_team_access` | ✅ | ✅ |
| 6 | Remove one team assignment | `remove_team_access` | ✅ | ✅ |
| 7 | Revoke a club membership, with a reason | `transition_club_membership` | ✅ | ✅ |
| 8 | Approve or reject a club join request | `decide_club_join_request` | ✅ | ✅ |
| 9 | Issue an invitation carrying an intended outcome | `issue_invitation` | ✅ | ✅ |
| 10 | See which staff roles an invitation may carry | `invitation_staff_role_options` | ✅ | ✅ |
| 11 | Resend an invitation (new code, old one dies) | `resend_invitation` | ✅ | ✅ |
| 12 | Revoke an invitation, with a reason | `revoke_invitation` | ✅ | ✅ |

## B. Club Admin — `/club/permissions`, Effective Access

| # | function | canonical mutation | BEFORE | AFTER |
|---:|---|---|:--:|:--:|
| 13 | See every member's effective answer for the offered capabilities | `club_member_capabilities` | ✅ | ✅ |
| 14 | See the SOURCE of each answer — role, granted, withheld, restricted | same | ✅ | ✅ |
| 15 | See whether they may change it, and why not when they may not | `editable`, `override_level` | ✅ | ✅ |
| 16 | Grant a capability to one person | `set_capability_override` grant | ✅ | ✅ |
| 17 | Withhold a capability from one person | `set_capability_override` deny | ✅ | ✅ |
| 18 | Reset to whatever the role says | `revoke_capability_override` | ✅ | ✅ |

## C. Club Admin — `/club/join-requests`, player placement

| # | function | canonical mutation | BEFORE | AFTER |
|---:|---|---|:--:|:--:|
| 19 | Approve a player join request and place the player in a team | `approve_player_club_join_request` | ✅ | ✅ |
| 20 | Decline a player join request with a reason | `decline_player_club_join_request` | ✅ | ✅ |

## D. Team administration — `/teams/[teamId]`

| # | function | canonical mutation | BEFORE | AFTER |
|---:|---|---|:--:|:--:|
| 21 | Assign a member to this team with a staff permission | `set_team_access` | ✅ | ✅ |
| 22 | Remove a member from this team | `remove_team_access` | ✅ | ✅ |
| 23 | Archive a player's team membership | `archive_player_team_membership` | ✅ | ✅ |
| 24 | Restore an archived player membership | `restore_player_team_membership` | ✅ | ✅ |
| 25 | Approve a pending team membership | `approve_pending_team_membership` | ✅ | ✅ |
| 26 | Decline a pending team membership with a reason | `reject_pending_team_membership` | ✅ | ✅ |

## E. Site Admin — master control on a person (`/admin/users/[userId]`)

| # | function | canonical mutation | BEFORE | AFTER |
|---:|---|---|:--:|:--:|
| 27 | Revoke every session a person holds | `site_revoke_sessions` | ✅ | ✅ |
| 28 | Force a password reset | master control | ✅ | ✅ |
| 29 | Add a club membership | `site_add_club_membership` | ✅ | ✅ |
| 30 | Transition a club membership | `site_transition_club_membership` | ✅ | ✅ |
| 31 | Assign a club role | `site_assign_club_role` | ✅ | ✅ |
| 32 | Revoke a role assignment | `site_revoke_role_assignment` | ✅ | ✅ |
| 33 | Assign a team role | `site_assign_team_role` | ✅ | ✅ |
| 34 | Place or remove a player's team membership | `site_set_player_team_membership` | ✅ | ✅ |
| 35 | Link a guardian to a player | `site_link_guardian` | ✅ | ✅ |
| 36 | End a guardian relationship | `site_end_guardian_relationship` | ✅ | ✅ |
| 37 | Set a capability override at any scope | `site_set_capability_override` | ✅ | ✅ |
| 38 | Revoke an invitation | `site_revoke_invitation` | ✅ | ✅ |
| 39 | Resend account setup | master control | ✅ | ✅ |
| 40 | REQUEST a Site Admin grant (two-admin, never self-approved) | `site_request_site_admin_grant` | ✅ | ✅ |
| 41 | Change a Site Admin profile | `site_change_site_admin_profile` | ✅ | ✅ |
| 42 | Read a person's membership / family / team / account history | `site_*_history` ×4 | ✅ | ✅ |

## F. Site Admin — `/admin/site-admins`

| # | function | canonical mutation | BEFORE | AFTER |
|---:|---|---|:--:|:--:|
| 43 | Invite a Site Admin | `issue_invitation` SITE_ADMIN | ✅ | ✅ |
| 44 | Revoke a Site Admin invitation | `revoke_site_admin_invitation` | ✅ | ✅ |
| 45 | Change a Site Admin's role | `site_change_site_admin_profile` | ✅ | ✅ |
| 46 | Grant or withdraw diagnostic access | `set_site_admin_diagnostic_capability` | ✅ | ✅ |
| 47 | Grant or withdraw team-catalogue access | `set_site_admin_team_catalogue_capability` | ✅ | ✅ |
| 48 | Grant or withdraw competitions access | `set_site_admin_competitions_capability` | ✅ | ✅ |
| 49 | Grant or withdraw fixture-support access | `set_site_admin_fixture_support_capability` | ✅ | ✅ |
| 50 | Grant or withdraw global-lookups access | `set_site_admin_global_lookups_capability` | ✅ | ✅ |
| 51 | Grant or withdraw seasons access | `set_site_admin_seasons_capability` | ✅ | ✅ |
| 52 | Revoke an active Site Admin | `site_revoke_site_admin` | ✅ | ✅ |
| 53 | APPROVE a pending sensitive Site Admin grant | `site_approve_site_admin_grant` | ✅ | ✅ |
| 54 | REJECT a pending sensitive Site Admin grant | `site_reject_site_admin_grant` | ✅ | ✅ |

## G. Site Admin — a club's people (`/admin/clubs/[directoryId]`)

| # | function | canonical mutation | BEFORE | AFTER |
|---:|---|---|:--:|:--:|
| 55 | See a club's connected users | `getConnectedUsers` | ✅ | ✅ |
| 56 | Change a membership's governance title | `set_membership_governance_title` | ✅ | ✅ |
| 57 | Revoke a membership at a club | `transition_club_membership` | ✅ | ✅ |
| 58 | Readmit a revoked membership | `transition_club_membership` | ✅ | ✅ |
| 59 | Change a membership's access profile in one transaction | `change_membership_access_profile` | ✅ | ✅ |
| 60 | Deactivate a club's Club Admin | `deactivateClubAdmin` | ✅ | ✅ |
| 61 | Reactivate a club's Club Admin | `reactivateClubAdmin` | ✅ | ✅ |
| 62 | List suspended club memberships | `list_suspended_club_memberships` | ✅ | ✅ |
| 63 | Restore suspended club membership authority | `restore_club_membership_authority` | ✅ | ✅ |

## H. Safeguarding (`/admin/safeguarding`)

| # | function | canonical mutation | BEFORE | AFTER |
|---:|---|---|:--:|:--:|
| 64 | Set a safeguarding capability | `set_capability_override` (safeguarding-sensitive) | ✅ | ✅ |
| 65 | Confirm a Safeguarding Officer out of PENDING_CONFIRMATION | `confirmSafeguardingOfficer` | ✅ | ✅ |

## I. Self-service — invitations, join requests, family

| # | function | canonical mutation | BEFORE | AFTER |
|---:|---|---|:--:|:--:|
| 66 | Preview an invitation without redeeming it | `preview_invitation` | ✅ | ✅ |
| 67 | Redeem an invitation into its intended outcome | `redeem_invitation` | ✅ | ✅ |
| 68 | Accept a guardian invitation | `accept_guardian_invitation` | ✅ | ✅ |
| 69 | Accept a player-account invitation | `accept_player_account_invitation` | ✅ | ✅ |
| 70 | Accept a Safeguarding Officer invitation | `accept_safeguarding_officer_invitation` | ✅ | ✅ |
| 71 | Accept a Site Admin invitation | `accept_site_admin_invitation` | ✅ | ✅ |
| 72 | Request to join a club | club join request | ✅ | ✅ |
| 73 | Withdraw a player club join request | `withdraw_player_club_join_request` | ✅ | ✅ |
| 74 | Request an additional guardian for a player | `request_additional_guardian` | ✅ | ✅ |
| 75 | Respond to an additional-guardian request | `respond_to_additional_guardian_request` | ✅ | ✅ |
| 76 | Approve or reject a guardian link request | `approve_guardian_link_request` / `reject_guardian_link_request` | ✅ | ✅ |
| 77 | Remove a guardian relationship | `remove_guardian_relationship` | ✅ | ✅ |

---

## Totals

Every one of the 77 is still present and still reached the same way. Step 8
removed no operation, moved none to a different actor and narrowed none.

### Added by Step 8

| # | function | canonical mutation | added |
|---:|---|---|:--:|
| 78 | Give somebody an additional club role that is not the three-way seat — Volunteer today, anything the catalogue marks club-assignable tomorrow | `assign_role` | ✅ |
| 79 | End ONE role assignment by name, leaving every other relationship standing | `transition_role_assignment` | ✅ |
| 80 | See every role a person holds besides their seat, club-wide and per team, in one list | `role_assignments` + catalogue | ✅ |
| 81 | Apply a named job — a preset — in one transaction with one event per permission | `apply_capability_preset` | ✅ |
| 82 | See which jobs this club can hand out, and whether YOU may hand each one out | `club_capability_presets` | ✅ |
| 83 | Decide the club's Pitch Allocation permissions on the screen that decides permissions | existing keys, newly reachable | ✅ |
| 84 | Read one club's access history — what changed, to whom, by whom, and why | `club_access_history` | ✅ |
| 85 | Read one person's access history on their own access page | same, filtered | ✅ |

### Totals

| | |
|---|---:|
| **FUNCTIONS BEFORE** | **77** |
| **FUNCTIONS AFTER** | **85** |
| **FUNCTIONS LOST** | **0** |

---

## Present in the model but NOT reachable from any screen

Not counted above, because the matrix counts what a person can do. Recorded
because Step 8 must decide about each rather than leave it unnamed — and because
an unreachable canonical primitive is exactly the shape of thing that gets
rebuilt by accident.

| | state at Step 8 closure |
|---|---|
| `assign_role(membership, role_key, team, reason)` | **reached** — `assignAdditionalRole` on the person's access page (#78) |
| `transition_role_assignment(assignment, state, reason, allow_no_club_admin)` | **reached** — `endRoleAssignment` (#79) |
| `venue.pitch_allocation.view` / `.manage` | **reached** — the Pitch Allocation group (#83) |
| 61 further delegable capability keys | **still unreached.** 73 are delegable; the club screen now offers 12. Slice 8's contract is the club's operational access, not the whole catalogue, and a screen that offered every delegable key would be a capability editor rather than a decision about who does what job. Recorded so the next reader finds it named rather than by counting. |
