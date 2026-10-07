import type { SupabaseClient } from "@supabase/supabase-js"

import { resolvePersonalAvatarUrls } from "../personal-avatar"
import type { Database } from "../database"
import { canonicalRoleLabel, teamTitleLabel } from "../role-labels"
import { endRoleAssignment, giveRole, setTeamRoleTitle } from "../club/people"

type Client = SupabaseClient<Database>

/**
 * TEAM STAFF -- one person, every role they actually hold on THIS team (Team Profile Section 4).
 *
 * Reads `public.team_staff`, which the Section 3 audit made necessary: `team_people`'s own "coach"
 * rows come from `team_permissions`, a compatibility view that only knows Team Administration/Team
 * Manager/Coach and collapses two of those on one person into whichever it ranks higher -- correct for
 * that view's own legacy job, wrong for a screen whose job is showing every role a person holds,
 * including First Aider, which the compatibility view cannot represent at all. `team_staff` reads
 * `role_assignments` directly and aggregates server-side, so Coach + First Aider on one person is one
 * row with two roles, never two rows or a silently dropped fact.
 *
 * THE SAME ROSTER GATE PLAYERS ALREADY USE (`team.roster.view`/`team_people_authority`) -- staff is
 * not a separate audience from the rest of the roster, so it is not a separate capability either.
 *
 * TEAM_SAFEGUARDING_LEAD (Section 4 addendum, `20270571000000`) is a genuinely distinct, team-scoped
 * role -- never the club-scoped, Site-only `SAFEGUARDING_OFFICER` wearing a team-facing label. It
 * shares FIRST_AIDER's own "VO" bundle (view-only plus `safeguarding.conversation.start`), so it can
 * reach the club's safeguarding contact but holds none of the confirmed officer's authority.
 */
export const TEAM_STAFF_ROLE_KEYS = ["TEAM_ADMINISTRATION", "TEAM_MANAGER", "COACH", "FIRST_AIDER", "TEAM_SAFEGUARDING_LEAD", "VOLUNTEER"] as const

/**
 * A team title: the Coach role's own HEAD_COACH / ASSISTANT_COACH, or -- since People & Invitations --
 * the words a club gives any team role ("Physio" on a Volunteer). `null` is the role's plain name.
 * Authority never changes with a title: it describes what somebody does, never what they may do.
 */
export type StaffTitle = string | null

export interface TeamStaffRole {
  /** The role_assignments id -- what set_team_role_title and transition_role_assignment each address. */
  assignmentId: string
  roleKey: string
  /** The catalogue's label -- "Coach", "Team Manager", "First Aider". */
  label: string
  /** Stored title (HEAD_COACH, ASSISTANT_COACH or the words typed). */
  title: StaffTitle
  /** What the row is called: the title in words where there is one, else the label. */
  displayLabel: string
}

export interface TeamStaffMember {
  membershipId: string
  personId: string | null
  displayName: string
  /** A real signed URL where the bucket's own policy admits this viewer, otherwise null -- the
   * interface falls back to initials, exactly like every other personal avatar in this app. */
  avatarUrl: string | null
  /** Already presentation-ordered by the reader itself (Section 11): senior team roles first, First
   * Aider last, alphabetical beyond that -- never database row order, and never an ordering that
   * implies one role outranks another in what it may DO. */
  roles: TeamStaffRole[]
}

/** The row's own deterministic sort key (Section 36) -- the SAME order the reader already put each
 * person's own roles in, read off their first (most senior) role. Two people sharing a rank fall back
 * to name, so the list never reorders itself between reads for no visible reason. */
const ROLE_RANK: Record<string, number> = { TEAM_ADMINISTRATION: 1, TEAM_MANAGER: 2, COACH: 3, FIRST_AIDER: 4, TEAM_SAFEGUARDING_LEAD: 5, VOLUNTEER: 6 }
export function teamStaffSortKey(member: TeamStaffMember): number {
  return Math.min(...member.roles.map((r) => ROLE_RANK[r.roleKey] ?? 99), 99)
}

interface RawRole {
  assignmentId: string
  roleKey: string
  label: string
  title: string | null
}

export async function readTeamStaff(supabase: Client, teamId: string): Promise<TeamStaffMember[]> {
  const { data, error } = await supabase.rpc("team_staff", { p_team_id: teamId })
  if (error) throw error
  const rows = data ?? []
  const avatarUrls = await resolvePersonalAvatarUrls(supabase, rows.map((r) => r.avatar_storage_path))
  const members = rows.map((r) => ({
    membershipId: r.membership_id,
    personId: r.person_id,
    displayName: r.display_name?.trim() || "Unknown",
    avatarUrl: r.avatar_storage_path ? (avatarUrls.get(r.avatar_storage_path) ?? null) : null,
    roles: ((r.roles as unknown as RawRole[]) ?? []).map((role) => ({
      assignmentId: role.assignmentId,
      roleKey: role.roleKey,
      label: canonicalRoleLabel(role.roleKey),
      title: role.title ?? null,
      displayLabel: teamTitleLabel(role.title) ?? canonicalRoleLabel(role.roleKey),
    })),
  }))
  return members.sort((a, b) => teamStaffSortKey(a) - teamStaffSortKey(b) || a.displayName.localeCompare(b.displayName))
}

/** One error rule, matching team_people's own. */
export function teamStaffErrorMessage(error: unknown, fallback: string): string {
  const e = (error ?? {}) as { code?: string; message?: string }
  if (e.code === "42501" || e.code === "22023" || e.code === "23514" || e.code === "P0001" || e.code === "P0002") return e.message || fallback
  return fallback
}

/**
 * GRANTS ONE MORE ROLE TO AN EXISTING MEMBERSHIP, ON THIS TEAM, with the title it is to carry. The
 * one implementation is `giveRole` (`club/people.ts`): the canonical `assign_role` called with an
 * EXPLICIT team id, whose authority check (`internal.team_people_level(club, team)`) asks the team
 * itself, never the caller's switched context -- correct for a Club Admin with no personal role here.
 */
export async function grantTeamStaffRole(supabase: Client, membershipId: string, roleKey: string, teamId: string, reason: string, title?: string | null): Promise<string> {
  return giveRole(supabase, membershipId, roleKey, teamId, reason, title)
}

/** Ends exactly the one role assignment named -- every other role the person holds, on this team or any
 * other, is untouched (Section 24/25). */
export function revokeTeamStaffRole(supabase: Client, assignmentId: string, reason: string): Promise<void> {
  return endRoleAssignment(supabase, assignmentId, reason)
}

/** A team role's title -- Head Coach, Assistant Coach, or words the club chose. Authority never changes. */
export function setStaffTitle(supabase: Client, assignmentId: string, title: StaffTitle): Promise<void> {
  return setTeamRoleTitle(supabase, assignmentId, title)
}

// ---------------------------------------------------------------------------------------------------
// WHO COULD JOIN THIS TEAM'S STAFF
// ---------------------------------------------------------------------------------------------------

export interface StaffCandidate {
  membershipId: string
  userId: string
  name: string
  avatarStoragePath: string | null
  /** What they already hold at THIS team. */
  rolesHere: { assignmentId: string; roleKey: string; title: string | null }[]
}

/**
 * The club's active members by name, for adding an existing person to a team's staff: `team_staff_candidates`,
 * open to whoever may give a role at this team (a Club Admin, or the team's own Team Admin) -- which
 * `club_people` is not. No contact details. The search runs on the server.
 */
export async function readTeamStaffCandidates(supabase: Client, teamId: string, search: string, limit = 20): Promise<StaffCandidate[]> {
  const { data, error } = await supabase.rpc("team_staff_candidates", { p_team_id: teamId, p_search: search.trim() || undefined, p_limit: limit })
  if (error) throw error
  return (data ?? []).map((r) => ({
    membershipId: r.membership_id,
    userId: r.user_id,
    name: [r.first_name, r.surname].filter(Boolean).join(" ").trim() || "Unknown",
    avatarStoragePath: r.avatar_storage_path ?? null,
    rolesHere: ((r.team_roles as unknown as { id: string; role_key: string; title: string | null }[]) ?? []).map((t) => ({ assignmentId: t.id, roleKey: t.role_key, title: t.title ?? null })),
  }))
}
