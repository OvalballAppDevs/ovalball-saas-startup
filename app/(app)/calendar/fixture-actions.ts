"use server"

import { suggestOppositionTeam } from "@/lib/fixtures/opposition-match"
import { createClient } from "@/lib/supabase/server"

export interface TeamSearchResult {
  teamId: string
  teamName: string
  clubName: string
  town: string | null
  category: string
  ageGroup: string | null
  gender: string | null
  teamNumber: number | null
  squadDesignation: string | null
  /** The opponent's own code, so their senior side is named the way THEY name it. */
  rugbyCode: string | null
}

export interface OpponentMatchResult {
  /** Eligible teams, best match first. */
  matches: TeamSearchResult[]
  allClubTeams: TeamSearchResult[]
  /** Set only when exactly one strong match exists -- the one a picker may choose for the person. */
  preselectTeamId: string | null
}

export interface RequestingTeamIdentity {
  ageGroup: string | null
  rugbyCode: string
}

/**
 * Central Fixture Participant Resolution: when a claimed opponent club has
 * no matching team, the requester may still name a structured Team
 * Directory identity for the opponent (age_group/gender/squad, never free
 * text) so the recipient can be offered a controlled "create/reactivate
 * this team" action. internal.teams_can_play_fixture requires an EXACT
 * matching age_fixture_band, so the only age_group a request can ever
 * validly name is the requester's own -- this is read-only, never a free
 * dropdown, precisely because any other value would be rejected server-
 * side anyway.
 */
export async function getRequestingTeamIdentity(teamId: string): Promise<RequestingTeamIdentity | null> {
  const supabase = await createClient()
  const { data } = await supabase.from("teams").select("age_group, rugby_code").eq("id", teamId).single()
  if (!data) return null
  return { ageGroup: data.age_group, rugbyCode: data.rugby_code }
}

/**
 * Club-scoped port of app/(app)/admin/fixtures/actions.ts's Site-Admin-only
 * findMatchingOpponentTeams -- same age-eligibility-aware matching
 * (internal.teams_can_play_fixture), same shape, but callable by any
 * authenticated user (this is a READ: club_directory/teams are already
 * public-read; only the resulting fixture WRITE is permission-checked, by
 * fixture_request_groups/fixture_requests RLS at insert time).
 */
/** The shared ranked matching (lib/fixtures/opposition-match.ts) over a picker's team results. */
function rankOpponentMatches(
  owning: { rugby_code: string; category: string; age_group: string | null; gender: string | null; squad_designation: string | null },
  teams: TeamSearchResult[],
): { matches: TeamSearchResult[]; preselectTeamId: string | null } {
  const byId = new Map(teams.map((t) => [t.teamId, t]))
  const suggestion = suggestOppositionTeam(
    { id: "ours", label: "", rugbyCode: owning.rugby_code, category: owning.category, ageGroup: owning.age_group, gender: owning.gender, squadDesignation: owning.squad_designation },
    teams.map((t) => ({ id: t.teamId, label: t.teamName, rugbyCode: t.rugbyCode ?? owning.rugby_code, category: t.category, ageGroup: t.ageGroup, gender: t.gender, squadDesignation: t.squadDesignation })),
  )
  return { matches: suggestion.ranked.map((r) => byId.get(r.team.id)!), preselectTeamId: suggestion.preselect?.id ?? null }
}

export async function findMatchingOpponentTeamsForClub(owningTeamId: string, opponentClubId: string): Promise<OpponentMatchResult> {
  const supabase = await createClient()

  const { data: owningTeam } = await supabase.from("teams").select("rugby_code, category, age_group, gender, squad_designation").eq("id", owningTeamId).maybeSingle()
  if (!owningTeam) return { matches: [], allClubTeams: [], preselectTeamId: null }

  const { data: clubTeams } = await supabase
    .from("teams")
    .select("id, display_name, rugby_code, category, age_group, squad_designation, gender, club_id, clubs!inner(club_directory!inner(name, town))")
    .eq("club_id", opponentClubId)
    .eq("active", true)
    .order("display_name")

  const toResult = (t: NonNullable<typeof clubTeams>[number]): TeamSearchResult => ({
    teamId: t.id,
    teamName: t.display_name,
    clubName: t.clubs?.club_directory?.name ?? "",
    town: t.clubs?.club_directory?.town ?? null,
    category: t.category,
    ageGroup: t.age_group,
    gender: t.gender,
    teamNumber: null,
    squadDesignation: t.squad_designation,
    rugbyCode: t.rugby_code,
  })

  const allClubTeams = (clubTeams ?? []).map(toResult)
  return { ...rankOpponentMatches(owningTeam, allClubTeams), allClubTeams }
}

export type FixtureActionResult = { ok: true } | { ok: false; error: string }

// Editing a fixture from Calendar goes through the one fixture editor
// (app/(app)/fixtures/editor/actions.ts). The plain table update, the
// opposition and the swap actions that used to live here were a second
// writer with its own field rules, and have gone.
