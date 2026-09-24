import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { compactTeamLabel, fullTeamLabel, normalizedSquad } from "../teams/compact-label"
import { computeTeamAvailability, loadTeamCategoryGroups, type RugbyCode, type TeamCategoryGroup, type TeamOptionAvailability } from "../teams/catalog"

export type { RugbyCode }
import { buildDirectory, type DirectoryGroup } from "../teams/directory-taxonomy"

type Client = SupabaseClient<Database>

/**
 * A CLUB'S TEAMS -- CONFIGURATION, for both clients (CA-M2).
 *
 * This is the canonical existence and configuration of a club's teams, never their operations:
 * no fixtures, availability, messages or calendars live here. A team IS a canonical Team Directory
 * identity the club has activated (`teams.canonical_team_type_id`); its NAME is derived from that
 * identity by the database (`internal.canonical_team_presentation`) and mirrored by
 * `fullTeamLabel` / `compactTeamLabel`. Nothing here reads an age grade, a pathway or a code from a
 * name, and nothing here lets a client edit one: identity changes are Season Handover's.
 *
 * READS: `teams`, `team_aliases`, `canonical_team_types` under RLS, grouped by the one shared
 * taxonomy. WRITES: `create_club_team` (team.team.manage), `set_team_alias` / `clear_team_alias`
 * (team.team.manage, and only for a B or C squad -- the one product rule the website kept in its
 * component, now shared), `fold_team` / `reactivate_team` (team.lifecycle.manage). No delete.
 */

export interface ClubTeam {
  id: string
  /** The derived display name as the database holds it. */
  displayName: string
  fullLabel: string
  compactLabel: string
  category: "senior" | "youth" | "colts"
  ageGroup: string | null
  gender: string | null
  squadDesignation: string | null
  rugbyCode: RugbyCode
  canonicalTeamTypeId: string | null
  canonicalKey: string | null
  alias: string | null
  active: boolean
  foldedAt: string | null
  foldReason: string | null
}

export interface ClubTeamsDirectory {
  rugbyCode: RugbyCode | null
  teams: ClubTeam[]
  /** Active teams grouped by the shared taxonomy (Minis, Juniors, Youth, Girls, Adult Men, Adult Women). */
  groups: { group: DirectoryGroup; teams: ClubTeam[] }[]
  folded: ClubTeam[]
}

export async function readClubTeams(supabase: Client, clubId: string): Promise<ClubTeamsDirectory> {
  const [{ data: club }, { data: rows, error }, { data: types }] = await Promise.all([
    supabase.from("clubs").select("club_directory(rugby_code)").eq("id", clubId).maybeSingle(),
    supabase
      .from("teams")
      .select("id, display_name, category, age_group, gender, squad_designation, rugby_code, canonical_team_type_id, active, folded_at, fold_reason, team_aliases(alias)")
      .eq("club_id", clubId)
      .order("category")
      .order("age_group"),
    supabase.from("canonical_team_types").select("id, key, sort_order"),
  ])
  if (error) throw error
  const code = club?.club_directory?.rugby_code
  const rugbyCode: RugbyCode | null = code === "union" || code === "league" ? code : null
  const keyById = new Map((types ?? []).map((t) => [t.id, t.key]))
  const sortById = new Map((types ?? []).map((t) => [t.id, t.sort_order]))

  const teams: ClubTeam[] = (rows ?? []).map((t) => {
    const aliasRel = t.team_aliases as unknown as { alias: string }[] | { alias: string } | null
    const alias = Array.isArray(aliasRel) ? (aliasRel[0]?.alias ?? null) : (aliasRel?.alias ?? null)
    const input = { category: t.category, ageGroup: t.age_group, gender: t.gender, squadDesignation: t.squad_designation, rugbyCode: t.rugby_code, alias }
    return {
      id: t.id,
      displayName: t.display_name,
      fullLabel: fullTeamLabel(input),
      compactLabel: compactTeamLabel(input),
      category: t.category as ClubTeam["category"],
      ageGroup: t.age_group,
      gender: t.gender,
      squadDesignation: t.squad_designation,
      rugbyCode: t.rugby_code as RugbyCode,
      canonicalTeamTypeId: t.canonical_team_type_id,
      canonicalKey: t.canonical_team_type_id ? (keyById.get(t.canonical_team_type_id) ?? null) : null,
      alias,
      active: t.active,
      foldedAt: t.folded_at,
      foldReason: t.fold_reason,
    }
  })

  const active = teams.filter((t) => t.active)
  const byId = new Map(active.map((t) => [t.id, t]))
  const rowsForDirectory = active.map((t) => ({ id: t.id, category: t.category, ageGroup: t.ageGroup, gender: t.gender, squadDesignation: t.squadDesignation, isActive: true, sortOrder: t.canonicalTeamTypeId ? (sortById.get(t.canonicalTeamTypeId) ?? 999) : 999 }))
  const groups: ClubTeamsDirectory["groups"] = buildDirectory(rowsForDirectory, rugbyCode, new Map(active.map((t) => [t.id, t.alias])))
    .map((g) => ({ group: g.group, teams: g.identities.map((i) => byId.get(i.id)).filter((t): t is ClubTeam => !!t) }))
    .filter((g) => g.teams.length > 0)
  return { rugbyCode, teams, groups, folded: teams.filter((t) => !t.active) }
}

/** The catalogue a club may add from, and which entries it has already used -- the same computation the website's picker uses. */
export async function readTeamCatalogue(supabase: Client, rugbyCode: RugbyCode, teams: ClubTeam[]): Promise<{ groups: TeamCategoryGroup[]; availability: TeamOptionAvailability[] }> {
  const groups = await loadTeamCategoryGroups(supabase, { rugbyCode })
  const availability = computeTeamAvailability(
    groups,
    teams.map((t) => ({ teamId: t.id, canonicalTypeKey: t.canonicalKey, squadDesignation: t.squadDesignation, active: t.active }))
  )
  return { groups, availability }
}

/** The domain operation: add a team by its canonical key and optional B/C squad letter. Returns the team id. */
export async function createClubTeam(supabase: Client, clubId: string, canonicalKey: string, squadLetter: string | null): Promise<string> {
  const { data, error } = await supabase.rpc("create_club_team", { p_club_id: clubId, p_canonical_team_type_key: canonicalKey, p_squad_letter: squadLetter ?? undefined })
  if (error) throw error
  return data as string
}

/** Folding needs a reason the server requires; the fixtures it cancels are returned as a count. */
export async function foldTeam(supabase: Client, teamId: string, reason: string): Promise<number> {
  const { data, error } = await supabase.rpc("fold_team", { p_team_id: teamId, p_reason: reason })
  if (error) throw error
  return (data as number) ?? 0
}

export async function reactivateTeam(supabase: Client, teamId: string): Promise<void> {
  const { error } = await supabase.rpc("reactivate_team", { p_team_id: teamId })
  if (error) throw error
}

/** An alias is what the club calls a B or C squad ("Blacks" rather than "B"). Only such a squad may carry one. */
export function aliasAllowed(team: Pick<ClubTeam, "squadDesignation">): boolean {
  const squad = normalizedSquad(team.squadDesignation)
  return squad === "B" || squad === "C"
}

export async function setTeamAlias(supabase: Client, teamId: string, alias: string): Promise<void> {
  const { error } = await supabase.rpc("set_team_alias", { p_team_id: teamId, p_alias: alias })
  if (error) throw error
}

export async function clearTeamAlias(supabase: Client, teamId: string): Promise<void> {
  const { error } = await supabase.rpc("clear_team_alias", { p_team_id: teamId })
  if (error) throw error
}

export interface TeamCapabilities {
  /** team.team.view at the club */
  view: boolean
  /** team.team.manage at the club: add teams, set an alias */
  manage: boolean
  /** team.lifecycle.manage at the club: fold, reactivate */
  lifecycle: boolean
}

/** One round trip; every action still asks its own key on the server. */
export async function readTeamCapabilities(supabase: Client, clubId: string): Promise<TeamCapabilities> {
  const { data, error } = await supabase.rpc("my_capabilities", { p_scope_type: "club", p_club_id: clubId })
  if (error) return { view: false, manage: false, lifecycle: false }
  const allowed = new Set((data ?? []).filter((r) => r.allowed === true).map((r) => r.capability_key))
  return { view: allowed.has("team.team.view"), manage: allowed.has("team.team.manage"), lifecycle: allowed.has("team.lifecycle.manage") }
}

export function teamErrorMessage(error: unknown, fallback: string): string {
  const e = (error ?? {}) as { code?: string; message?: string }
  if (e.code === "42501" || e.code === "22023" || e.code === "23505" || e.code === "23514" || e.code === "P0001" || e.code === "P0002") return e.message || fallback
  return fallback
}
