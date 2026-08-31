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
