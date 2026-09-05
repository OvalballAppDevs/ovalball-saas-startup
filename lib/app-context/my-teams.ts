import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import type { SwitchableContext } from "./active-context"
import type { SessionContext } from "./session-context"

export interface MyTeam {
  id: string
  displayName: string
  category: string
  ageGroup: string | null
  gender: string | null
  squadDesignation: string | null
  /** Club-specific display alias (e.g. "Blacks") -- Overnight Master Pass Section 51, null when this team has none set. */
  alias: string | null
}

const TEAM_FIELDS = "id, display_name, category, age_group, gender, squad_designation"

interface RawTeamRow {
  id: string
  display_name: string
  category: string
  age_group: string | null
  gender: string | null
  squad_designation: string | null
}

/**
 * Aliases are fetched as a SEPARATE query (rather than an embedded
 * `team_aliases(alias)` select) purely to dodge a Supabase-generated-types
 * recursion issue (`Type instantiation is excessively deep`) that embed
 * triggers when combined with `.in()` on this table -- functionally
 * identical to an embed, just two round trips instead of one.
 */
async function withAliases(supabase: SupabaseClient<Database>, rows: RawTeamRow[]): Promise<MyTeam[]> {
  const ids = rows.map((r) => r.id)
  const { data: aliasRows } =
    ids.length > 0 ? await supabase.from("team_aliases").select("team_id, alias").in("team_id", ids) : { data: [] }
  const aliasByTeamId = new Map((aliasRows ?? []).map((a) => [a.team_id, a.alias]))
  return rows.map((t) => ({
    id: t.id,
    displayName: t.display_name,
    category: t.category,
    ageGroup: t.age_group,
    gender: t.gender,
    squadDesignation: t.squad_designation,
    alias: aliasByTeamId.get(t.id) ?? null,
  }))
}

/**
 * Every team this session should see as "mine" for calendar/dashboard
 * purposes: explicit team_permissions assignments, plus every active team
 * at a club where they hold club-wide fixture authority (CLUB_ADMIN /
 * FIXTURE_SECRETARY). Shared by dashboard-data.ts and the calendar page so
 * "which teams count as mine" is defined exactly once. Carries the raw
 * structured fields (category/age_group/gender/squad_designation), not
 * just the free-text display_name -- calendar surfaces derive their own
 * compact label from these (see lib/teams/compact-label.ts) rather than
 * trusting whatever a club admin happened to type into display_name,
 * which real data shows is inconsistently maintained.
 */
export async function getMyTeams(supabase: SupabaseClient<Database>, ctx: SessionContext): Promise<MyTeam[]> {
  const clubWideClubIds = ctx.clubMemberships
    .filter((m) => m.role === "CLUB_ADMIN" || m.role === "FIXTURE_SECRETARY")
    .map((m) => m.clubId)

  const rows = new Map<string, RawTeamRow>()

  const permissionTeamIds = ctx.teamPermissions.map((tp) => tp.teamId)
  if (permissionTeamIds.length > 0) {
    const { data: permissionTeams } = await supabase.from("teams").select(TEAM_FIELDS).in("id", permissionTeamIds)
    for (const t of permissionTeams ?? []) rows.set(t.id, t)
  }

  if (clubWideClubIds.length > 0) {
    const { data: clubTeams } = await supabase.from("teams").select(TEAM_FIELDS).in("club_id", clubWideClubIds).eq("active", true)
    for (const t of clubTeams ?? []) rows.set(t.id, t)
  }

  return withAliases(supabase, Array.from(rows.values()))
}

/**
 * "My teams" narrowed to whichever context is currently active -- see
 * active-context.ts. A club context shows that one club's active teams
 * (never a different club the session also happens to hold authority at);
 * a team context shows only that single team; a Site Admin context has no
 * team obligations of its own. Session-derived context-scoping only, same
 * caveat as getMyTeams: never itself a permission check.
 */
export async function getTeamsForActiveContext(
  supabase: SupabaseClient<Database>,
  ctx: SessionContext,
  activeContext: SwitchableContext
): Promise<MyTeam[]> {
  if (activeContext.kind === "team" || activeContext.kind === "parent" || activeContext.kind === "player") {
    // "parent"'s and "player"'s activeContext.id are both a TEAM id (see
    // active-context.ts's SwitchableContext.key format), same shape as
    // "team" -- exactly one team, read-only for a parent/player, never
    // every team at the club.
    if (!activeContext.id) return []
    const { data: team } = await supabase.from("teams").select(TEAM_FIELDS).eq("id", activeContext.id).maybeSingle()
    if (!team) return []
    return withAliases(supabase, [team])
  }

  if (activeContext.kind === "site_admin") {
    return []
  }

  if (!activeContext.id) return []

  const { data: clubTeams } = await supabase.from("teams").select(TEAM_FIELDS).eq("club_id", activeContext.id).eq("active", true)

  return withAliases(supabase, clubTeams ?? [])
}
