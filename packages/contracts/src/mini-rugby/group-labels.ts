import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { miniRugbyGroupLabel } from "./group-label"

/** A mini-rugby group's real label by id. Moved from `lib/calendar/resolve-entry-participant.ts` (CA-M11.1). */
export async function loadOpponentGroupLabels(supabase: SupabaseClient<Database>, groupIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(groupIds.filter((id): id is string => Boolean(id))))
  if (ids.length === 0) return new Map()
  const { data } = await supabase.from("scheduling_groups").select("id, display_tag, alias").in("id", ids)
  return new Map((data ?? []).map((g) => [g.id, miniRugbyGroupLabel({ displayTag: g.display_tag, alias: g.alias })]))
}
