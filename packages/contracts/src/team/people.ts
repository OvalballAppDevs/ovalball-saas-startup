import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { TEAM_PERMISSION_LABEL, type TeamStaffPermission } from "../role-labels"

type Client = SupabaseClient<Database>

/**
 * THE TEAM'S PEOPLE, FROM THE ONE ROSTER READER (CA-M7).
 *
 * `public.team_people(p_team_id)` resolves the coaches and managers, the players and their parents and
 * guardians, and the people waiting to be let in, with one definition of what "active" means for each.
 * It refuses outright without `team.roster.view` at the team or the club (42501), so an empty list here
 * means "nobody" and a refusal means "not yours to see" -- never a filtered view dressed as a full one.
 *
 * NAMES ONLY. The reader carries no email, no phone, no date of birth, no medical or safeguarding fact,
 * and this module adds none: contact details are a separate club-scoped capability
 * (`people.member.view_contact`) with no team scope, and a team roster is not the place they leak.
 *
 * ROLE IS PRESENTATION. "Coach" and "Manager" on a row describe the role assignment; what the viewer may
 * DO to a row is the capability engine's answer (`readTeamAuthority`), asked separately, and every
 * write here is refused by the database independently of anything drawn.
 */
export type TeamPersonKind = "coach" | "guardian" | "player"
export type TeamPersonStatus = "active" | "archived" | "requested"

export interface TeamPerson {
  kind: TeamPersonKind
  /** The row an action addresses: a team_permissions id, a guardians id, or a player_team_memberships id. */
  rowId: string
  /** A user id for a coach or guardian, a player id for a player. */
  personId: string | null
  name: string
  /** A coach's role, or the player a guardian is here for. */
  detail: string | null
  status: TeamPersonStatus
  requestedAt: string | null
}

export interface TeamPeople {
  staff: TeamPerson[]
  players: TeamPerson[]
  guardians: TeamPerson[]
  /** Players waiting to be let in. */
  requests: TeamPerson[]
  /** Players no longer in the side, kept so a restore is possible. */
  archived: TeamPerson[]
}

const byName = (a: TeamPerson, b: TeamPerson) => a.name.localeCompare(b.name)

/** Pure: the reader's rows, grouped the way a club thinks. */
export function groupTeamPeople(rows: { kind: string; row_id: string | null; person_id: string | null; name: string | null; detail: string | null; status: string | null; requested_at: string | null }[]): TeamPeople {
  const all: TeamPerson[] = rows
    .filter((r) => r.row_id)
    .map((r) => ({
      kind: r.kind as TeamPersonKind,
      rowId: r.row_id as string,
      personId: r.person_id,
      name: r.name ?? "Unknown",
      detail: r.detail,
      status: (r.status ?? "active") as TeamPersonStatus,
      requestedAt: r.requested_at,
    }))
  return {
    staff: all.filter((p) => p.kind === "coach" && p.status === "active").sort(byName),
    players: all.filter((p) => p.kind === "player" && p.status === "active").sort(byName),
    guardians: all.filter((p) => p.kind === "guardian" && p.status === "active").sort(byName),
    requests: all.filter((p) => p.kind === "player" && p.status === "requested").sort((a, b) => (a.requestedAt ?? "").localeCompare(b.requestedAt ?? "")),
    archived: all.filter((p) => p.kind === "player" && p.status === "archived").sort(byName),
  }
}

export async function readTeamPeople(supabase: Client, teamId: string): Promise<TeamPeople> {
  const { data, error } = await supabase.rpc("team_people", { p_team_id: teamId })
  if (error) throw error
  return groupTeamPeople(data ?? [])
}

/** What the viewer is to this team, in the words the club uses. Badges, never authority. */
export interface TeamRelationship {
  relationship: string
  label: string
  subjectPlayerId: string | null
  subjectName: string | null
}

export async function readMyTeamRelationship(supabase: Client, teamId: string): Promise<TeamRelationship[]> {
  const { data, error } = await supabase.rpc("my_team_relationship", { p_team_id: teamId })
  if (error) return []
  return (data ?? []).map((r) => ({ relationship: r.relationship, label: r.label, subjectPlayerId: r.subject_player_id, subjectName: r.subject_name }))
}

// ---------------------------------------------------------------------------
// Roster operations. Each asks its own authority on the server (team.roster.manage at the team or the
// club); a reason is required where the operation says so.
// ---------------------------------------------------------------------------

export async function approveTeamPlaceRequest(supabase: Client, membershipId: string): Promise<void> {
  const { error } = await supabase.rpc("approve_pending_team_membership", { p_membership_id: membershipId })
  if (error) throw error
}

export async function declineTeamPlaceRequest(supabase: Client, membershipId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("reject_pending_team_membership", { p_membership_id: membershipId, p_reason: reason.trim() })
  if (error) throw error
}

export async function archiveTeamPlayer(supabase: Client, membershipId: string): Promise<void> {
  const { error } = await supabase.rpc("archive_player_team_membership", { p_membership_id: membershipId })
  if (error) throw error
}

export async function restoreTeamPlayer(supabase: Client, membershipId: string): Promise<void> {
  const { error } = await supabase.rpc("restore_player_team_membership", { p_membership_id: membershipId })
  if (error) throw error
}

/** The canonical staff roles a team hands out, labelled once. */
export function staffRoleLabel(permission: TeamStaffPermission | string): string {
  return TEAM_PERMISSION_LABEL[permission as TeamStaffPermission] ?? permission
}

/** One error rule for both clients: the server's own sentence for the outcomes it writes about people. */
export function teamPeopleErrorMessage(error: unknown, fallback: string): string {
  const e = (error ?? {}) as { code?: string; message?: string }
  if (e.code === "42501" || e.code === "22023" || e.code === "23514" || e.code === "23505" || e.code === "P0001" || e.code === "P0002") return e.message || fallback
  return fallback
}
