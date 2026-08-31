"use server"

import { createClient } from "@/lib/supabase/server"
import type { ClubDirectoryResult, RugbyCode } from "@/lib/signup/types"

/**
 * Read-only club_directory search for signup STEP 3. Runs through the
 * standard server Supabase client (publishable key + the caller's own
 * session/anon context), so it is bound by the same RLS the browser would
 * get -- `club_directory_select` already grants public SELECT where
 * active = true, which is exactly what an unauthenticated visitor mid-
 * signup needs. This performs no writes and requires no session.
 */
export async function searchClubDirectory(
  rugbyCode: RugbyCode,
  query: string
): Promise<ClubDirectoryResult[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const supabase = await createClient()
  const escaped = trimmed.replace(/[%_]/g, (c) => `\\${c}`)

  const { data: directoryRows, error } = await supabase
    .from("club_directory")
    .select("id, name, town, county, postcode, rugby_code, verification_status")
    .eq("rugby_code", rugbyCode)
    .or(
      `name.ilike.%${escaped}%,town.ilike.%${escaped}%,postcode.ilike.%${escaped}%`
    )
    .order("name")
    .limit(20)

  if (error || !directoryRows) return []

  const directoryIds = directoryRows.map((row) => row.id)
  if (directoryIds.length === 0) return []

  // A directory row is "claimed" once an active `clubs` row references it.
  // Also carries that clubs.id through -- the join-request path needs the
  // real clubs.id, not the directory.id (see club_join_requests.club_id's
  // FK), so this map is a required part of the result, not just the
  // claimed/unclaimed flag.
  const { data: claimedRows } = await supabase
    .from("clubs")
    .select("id, directory_id")
    .in("directory_id", directoryIds)
    .eq("status", "active")

  const clubIdByDirectoryId = new Map((claimedRows ?? []).map((row) => [row.directory_id, row.id]))

  return directoryRows.map((row) => ({
    id: row.id,
    name: row.name,
    town: row.town,
    county: row.county,
    postcode: row.postcode,
    rugbyCode: row.rugby_code as RugbyCode,
    claimed: clubIdByDirectoryId.has(row.id),
    clubId: clubIdByDirectoryId.get(row.id) ?? null,
    verified: row.verification_status.includes("verified"),
  }))
}
