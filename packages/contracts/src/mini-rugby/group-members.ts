import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

/** The member teams of each mini-rugby scheduling group, in one read. Moved from `lib/mini-rugby/effective-teams.server.ts` (CA-M11.1). */
export async function loadGroupMemberTeamIds(supabase: SupabaseClient<Database>, groupIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  if (groupIds.length === 0) return result
  const { data } = await supabase.from("scheduling_group_members").select("group_id, team_id").in("group_id", groupIds)
  for (const row of data ?? []) {
    const list = result.get(row.group_id) ?? []
    list.push(row.team_id)
    result.set(row.group_id, list)
  }
  return result
}
