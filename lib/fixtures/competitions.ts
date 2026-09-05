"use server"

import { createClient } from "@/lib/supabase/server"

export interface CompetitionEditionOption {
  id: string
  competitionName: string
  seasonName: string
}

/**
 * competitions/competition_editions are readable to any authenticated user
 * while active (competitions_select / competition_editions_select) -- this
 * is a plain read, not a privileged lookup. Filtered to the fixture's own
 * rugby_code so a Union fixture never sees League competitions or vice
 * versa, matching the same code-match enforced server-side by
 * update_fixture_competition.
 */
export async function listCompetitionEditionsForRugbyCode(rugbyCode: string): Promise<CompetitionEditionOption[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from("competition_editions")
    .select("id, competitions(name), seasons(name, starts_on)")
    .eq("rugby_code", rugbyCode)
    .eq("active", true)

  return (data ?? [])
    .filter((e) => e.competitions && e.seasons)
    .map((e) => ({ id: e.id, competitionName: e.competitions!.name, seasonName: e.seasons!.name, startsOn: e.seasons!.starts_on }))
    .sort((a, b) => b.startsOn.localeCompare(a.startsOn))
    .map(({ id, competitionName, seasonName }) => ({ id, competitionName, seasonName }))
}
