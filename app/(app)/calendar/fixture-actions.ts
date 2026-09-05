"use server"

import { revalidatePath } from "next/cache"

import { dateWithinAnySeason, type SeasonRow } from "@/lib/calendar/season-window"
import { teamsCanPlayFixture } from "@/lib/fixtures/eligibility"
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
}

export interface OpponentMatchResult {
  matches: TeamSearchResult[]
  allClubTeams: TeamSearchResult[]
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
export async function findMatchingOpponentTeamsForClub(owningTeamId: string, opponentClubId: string): Promise<OpponentMatchResult> {
  const supabase = await createClient()

  const { data: owningTeam } = await supabase.from("teams").select("rugby_code, category, age_group, gender").eq("id", owningTeamId).maybeSingle()
  if (!owningTeam) return { matches: [], allClubTeams: [] }

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
  })

  const allClubTeams = (clubTeams ?? []).map(toResult)
  const owningFields = { rugbyCode: owningTeam.rugby_code, category: owningTeam.category, ageGroup: owningTeam.age_group, teamNumber: null, gender: owningTeam.gender }
  const matches = (clubTeams ?? [])
    .filter((t) => teamsCanPlayFixture(owningFields, { rugbyCode: t.rugby_code, category: t.category, ageGroup: t.age_group, teamNumber: null, gender: t.gender }))
    .map(toResult)
  return { matches, allClubTeams }
}

export type FixtureActionResult = { ok: true } | { ok: false; error: string }

export interface UpdateCalendarFixtureInput {
  fixtureId: string
  kickoffDate: string
  kickoffTime: string | null
  status: string
  competitionEditionId: string | null
  pitchId: string | null
  notes: string | null
}

/**
 * Pre-Season/Main-Season date-boundary addendum, Section 7: re-derives
 * the fixture's own club + rugby_code (never trusts a client-supplied
 * season/range) and rejects a kickoffDate that falls within NONE of that
 * club's configured seasons. Permissive when the club has no season data
 * at all (nothing to violate) -- only fails closed once real season rows
 * exist and disagree with the submitted date. Same shared resolver
 * Calendar's own navigation bounds itself to, never a second copy.
 */
async function validateFixtureDateAgainstClubSeasons(
  supabase: Awaited<ReturnType<typeof createClient>>,
  fixtureId: string,
  kickoffDate: string
): Promise<string | null> {
  const { data: fixture } = await supabase.from("fixtures").select("owning_team_id").eq("id", fixtureId).maybeSingle()
  if (!fixture) return null
  const { data: team } = await supabase.from("teams").select("club_id, rugby_code").eq("id", fixture.owning_team_id).maybeSingle()
  if (!team) return null

  const { data: seasonRows } = await supabase
    .from("seasons")
    .select("id, name, season_ref, rugby_code, pre_season_starts_on, starts_on, ends_on")
    .eq("rugby_code", team.rugby_code)
    .eq("is_regression_fixture", false)
  if (!seasonRows || seasonRows.length === 0) return null

  const seasons: SeasonRow[] = seasonRows.map((s) => ({
    id: s.id,
    name: s.name,
    seasonRef: s.season_ref,
    rugbyCode: s.rugby_code,
    preSeasonStartsOn: s.pre_season_starts_on,
    startsOn: s.starts_on,
    endsOn: s.ends_on,
  }))
  if (!dateWithinAnySeason(seasons, kickoffDate)) {
    return "That date falls outside every configured season (Pre-Season through Main Season End) for this fixture's club. Choose a date within a real season window."
  }
  return null
}

/**
 * Plain field update -- date/kickoff/status/competition/pitch/notes --
 * relying entirely on fixtures_update_scoped RLS (either side's team
 * manager, matching the Master Fixture Registry consolidation's widened
 * policy) exactly like the Site Admin fixture-detail edit path does; this
 * action performs no authorization check of its own. Home/Away and
 * opposition changes route through the dedicated swap_fixture_home_away /
 * update_fixture_opposition RPCs instead (see below) -- not this plain path.
 */
export async function updateCalendarFixture(input: UpdateCalendarFixtureInput): Promise<FixtureActionResult> {
  const supabase = await createClient()
  const dateError = await validateFixtureDateAgainstClubSeasons(supabase, input.fixtureId, input.kickoffDate)
  if (dateError) return { ok: false, error: dateError }
  const { error } = await supabase
    .from("fixtures")
    .update({
      kickoff_date: input.kickoffDate,
      kickoff_time: input.kickoffTime,
      status: input.status,
      competition_edition_id: input.competitionEditionId,
      pitch_id: input.pitchId,
      notes: input.notes,
    })
    .eq("id", input.fixtureId)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/calendar")
  revalidatePath("/calendar/agenda")
  return { ok: true }
}

export async function updateCalendarFixtureOpposition(input: {
  fixtureId: string
  opponentTeamId: string | null
  opponentDirectoryId: string | null
  rawOppositionText: string
}): Promise<FixtureActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("update_fixture_opposition", {
    p_fixture_id: input.fixtureId,
    p_opponent_team_id: input.opponentTeamId as unknown as string,
    p_opponent_directory_id: input.opponentDirectoryId as unknown as string,
    p_raw_opposition_text: input.rawOppositionText,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/calendar")
  revalidatePath("/calendar/agenda")
  return { ok: true }
}

export async function swapCalendarFixtureHomeAway(fixtureId: string): Promise<FixtureActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("swap_fixture_home_away", { p_fixture_id: fixtureId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/calendar")
  revalidatePath("/calendar/agenda")
  return { ok: true }
}
