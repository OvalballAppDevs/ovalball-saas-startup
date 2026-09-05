import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"
import { resolveClubLogoUrl } from "@/lib/app-context/club-logo"
import { loadOpponentGroupLabels } from "@/lib/calendar/resolve-entry-participant"
import { resolveHomeAwayGroupIds } from "@/lib/fixtures/resolve-home-away-groups"
import { fullTeamLabel } from "@/lib/teams/compact-label"

import type { AdminFixtureQuery, AdminFixtureRow } from "./types"

/**
 * The master table's Home/Away Team columns must show the FULL canonical
 * Team Directory name (Reconciliation complaint 8), derived from the
 * team's own structured fields -- never the raw, sometimes-stale
 * teams.display_name (see the view's own comment). Falls back to the
 * view's display-name column when there's no resolved team on that side
 * (an unresolved/external opponent) -- there's nothing structured to
 * derive from in that case.
 */
export function resolvedTeamName(
  category: string | null,
  ageGroup: string | null,
  gender: string | null,
  squadDesignation: string | null,
  fallback: string | null,
  alias?: string | null
): string {
  if (!category) return fallback ?? ""
  return fullTeamLabel({ category, ageGroup, gender, squadDesignation, alias })
}

/**
 * Shared by the list page and CSV export, mirroring admin/clubs and
 * admin/users' own query.ts reasoning. `clubId` (optional) scopes the
 * result to fixtures where that club is either side (owning or
 * opponent) -- used by the club-level fixture export
 * (app/(app)/fixtures/actions.ts), which reuses this exact query builder
 * and view rather than a second one. Site Admin's own usage never passes
 * it, so its existing unrestricted behaviour is completely unchanged.
 */
export function buildAdminFixtureQuery(supabase: SupabaseClient<Database>, query: AdminFixtureQuery, clubId?: string) {
  let q = supabase.from("admin_fixture_overview").select("*", { count: "exact" })

  // Reconciliation complaint 32: never list both sides of a legacy
  // pre-consolidation mirror pair as two separate rows -- is_primary_mirror
  // is a stable, deterministic computed column (true for an unmirrored
  // fixture or the lower-id side of a pair) so this stays correct across
  // pagination, unlike an in-memory per-page filter.
  q = q.eq("is_primary_mirror", true)

  if (clubId) {
    q = q.or(`owning_club_id.eq.${clubId},opponent_club_id.eq.${clubId}`)
  }

  if (query.q.length >= 2) {
    const escaped = query.q.replace(/[%_]/g, (c) => `\\${c}`)
    q = q.or(
      `owning_club_name.ilike.%${escaped}%,owning_team_name.ilike.%${escaped}%,raw_opposition_text.ilike.%${escaped}%,opponent_club_name.ilike.%${escaped}%,competition_name.ilike.%${escaped}%,venue_name.ilike.%${escaped}%`
    )
  }

  const today = new Date().toISOString().slice(0, 10)
  if (query.date === "upcoming") q = q.gte("kickoff_date", today)
  else if (query.date === "past") q = q.lt("kickoff_date", today)

  if (query.status !== "all") q = q.eq("status", query.status)
  if (query.code !== "all") q = q.eq("rugby_code", query.code)
  if (query.source !== "all") q = q.eq("source", query.source)
  if (query.resultStatus !== "all") q = q.eq("result_status", query.resultStatus)
  if (query.competitionEditionId) q = q.eq("competition_edition_id", query.competitionEditionId)

  switch (query.sort) {
    case "date-desc":
      q = q.order("kickoff_date", { ascending: false })
      break
    case "club":
      q = q.order("owning_club_name", { ascending: true })
      break
    case "created-desc":
      q = q.order("created_at", { ascending: false })
      break
    case "updated-desc":
      q = q.order("updated_at", { ascending: false })
      break
    case "date-asc":
    default:
      q = q.order("kickoff_date", { ascending: true })
      break
  }

  return q
}

export function mapAdminFixtureRow(row: Database["public"]["Views"]["admin_fixture_overview"]["Row"]): AdminFixtureRow {
  return {
    id: row.id ?? "",
    kickoffDate: row.kickoff_date ?? "",
    kickoffTime: row.kickoff_time,
    homeAway: row.home_away ?? "TBD",
    status: row.status ?? "Planned",
    gameType: row.game_type,
    source: row.source ?? "club_created",
    rawOppositionText: row.raw_opposition_text ?? "",
    seasonLabel: row.season_label,
    owningTeamId: row.owning_team_id ?? "",
    owningTeamName: row.owning_team_name ?? "",
    rugbyCode: row.rugby_code ?? "union",
    owningClubId: row.owning_club_id ?? "",
    owningDirectoryId: row.owning_directory_id ?? "",
    owningClubName: row.owning_club_name ?? "",
    opponentClubName: row.opponent_club_name,
    opponentTeamName: row.opponent_team_name,
    opponentTeamId: row.opponent_team_id,
    opponentClubId: row.opponent_club_id,
    opponentDirectoryId: row.opponent_directory_id,
    opponentTeamCategory: row.opponent_team_category,
    opponentTeamAgeGroup: row.opponent_team_age_group,
    opponentTeamGender: row.opponent_team_gender,
    opponentTeamSquadDesignation: row.opponent_team_squad_designation,
    opponentTeamRugbyCode: row.opponent_team_rugby_code,
    homeClubName: row.home_club_name ?? "",
    homeTeamId: row.home_team_id,
    homeTeamName: resolvedTeamName(row.home_team_category, row.home_team_age_group, row.home_team_gender, row.home_team_squad_designation, row.home_team_name),
    homeTeamCategory: row.home_team_category,
    homeTeamAgeGroup: row.home_team_age_group,
    homeTeamGender: row.home_team_gender,
    homeTeamSquadDesignation: row.home_team_squad_designation,
    awayClubName: row.away_club_name ?? "",
    awayTeamId: row.away_team_id,
    awayTeamName: resolvedTeamName(row.away_team_category, row.away_team_age_group, row.away_team_gender, row.away_team_squad_designation, row.away_team_name),
    awayTeamCategory: row.away_team_category,
    awayTeamAgeGroup: row.away_team_age_group,
    awayTeamGender: row.away_team_gender,
    awayTeamSquadDesignation: row.away_team_squad_designation,
    homeClubLogoUrl: null,
    awayClubLogoUrl: null,
    homeClubResolved: row.home_club_resolved ?? true,
    awayClubResolved: row.away_club_resolved ?? true,
    competitionName: row.competition_name,
    venueName: row.venue_name,
    pitchName: row.pitch_name,
    messageCount: row.message_count ?? 0,
    cancelledAt: row.cancelled_at,
    updatedAt: row.updated_at ?? new Date(0).toISOString(),
    createdAt: row.created_at ?? new Date(0).toISOString(),
    pitchAllocation: row.pitch_allocation,
    homeScore: row.home_score,
    awayScore: row.away_score,
    resultStatus: row.result_status ?? "none",
    mirrorFixtureId: row.mirror_fixture_id,
    owningSchedulingGroupId: row.owning_scheduling_group_id,
    opponentSchedulingGroupId: row.opponent_scheduling_group_id,
  }
}

/**
 * Root-cause fix for the live "13 September U7/U8 Falcons is in Pitch
 * Allocation but not Fixture Management" report: this view's home/away
 * team names come from get_team_identity_for_season keyed off the bare
 * anchor team, with no idea a side can be a Mini-Rugby Group -- so a
 * Falcons fixture showed as a plain "U7", nothing a Club Admin scanning
 * for "U7/U8 Falcons" would recognise as the same physical fixture Pitch
 * Allocation and Calendar already label correctly. Same shared predicate
 * (resolveHomeAwayGroupIds) and the same batched label loader
 * (loadOpponentGroupLabels) those two surfaces already use -- a group's
 * display identity is resolved exactly once across the whole app, never a
 * third divergent way here.
 */
export async function attachGroupLabels(supabase: SupabaseClient<Database>, rows: AdminFixtureRow[]): Promise<AdminFixtureRow[]> {
  const referencedGroupIds = rows.flatMap((r) => {
    const { homeGroupId, awayGroupId } = resolveHomeAwayGroupIds({
      owning_team_id: r.owningTeamId,
      home_team_id: r.homeTeamId,
      owning_scheduling_group_id: r.owningSchedulingGroupId,
      opponent_scheduling_group_id: r.opponentSchedulingGroupId,
    })
    return [homeGroupId, awayGroupId]
  })
  if (referencedGroupIds.every((id) => !id)) return rows

  const groupLabelById = await loadOpponentGroupLabels(supabase, referencedGroupIds)
  if (groupLabelById.size === 0) return rows

  return rows.map((r) => {
    const { homeGroupId, awayGroupId } = resolveHomeAwayGroupIds({
      owning_team_id: r.owningTeamId,
      home_team_id: r.homeTeamId,
      owning_scheduling_group_id: r.owningSchedulingGroupId,
      opponent_scheduling_group_id: r.opponentSchedulingGroupId,
    })
    return {
      ...r,
      homeTeamName: (homeGroupId && groupLabelById.get(homeGroupId)) || r.homeTeamName,
      awayTeamName: (awayGroupId && groupLabelById.get(awayGroupId)) || r.awayTeamName,
      owningTeamName: (r.owningSchedulingGroupId && groupLabelById.get(r.owningSchedulingGroupId)) || r.owningTeamName,
      opponentTeamName: (r.opponentSchedulingGroupId && groupLabelById.get(r.opponentSchedulingGroupId)) || r.opponentTeamName,
    }
  })
}

/**
 * Fixture Management's Home/Away Team columns previously never reflected
 * a B/C squad's display alias -- resolvedTeamName() had no alias to pass,
 * so a team renamed "U12 Blacks" everywhere else (Calendar, Teams,
 * Pitch Allocation) still showed as "U12 B" here (found live: "if the B
 * has changed its name to blacks, all the connecting mechanisms... should
 * change to Blacks"). Same batched-lookup shape as attachClubLogos right
 * below -- one query keyed off the home/away team ids already on each
 * row, then resolvedTeamName is re-run per side with the alias now known.
 */
export async function attachTeamAliases(supabase: SupabaseClient<Database>, rows: AdminFixtureRow[]): Promise<AdminFixtureRow[]> {
  const teamIds = [...new Set(rows.flatMap((r) => [r.homeTeamId, r.awayTeamId]).filter((id): id is string => Boolean(id)))]
  if (teamIds.length === 0) return rows

  const { data: aliases } = await supabase.from("team_aliases").select("team_id, alias").in("team_id", teamIds)
  const aliasByTeamId = new Map((aliases ?? []).map((a) => [a.team_id, a.alias]))
  if (aliasByTeamId.size === 0) return rows

  return rows.map((r) => ({
    ...r,
    homeTeamName: r.homeTeamId && aliasByTeamId.has(r.homeTeamId)
      ? resolvedTeamName(r.homeTeamCategory, r.homeTeamAgeGroup, r.homeTeamGender, r.homeTeamSquadDesignation, r.homeTeamName, aliasByTeamId.get(r.homeTeamId))
      : r.homeTeamName,
    awayTeamName: r.awayTeamId && aliasByTeamId.has(r.awayTeamId)
      ? resolvedTeamName(r.awayTeamCategory, r.awayTeamAgeGroup, r.awayTeamGender, r.awayTeamSquadDesignation, r.awayTeamName, aliasByTeamId.get(r.awayTeamId))
      : r.awayTeamName,
  }))
}

/**
 * Club-identity foundation pass: the master fixture table never had a
 * crest at all (not a caching bug -- ClubAvatar simply wasn't wired in
 * here yet, unlike Messages/Partner Clubs/Fixture Detail/Dashboard, which
 * already render every club identity through it). One batched query
 * keyed off the real owning/opponent club ids already on each row, rather
 * than a per-row fetch or a new view column -- `clubs.logo_storage_path`
 * is the exact same canonical field ClubAvatar's other callers already
 * read, so a logo changed in Club settings shows here immediately on the
 * next render, with zero extra propagation logic to get wrong.
 */
export async function attachClubLogos(supabase: SupabaseClient<Database>, rows: AdminFixtureRow[]): Promise<AdminFixtureRow[]> {
  const clubIds = [...new Set(rows.flatMap((r) => [r.owningClubId, r.opponentClubId]).filter((id): id is string => Boolean(id)))]
  if (clubIds.length === 0) return rows

  const { data: clubs } = await supabase.from("clubs").select("id, logo_storage_path, club_directory(logo_storage_path)").in("id", clubIds)
  const logoByClubId = new Map((clubs ?? []).map((c) => [c.id, resolveClubLogoUrl(supabase, c)]))

  return rows.map((r) => {
    const isHome = r.homeAway !== "Away"
    const homeClubId = isHome ? r.owningClubId : r.opponentClubId
    const awayClubId = isHome ? r.opponentClubId : r.owningClubId
    return {
      ...r,
      homeClubLogoUrl: (homeClubId && logoByClubId.get(homeClubId)) || null,
      awayClubLogoUrl: (awayClubId && logoByClubId.get(awayClubId)) || null,
    }
  })
}
