"use server"

import { loadClubCatalogue, type ClubCatalogueEntry } from "@/lib/fixtures/club-catalogue"
import { fullTeamLabel } from "@/lib/teams/compact-label"

import { resolvePlannerScope } from "./planner-scope"

/**
 * THE PLANNER'S LOOKUPS.
 *
 * A spreadsheet column of free text is a column of future problems. Every
 * structured field here -- our team, the opponent, their team, the
 * competition, the venue, the pitch -- has a canonical record behind it,
 * and the planner's job is to help somebody land on that record rather
 * than to accept a string that merely looks like one.
 *
 * NOTHING HERE CREATES ANYTHING. These are reads. A club typed into the
 * Opposition cell never becomes a club; it either matches the Club
 * Directory or it is a row that needs review.
 *
 * LOADED ONCE, NOT PER KEYSTROKE. The opposition catalogue used to be searched
 * with a debounced server action on every keystroke of every cell -- each call
 * re-resolving the session and the capability before running two ILIKE
 * queries whose answers never changed between rows. The catalogue is now read
 * once per planner session, already scoped to what this person may see, and
 * filtered in the browser (lib/fixtures/planner-lookup.ts). Our teams, venues
 * and pitches are smaller still and arrive with the page.
 */

export type OppositionClubOption = ClubCatalogueEntry

export interface NamedOption {
  id: string
  label: string
  hint?: string
}

/** The shared club catalogue (lib/fixtures/club-catalogue.ts), in this club's code, without this club. */
export async function loadOppositionCatalogue(clubId?: string): Promise<OppositionClubOption[]> {
  const scope = await resolvePlannerScope(clubId)
  if (!scope) return []
  const { supabase, universe } = scope
  const { data: club } = await supabase.from("clubs").select("club_directory(rugby_code)").eq("id", universe.clubId).maybeSingle()
  const rugbyCode = club?.club_directory?.rugby_code
  if (!rugbyCode) return []
  return loadClubCatalogue(supabase, rugbyCode, { excludeClubId: universe.clubId })
}

/**
 * The opponent's own teams -- real ones, or none.
 *
 * Offered only for an Ovalball opponent, because only an Ovalball club has
 * canonical teams. Memoised per opponent in the browser, so a column of
 * fixtures against the same club asks once.
 */
export interface OppositionTeamOption extends NamedOption {
  rugbyCode: string
  category: string
  ageGroup: string | null
  gender: string | null
  squadDesignation: string | null
}

export async function listOppositionTeams(tenantClubId: string, clubId?: string): Promise<OppositionTeamOption[]> {
  const scope = await resolvePlannerScope(clubId)
  if (!scope) return []
  const { data } = await scope.supabase
    .from("teams")
    .select("id, rugby_code, category, age_group, gender, squad_designation")
    .eq("club_id", tenantClubId)
    .eq("active", true)
    .order("category")
    .order("age_group")
    .limit(100)
  return (data ?? []).map((t) => ({
    id: t.id,
    rugbyCode: t.rugby_code,
    category: t.category,
    ageGroup: t.age_group,
    gender: t.gender,
    squadDesignation: t.squad_designation,
    label: fullTeamLabel({
      category: t.category,
      ageGroup: t.age_group,
      gender: t.gender,
      squadDesignation: t.squad_designation,
      rugbyCode: t.rugby_code,
    }),
  }))
}
