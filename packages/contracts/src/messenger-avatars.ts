import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "./database"
import { resolvePersonalAvatarUrls } from "./personal-avatar"

/**
 * THE PEOPLE YOU MESSAGE, WITH THEIR OWN PICTURES.
 *
 * `my_contact_avatars` returns a picture's location only for somebody the caller already has a direct conversation
 * with or may start one with (adults only, never across a block). The picture is then signed through the one
 * personal-avatar resolver. Anybody without a picture -- or anybody the server will not answer for -- is simply
 * absent from the map, which every surface draws as initials. A club crest is never a substitute.
 */
export async function loadContactAvatars(supabase: SupabaseClient<Database>, userIds: readonly string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const ids = [...new Set(userIds.filter(Boolean))].slice(0, 200)
  if (ids.length === 0) return result
  const { data, error } = await supabase.rpc("my_contact_avatars", { p_user_ids: ids })
  if (error || !data?.length) return result
  const urls = await resolvePersonalAvatarUrls(supabase, data.map((row) => row.avatar_storage_path))
  for (const row of data) {
    const url = row.avatar_storage_path ? urls.get(row.avatar_storage_path) : undefined
    if (url) result.set(row.user_id, url)
  }
  return result
}
