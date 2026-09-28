import type { SupabaseClient } from "@supabase/supabase-js"

import { resolvePersonalAvatarUrls } from "../personal-avatar"
import type { Database } from "../database"

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
export const TEAM_STAFF_ROLE_KEYS = ["TEAM_ADMINISTRATION", "TEAM_MANAGER", "COACH", "FIRST_AIDER", "TEAM_SAFEGUARDING_LEAD"] as const

/** The two presentational coaching titles Section 13/14 allows -- `null` means the plain "Coach" label
 * with no extra title. Authority is always exactly COACH underneath; this never changes what a Coach
 * may do, only what their row is called. */
export type CoachTitle = "HEAD_COACH" | "ASSISTANT_COACH" | null

export const COACH_TITLE_LABEL: Record<Exclude<CoachTitle, null>, string> = {
  HEAD_COACH: "Head Coach",
  ASSISTANT_COACH: "Assistant Coach",
}

export interface TeamStaffRole {
  /** The role_assignments id -- what set_team_role_title and transition_role_assignment each address. */
  assignmentId: string
  roleKey: string
  /** role_definitions.label, verbatim -- "Coach", "Team Manager", "First Aider". Never re-derived client-side. */
  label: string
  title: CoachTitle
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
const ROLE_RANK: Record<string, number> = { TEAM_ADMINISTRATION: 1, TEAM_MANAGER: 2, COACH: 3, FIRST_AIDER: 4, TEAM_SAFEGUARDING_LEAD: 5 }
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
      label: role.label,
      title: (role.title as CoachTitle) ?? null,
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
 * GRANTS ONE MORE ROLE TO AN EXISTING MEMBERSHIP, ON THIS TEAM -- the canonical `assign_role` itself,
 * called with an EXPLICIT team id rather than through the club-only `assignAdditionalRole` helper
 * (`packages/contracts/src/club/people.ts`), which hardcodes `p_team_id: undefined` for its own,
 * club-scoped job. `assign_role`'s own authority check (`internal.team_people_level(club, team)`)
 * already asks the explicit team, never the caller's switched active context (Section 26) -- so this
 * is correct for a Club Admin managing a team they hold no personal role on, with no synthetic context
 * switch required.
 */
export async function grantTeamStaffRole(supabase: Client, membershipId: string, roleKey: string, teamId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("assign_role", { p_membership_id: membershipId, p_role_key: roleKey, p_team_id: teamId, p_reason: reason.trim() || undefined })
  if (error) throw error
}

/** Ends exactly the one role assignment named -- every other role the person holds, on this team or any
 * other, is untouched (Section 24/25). The canonical `transition_role_assignment`, unchanged. */
export async function revokeTeamStaffRole(supabase: Client, assignmentId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("transition_role_assignment", { p_assignment_id: assignmentId, p_to_state: "REVOKED", p_reason: reason.trim() || undefined, p_allow_no_club_admin: false })
  if (error) throw error
}

/** The presentational Head Coach / Assistant Coach label -- attributes only, on a role assignment the
 * server has already confirmed is COACH. Authority never changes. */
export async function setCoachTitle(supabase: Client, assignmentId: string, title: CoachTitle): Promise<void> {
  const { error } = await supabase.rpc("set_team_role_title", { p_assignment_id: assignmentId, p_title: title })
  if (error) throw error
}
