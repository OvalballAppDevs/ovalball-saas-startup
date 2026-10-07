import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { clubLogoUrlFromPath } from "../club-logo"
import { fullTeamLabel } from "../teams/compact-label"
import type { KitConfig, KitPattern } from "../agenda/kit"

type Client = SupabaseClient<Database>

/**
 * WHO IS COMING, AND AT WHICH AGE GROUP.
 *
 * A tournament is organised BY AGE GROUP. The U9 competition and the U11 competition have separate
 * fields of teams, and a side entered at one is not at the other -- so everything here is scoped by a
 * grade, and nothing returns a club's whole roster.
 *
 * TWO KINDS OF SIDE, BECAUSE THE DATABASE HAS TWO:
 *
 *   the host's own sides   ->  `tournament_team_entries`  (unique per team)
 *   every other club's     ->  `tournament_participants`  (one row per side, since 20270596)
 *
 * They are not merged into one list here. An entry is the host putting its own team in; a participant
 * is another club's side, and carries that club's directory row so that a club which is NOT on
 * Ovalball can be recorded without inventing an account for it.
 *
 * ADDED IS NOT INVITED. A club the organiser adds is `added`, full stop: there is no acceptance, no
 * pending state and nothing for that club to answer. `invite_tournament_participant` remains the
 * separate, deliberate path when somebody genuinely wants to ask.
 */

/** A club as the Add Clubs / Teams search finds it. */
export interface TournamentClubResult {
  directoryId: string
  name: string
  /** "Burnley, Lancashire" -- whatever of the two the directory actually holds. */
  location: string | null
  crestUrl: string | null
  /** True when the directory row is a club with a real Ovalball account. A false here is not a lesser
   * result: it is how a club that is not on Ovalball is entered without fabricating one. */
  onOvalball: boolean
}

/** One of a club's real sides at the age group being configured. */
export interface TournamentCandidateTeam {
  teamId: string
  /** The canonical derived name -- "Under 9 Boys", never a name typed into this screen. */
  name: string
  ageGroup: string
  canonicalTeamTypeId: string | null
}

/** The host's own side, offered automatically because the tournament runs its grade. */
export interface OurTeamOption extends TournamentCandidateTeam {
  clubId: string
}

/**
 * SEARCH THE CLUB DIRECTORY FOR SOMEBODY TO INVITE TO A GRADE.
 *
 * SCOPED BY RUGBY CODE IN THE QUERY, never in the browser. A Rugby Union club is never shown Rugby
 * League clubs -- not as an option, a disabled option or a "not offered" note -- so the filter is a
 * `where`, because loading both and hiding one works right up until somebody renders the array.
 *
 * The host's own directory row is excluded: the host's sides are entries, not participants, and the
 * database refuses a host participant row outright.
 */
export async function searchTournamentClubs(
  supabase: Client,
  options: { query: string; rugbyCode: string; excludeDirectoryId?: string | null; limit?: number },
): Promise<TournamentClubResult[]> {
  const q = options.query.trim()
  let request = supabase
    .from("club_directory")
    .select("id, name, town, county, logo_storage_path, clubs(id, logo_storage_path)")
    .eq("rugby_code", options.rugbyCode)
    .eq("active", true)
    .order("name")
    .limit(options.limit ?? 25)

  if (q.length > 0) request = request.ilike("name", `%${q}%`)
  if (options.excludeDirectoryId) request = request.neq("id", options.excludeDirectoryId)

  const { data, error } = await request
  if (error) throw error

  return (data ?? []).map((row) => {
    const rel = row.clubs as unknown as { id: string; logo_storage_path: string | null }[] | { id: string; logo_storage_path: string | null } | null
    const club = Array.isArray(rel) ? (rel[0] ?? null) : rel
    return {
      directoryId: row.id,
      name: row.name,
      location: [row.town, row.county].filter((v): v is string => !!v && v.trim().length > 0).join(", ") || null,
      // The canonical rule: the club's own upload when it has claimed one, else the directory's.
      crestUrl: clubLogoUrlFromPath(supabase, club?.logo_storage_path ?? row.logo_storage_path ?? null),
      onOvalball: !!club?.id,
    }
  })
}

/**
 * THE SIDES A CLUB ACTUALLY HAS AT ONE GRADE.
 *
 * Filtered on `teams.age_group` in the query. A club with Under 9 A, B, C and an Under 10 side returns
 * three rows for U9 -- showing the U10 side would offer the organiser a team that cannot play in the
 * competition being configured.
 */
export async function readDirectoryClubTeamsAtGrade(supabase: Client, directoryId: string, ageGroup: string): Promise<TournamentCandidateTeam[]> {
  const { data: club } = await supabase.from("clubs").select("id").eq("directory_id", directoryId).maybeSingle()
  if (!club?.id) return []
  return readClubTeamsAtGrade(supabase, club.id, ageGroup)
}

/** The same, for a club id already in hand. */
export async function readClubTeamsAtGrade(supabase: Client, clubId: string, ageGroup: string): Promise<TournamentCandidateTeam[]> {
  const { data, error } = await supabase
    .from("teams")
    .select("id, display_name, category, age_group, gender, squad_designation, rugby_code, canonical_team_type_id")
    .eq("club_id", clubId)
    .eq("age_group", ageGroup)
    .eq("active", true)
    .order("squad_designation", { nullsFirst: true })
    .order("display_name")
  if (error) throw error
  return (data ?? []).map((t) => ({
    teamId: t.id,
    name: fullTeamLabel({
      category: t.category,
      ageGroup: t.age_group,
      gender: t.gender,
      squadDesignation: t.squad_designation,
      rugbyCode: t.rugby_code,
      alias: null,
    }),
    ageGroup: t.age_group ?? ageGroup,
    canonicalTeamTypeId: t.canonical_team_type_id,
  }))
}

/**
 * EVERY SIDE THE HOST HAS ACROSS THE GRADES THE TOURNAMENT RUNS, in one read.
 *
 * One query rather than one per grade: the Teams step switches between grades constantly, and a
 * request per tab would make its own club's teams the slowest thing on the screen.
 */
export async function readOurTeamsForAgeGroups(supabase: Client, clubId: string, ageGroups: string[]): Promise<Record<string, OurTeamOption[]>> {
  const grades = [...new Set(ageGroups)].filter((g) => g.length > 0)
  if (grades.length === 0) return {}
  const { data, error } = await supabase
    .from("teams")
    .select("id, display_name, category, age_group, gender, squad_designation, rugby_code, canonical_team_type_id")
    .eq("club_id", clubId)
    .eq("active", true)
    .in("age_group", grades)
    .order("age_group")
    .order("squad_designation", { nullsFirst: true })
    .order("display_name")
  if (error) throw error

  const byGrade: Record<string, OurTeamOption[]> = {}
  for (const g of grades) byGrade[g] = []
  for (const t of data ?? []) {
    const grade = t.age_group
    if (!grade || !byGrade[grade]) continue
    byGrade[grade].push({
      teamId: t.id,
      clubId,
      name: fullTeamLabel({
        category: t.category,
        ageGroup: t.age_group,
        gender: t.gender,
        squadDesignation: t.squad_designation,
        rugbyCode: t.rugby_code,
        alias: null,
      }),
      ageGroup: grade,
      canonicalTeamTypeId: t.canonical_team_type_id,
    })
  }
  return byGrade
}

/**
 * A CLUB'S PLAYING COLOURS.
 *
 * `club_kits` is the one canonical source, and it is PER CLUB -- Ovalball does not record a kit per
 * team, so every side of a club wears that club's kit here. That is the truth the database holds; a
 * different shirt per squad would be invented, and inferring colours from a crest would be worse.
 * A club with no kit row returns null, and the caller draws the established neutral shirt.
 */
export async function readClubKits(supabase: Client, clubIds: string[]): Promise<Record<string, KitConfig>> {
  const ids = [...new Set(clubIds)].filter((id) => !!id)
  if (ids.length === 0) return {}
  const { data, error } = await supabase
    .from("club_kits")
    .select("club_id, pattern, primary_colour, secondary_colour, accent_colour")
    .in("club_id", ids)
    .eq("variant", "primary")
  if (error) return {}
  const out: Record<string, KitConfig> = {}
  for (const k of data ?? []) {
    out[k.club_id] = {
      pattern: k.pattern as KitPattern,
      primaryColour: k.primary_colour,
      secondaryColour: k.secondary_colour,
      accentColour: k.accent_colour,
    }
  }
  return out
}
