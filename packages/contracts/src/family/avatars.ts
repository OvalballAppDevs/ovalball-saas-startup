import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

/**
 * A CHILD'S OWN PICTURE, SIGNED — AND THE CHECK IS THE SIGNING.
 *
 * `player-avatars` is a PRIVATE bucket whose policies resolve the canonical
 * guardian relationship (`internal.can_access_player_avatar`). So this module
 * re-implements no authorization and could not: asking for a signed URL IS the
 * authorization question, and a caller who may not see a child's photograph
 * simply gets nothing back for that path.
 *
 * That is why it is safe for a projection to call it for a whole family at once.
 * The set it returns is not "the pictures that exist" — it is "the pictures this
 * person may see", which is a different and smaller thing.
 *
 * NEVER THE GUARDIAN'S PICTURE. An adult account's own photograph lives in the
 * `avatars` bucket under a different policy and is resolved by
 * `resolvePersonalAvatarUrls`. The two must not be confused: a header shows the
 * signed-in person, a family card shows the child, and swapping them would
 * misidentify somebody on every screen at once.
 *
 * ONE ROUND TRIP whatever the family size, because a guardian of three should
 * not cost three storage calls.
 */

/** An hour, matching every other signed URL in this codebase. Long enough for a session, short enough that a copied link dies. */
const SIGNED_URL_SECONDS = 60 * 60

export async function resolvePlayerAvatarUrls(
  supabase: SupabaseClient<Database>,
  avatarStoragePaths: Iterable<string | null | undefined>
): Promise<Map<string, string>> {
  const paths = Array.from(new Set(Array.from(avatarStoragePaths).filter((p): p is string => Boolean(p))))
  const urls = new Map<string, string>()
  if (paths.length === 0) return urls
  const { data } = await supabase.storage.from("player-avatars").createSignedUrls(paths, SIGNED_URL_SECONDS)
  for (const row of data ?? []) {
    if (row.path && row.signedUrl && !row.error) urls.set(row.path, row.signedUrl)
  }
  return urls
}
