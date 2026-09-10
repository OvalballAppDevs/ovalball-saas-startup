import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

/**
 * Everything the tournament builder needs, in one bounded read.
 *
 * RUGBY CODE ISOLATION IS DONE IN THE QUERY. A Union club is never sent the
 * League catalogue -- not as an option, not disabled, not as a "not offered"
 * note. Loading both and hiding one works right up until somebody renders the
 * unfiltered array.
 */

export interface BuilderTeam {
  id: string
  displayName: string
  ageGroup: string | null
}

export interface BuilderPitch {
  id: string
  displayName: string
}

export interface BuilderVenue {
  id: string
  name: string
}

export interface BuilderTeamType {
  id: string
  label: string
  sortOrder: number
}

export interface TournamentBuilderOptions {
  clubId: string
  clubName: string
  rugbyCode: "union" | "league"
  teams: BuilderTeam[]
  pitches: BuilderPitch[]
  venues: BuilderVenue[]
  teamTypes: BuilderTeamType[]
}

export async function getTournamentBuilderOptions(
  supabase: SupabaseClient<Database>,
  clubId: string
): Promise<TournamentBuilderOptions | null> {
  const { data: club } = await supabase
    .from("clubs")
    .select("id, club_directory(name, rugby_code)")
    .eq("id", clubId)
    .maybeSingle()
  if (!club?.club_directory) return null

  const rugbyCode = club.club_directory.rugby_code as "union" | "league"

  const [teamsRes, pitchesRes, venuesRes, typesRes] = await Promise.all([
    supabase
      .from("teams")
      .select("id, display_name, age_group, rugby_code, active")
      .eq("club_id", clubId)
      .eq("rugby_code", rugbyCode)
      .eq("active", true)
      .order("age_group", { ascending: true, nullsFirst: false })
      .order("display_name"),
    supabase.from("club_pitches").select("id, display_name").eq("club_id", clubId).eq("active", true).order("sort_order"),
    supabase.from("venues").select("id, name").eq("club_id", clubId).eq("active", true).order("is_default_home", { ascending: false }).order("name"),
    // The canonical closed catalogue, scoped to this club's code and to the
    // identities that code actually offers.
    supabase.from("canonical_team_types_by_code").select("id, label, sort_order, rugby_code, is_offered").eq("rugby_code", rugbyCode).eq("is_offered", true).order("sort_order"),
  ])

  return {
    clubId,
    clubName: club.club_directory.name,
    rugbyCode,
    teams: (teamsRes.data ?? []).map((t) => ({ id: t.id, displayName: t.display_name, ageGroup: t.age_group })),
    pitches: (pitchesRes.data ?? []).map((p) => ({ id: p.id, displayName: p.display_name })),
    venues: (venuesRes.data ?? []).map((v) => ({ id: v.id, name: v.name })),
    teamTypes: (typesRes.data ?? []).map((t) => ({ id: t.id as string, label: t.label as string, sortOrder: (t.sort_order as number) ?? 0 })),
  }
}
