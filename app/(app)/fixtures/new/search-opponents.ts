"use server"

import { createClient } from "@/lib/supabase/server"

export interface OpponentSearchResult {
  directoryId: string
  name: string
  town: string | null
  clubId: string | null
}

/**
 * club_directory is public-read (club_directory_select: active = true or
 * is_site_admin()), so this is no more sensitive than the signup wizard's
 * own club search -- reused pattern, not a new exposure.
 */
export async function searchOpponentClubs(query: string): Promise<OpponentSearchResult[]> {
  if (query.trim().length < 2) return []

  const supabase = await createClient()
  const { data } = await supabase
    .from("club_directory")
    .select("id, name, town, clubs(id)")
    .eq("active", true)
    .ilike("name", `%${query.trim()}%`)
    .limit(8)

  return (data ?? []).map((d) => ({
    directoryId: d.id,
    name: d.name,
    town: d.town,
    // clubs.directory_id is unique, so this embed is to-one, not an array.
    clubId: d.clubs?.id ?? null,
  }))
}

export interface CompatibleTeam {
  teamId: string
  displayName: string
}

export interface CompatibleIdentity {
  ageGroup: string
  gender: string
  label: string
}

/**
 * WHICH OF THEIR TEAMS COULD WE ACTUALLY PLAY.
 *
 * The flow used to ask the opponent's CLUB and then, if the requester happened to know their team did
 * not exist yet, let them name an age grade from the whole youth list. So an under-12 side could
 * address a request to an under-16 identity, and nothing said otherwise until the request was refused
 * -- after somebody at the other club had read it.
 *
 * Both readers are the database's, and both delegate to internal.identities_can_play_fixture -- the
 * same rule the trigger on fixture_requests enforces. That is the point: the list a person chooses
 * from and the rule that judges their choice cannot be different rules, because they are one rule.
 *
 * Neither reader is a filter over a full list. The server never sends the incompatible teams, so
 * there is nothing to reveal by inspecting the page, and both refuse outright unless the caller holds
 * fixture request or create authority for the asking team.
 */
export async function loadCompatibleOpponentTeams(teamId: string, opponentClubId: string): Promise<CompatibleTeam[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc("compatible_opponent_teams", {
    p_team_id: teamId,
    p_opponent_club_id: opponentClubId,
  })
  return (data ?? []).map((t) => ({ teamId: t.team_id, displayName: t.display_name }))
}

export async function loadCompatibleOpponentIdentities(teamId: string): Promise<CompatibleIdentity[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc("compatible_opponent_identities", { p_team_id: teamId })
  return (data ?? []).map((i) => ({ ageGroup: i.age_group, gender: i.gender, label: i.label }))
}
