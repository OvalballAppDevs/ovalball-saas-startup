"use server"

import { createClient } from "@/lib/supabase/server"

export interface ActivatedClubSearchResult {
  directoryId: string
  clubId: string
  name: string
  town: string | null
  county: string | null
  rugbyCode: string
}

/**
 * Only activated clubs (clubs!inner) -- a partnership references clubs.id,
 * so a directory-only (not yet claimed) club can't be a partner candidate
 * at all. Same public-read policies as search-opponents.ts (club_directory
 * active=true, clubs status=active) -- no new exposure, no private
 * contact fields selected.
 */
export async function searchActivatedClubs(query: string, excludeClubId: string): Promise<ActivatedClubSearchResult[]> {
  if (query.trim().length < 2) return []

  const supabase = await createClient()
  const { data } = await supabase
    .from("club_directory")
    .select("id, name, town, county, rugby_code, clubs!inner(id)")
    .eq("active", true)
    .ilike("name", `%${query.trim()}%`)
    .neq("clubs.id", excludeClubId)
    .limit(8)

  return (data ?? [])
    .filter((d) => d.clubs?.id)
    .map((d) => ({
      directoryId: d.id,
      clubId: d.clubs!.id,
      name: d.name,
      town: d.town,
      county: d.county,
      rugbyCode: d.rugby_code,
    }))
}
