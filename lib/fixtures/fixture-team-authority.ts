import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { activeManageableClubId, type SwitchableContext } from "@/lib/app-context/active-context"
import { manageableTeams, type SessionContext } from "@/lib/app-context/session-context"
import { miniRugbyGroupLabel } from "@/lib/mini-rugby/group-label"
import { compactTeamLabel, fullTeamLabel } from "@/lib/teams/compact-label"
import type { Database } from "@/types/database.types"

/**
 * TWO KINDS OF FIXTURE AUTHORITY, ON PURPOSE.
 *
 * A. SINGLE-FIXTURE TEAM AUTHORITY -- a team's own staff may create or request
 *    ONE fixture for a team they run (Calendar, Request a Fixture).
 *    public.single_fixture_team_ids.
 *
 * B. CLUB/SITE BULK PLANNING AUTHORITY -- the Season Planner, fixture import
 *    and competition-wide generation are club administration: Club Admin,
 *    Fixture Secretary, Site Admin. public.can_bulk_plan_fixtures, the same
 *    predicate RLS on the staging tables and publish_import_row enforce.
 *
 * Team staff running every team at a club still hold only A. That is the
 * product rule, not an inconsistency to be smoothed over: do not widen B to
 * make a screen agree with Calendar.
 *
 * Neither function here is the boundary. The database is; these let a screen
 * offer exactly what the database will accept.
 */

export interface PlannableTeam {
  id: string
  /** The canonical display name -- what the cell holds and what validation matches. */
  label: string
  /** The rugby identifier form Calendar lanes use ("U7", "Girls U12"), searchable. */
  compact: string
  /** Club-specific squad alias, searchable, never the committed value. */
  alias: string | null
  /** Mini-Rugby Groups this team is part of, e.g. "U7/U8 Tags". Searchable context, never a creation target. */
  groups: string[]
  /** The structured identity, for matching an opposition team against it. */
  rugbyCode: string
  category: string
  ageGroup: string | null
  gender: string | null
  squadDesignation: string | null
}

export interface PlannerTeamUniverse {
  clubId: string
  teams: PlannableTeam[]
}

const TEAM_FIELDS = "id, display_name, rugby_code, category, age_group, gender, squad_designation"

/**
 * Active Mini-Rugby Group memberships for these teams, labelled by the one
 * canonical group label. Calendar's lanes and the Planner's Our Team read
 * this, so "U7/U8 Tags" is spelled and resolved in exactly one place.
 */
export async function teamGroupMemberships(
  supabase: SupabaseClient<Database>,
  teamIds: string[],
): Promise<Map<string, { id: string; label: string }[]>> {
  const out = new Map<string, { id: string; label: string }[]>()
  if (teamIds.length === 0) return out
  const { data } = await supabase
    .from("scheduling_group_members")
    .select("team_id, scheduling_groups!inner(id, display_tag, alias, active)")
    .in("team_id", teamIds)
    .eq("scheduling_groups.active", true)
  for (const gm of data ?? []) {
    const g = gm.scheduling_groups
    if (!g) continue
    const list = out.get(gm.team_id) ?? []
    list.push({ id: g.id, label: miniRugbyGroupLabel({ displayTag: g.display_tag, alias: g.alias }) })
    out.set(gm.team_id, list)
  }
  return out
}

// ---------------------------------------------------------------------------
// A. Single-fixture team authority
// ---------------------------------------------------------------------------

export async function singleFixtureTeamIds(supabase: SupabaseClient<Database>, clubId: string): Promise<Set<string>> {
  const { data, error } = await supabase.rpc("single_fixture_team_ids", { p_club_id: clubId })
  if (error) {
    console.error("single_fixture_team_ids failed:", error)
    return new Set()
  }
  return new Set((data ?? []).map((r) => r.team_id))
}

/** The same answer across several clubs, for a Calendar scope that spans them. */
export async function singleFixtureTeamIdsAcrossClubs(
  supabase: SupabaseClient<Database>,
  clubIds: string[],
): Promise<Set<string>> {
  const unique = [...new Set(clubIds.filter(Boolean))]
  const sets = await Promise.all(unique.map((c) => singleFixtureTeamIds(supabase, c)))
  return new Set(sets.flatMap((s) => [...s]))
}

/**
 * THE SITE ADMIN BYPASS FOLLOWS THE ACTIVE CONTEXT.
 *
 * The database grants a Site Admin every team, which is right while they act
 * as Site Admin. An account that is also a coach, a club member or a parent and
 * is currently viewing in that role must not regain the platform-wide bypass
 * because it happens to hold it (lib/fixtures/fixture-authority-rule.ts). So
 * outside a Site Admin or club-authority context, a Site Admin's teams are
 * narrowed to the team authority they hold in their own right.
 */
export function actingTeamIds(ctx: SessionContext, activeContext: SwitchableContext, teamIds: Iterable<string>): Set<string> {
  const all = new Set(teamIds)
  if (!ctx.isSiteAdmin || activeContext.kind === "site_admin" || activeManageableClubId(ctx, activeContext)) return all
  const own = new Set(manageableTeams(ctx).map((t) => t.teamId))
  return new Set([...all].filter((id) => own.has(id)))
}

// ---------------------------------------------------------------------------
// B. Club/site bulk planning authority
// ---------------------------------------------------------------------------

export async function canBulkPlanFixtures(supabase: SupabaseClient<Database>, clubId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("can_bulk_plan_fixtures", { p_club_id: clubId })
  if (error) {
    console.error("can_bulk_plan_fixtures failed:", error)
    return false
  }
  return data === true
}

/**
 * Whether the ACTIVE CONTEXT may act on bulk authority at this club.
 *
 * The database answers for the account. The active-context rule narrows a Site
 * Admin to acting as Site Admin (or as a club administrator they genuinely
 * are): a Site Admin viewing as a parent does not open another club's Season
 * Planner by naming it.
 */
export function actingBulkAuthority(ctx: SessionContext, activeContext: SwitchableContext, clubId: string): boolean {
  if (!ctx.isSiteAdmin || activeContext.kind === "site_admin") return true
  return ctx.clubMemberships.some((m) => m.clubId === clubId && (m.role === "CLUB_ADMIN" || m.role === "FIXTURE_SECRETARY"))
}

/**
 * The labelled Our Team list for the Planner: every active team at the club,
 * for somebody with bulk planning authority there -- and nothing for anybody
 * else, because nobody else has a Planner.
 */
export async function plannerTeamUniverse(
  supabase: SupabaseClient<Database>,
  clubId: string,
): Promise<PlannerTeamUniverse | null> {
  if (!(await canBulkPlanFixtures(supabase, clubId))) return null

  const { data: rows } = await supabase
    .from("teams")
    .select(TEAM_FIELDS)
    .eq("club_id", clubId)
    .eq("active", true)
    .order("category")
    .order("age_group")
  const teamIds = (rows ?? []).map((t) => t.id)
  const [{ data: aliasRows }, groups] = await Promise.all([
    teamIds.length > 0
      ? supabase.from("team_aliases").select("team_id, alias").in("team_id", teamIds)
      : Promise.resolve({ data: [] as { team_id: string; alias: string }[] }),
    teamGroupMemberships(supabase, teamIds),
  ])
  const aliasByTeam = new Map((aliasRows ?? []).map((a) => [a.team_id, a.alias]))

  return {
    clubId,
    teams: (rows ?? []).map((t) => {
      const fields = {
        category: t.category,
        ageGroup: t.age_group,
        gender: t.gender,
        squadDesignation: t.squad_designation,
        rugbyCode: t.rugby_code,
      }
      return {
        id: t.id,
        label: fullTeamLabel(fields),
        compact: compactTeamLabel(fields),
        alias: aliasByTeam.get(t.id) ?? null,
        groups: (groups.get(t.id) ?? []).map((g) => g.label),
        ...fields,
      }
    }),
  }
}

/**
 * WHICH CLUB IS BEING PLANNED FOR.
 *
 * A club context plans its own club. Anybody else names a club explicitly (the
 * chooser, or a Site Admin) and is put through exactly the same bulk authority
 * check. A team context is not a route in: its authority is single fixtures.
 */
export function plannerClubFor(
  ctx: SessionContext,
  activeContext: SwitchableContext,
  requestedClubId?: string | null,
): string | null {
  return activeManageableClubId(ctx, activeContext) ?? requestedClubId ?? null
}

/** Clubs worth offering in the chooser: club-scope fixture administration only. */
export function plannerClubCandidates(ctx: SessionContext): { id: string; name: string }[] {
  return ctx.clubMemberships
    .filter((m) => m.role === "CLUB_ADMIN" || m.role === "FIXTURE_SECRETARY")
    .map((m) => ({ id: m.clubId, name: m.clubName ?? "Your club" }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
