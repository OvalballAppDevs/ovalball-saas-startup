import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

/**
 * Server-side batch loader: given a set of scheduling_group_ids, returns
 * the group_id -> member team_ids map effectiveTeamIdsForFixtureSide
 * (effective-teams.ts) needs. One query for however many fixtures/groups
 * a page is rendering, never one query per fixture row.
 */
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
