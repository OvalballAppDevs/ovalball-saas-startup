import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import type { AwardCategoryKey } from "./rewards"

type Client = SupabaseClient<Database>

/**
 * WHICH MATCH AWARDS A SIDE RUNS -- club default, team override, fixture effective (owner brief,
 * 2026-10-03).
 *
 *   CLUB DEFAULT    `club_award_category_settings`: what every team at the club runs
 *        ↓
 *   TEAM OVERRIDE   `team_award_category_settings`: a team switching one on or off for itself
 *        ↓
 *   FIXTURE         `internal.match_award_enabled`: the team's own choice if it made one, otherwise
 *                   the club's, otherwise off -- read live, so a change applies to the next match
 *
 * `effectiveAwardEnabled` below is that same rule for drawing a screen; the database's is the one that
 * decides, and every write is checked there (club settings or profile authority for the club default,
 * the team's news authority for an override).
 */
export interface AwardCategory {
  key: AwardCategoryKey
  youthName: string
  adultName: string
}

export interface ClubAwardSettings {
  categories: AwardCategory[]
  /** The club's default per award. An award the club has never set is off. */
  clubDefaults: Record<string, boolean>
  /** teamId -> categoryKey -> the team's own choice. Absent means it follows the club. */
  teamOverrides: Record<string, Record<string, boolean>>
}

export async function readClubAwardSettings(supabase: Client, clubId: string, teamIds: string[]): Promise<ClubAwardSettings> {
  const [categories, club, teams] = await Promise.all([
    supabase.from("match_award_categories").select("category_key, name_youth, name_adult, sort_order").eq("active", true).order("sort_order"),
    supabase.from("club_award_category_settings").select("category_key, enabled").eq("club_id", clubId),
    teamIds.length > 0
      ? supabase.from("team_award_category_settings").select("team_id, category_key, enabled").in("team_id", teamIds)
      : Promise.resolve({ data: [] as { team_id: string; category_key: string; enabled: boolean }[], error: null }),
  ])
  if (categories.error) throw categories.error
  if (club.error) throw club.error
  if (teams.error) throw teams.error
  const teamOverrides: Record<string, Record<string, boolean>> = {}
  for (const row of teams.data ?? []) {
    teamOverrides[row.team_id] = { ...(teamOverrides[row.team_id] ?? {}), [row.category_key]: row.enabled }
  }
  return {
    categories: (categories.data ?? []).map((c) => ({ key: c.category_key as AwardCategoryKey, youthName: c.name_youth, adultName: c.name_adult })),
    clubDefaults: Object.fromEntries((club.data ?? []).map((r) => [r.category_key, r.enabled])),
    teamOverrides,
  }
}

/** The fixture-effective answer for one team and one award, by the database's own rule. */
export function effectiveAwardEnabled(settings: ClubAwardSettings, teamId: string, key: string): boolean {
  const own = settings.teamOverrides[teamId]?.[key]
  if (own !== undefined) return own
  return settings.clubDefaults[key] ?? false
}

/** The award's name in a mixed list: one name when youth and adult agree, both when they do not. */
export function awardSettingName(category: AwardCategory): string {
  const { youthName: youth, adultName: adult } = category
  if (youth === adult) return youth
  // "Parents' Player of the Match" and "Players' Player of the Match" share their words after the first,
  // so the pair reads "Parents' / Players' Player of the Match" rather than the whole title twice.
  const [y, ...yRest] = youth.split(" ")
  const [a, ...aRest] = adult.split(" ")
  return yRest.join(" ") === aRest.join(" ") && yRest.length > 0 ? `${y} / ${a} ${yRest.join(" ")}` : `${youth} / ${adult}`
}

export async function setClubAwardCategory(supabase: Client, clubId: string, key: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_club_award_category", { p_club_id: clubId, p_category_key: key, p_enabled: enabled })
  if (error) throw error
}

/** A team's own choice for one award; `null` hands the choice back to the club's default. */
export async function setTeamAwardChoice(supabase: Client, teamId: string, key: string, enabled: boolean | null): Promise<void> {
  const { error } =
    enabled === null
      ? await supabase.rpc("clear_team_award_category", { p_team_id: teamId, p_category_key: key })
      : await supabase.rpc("set_team_award_category", { p_team_id: teamId, p_category_key: key, p_enabled: enabled })
  if (error) throw error
}
