import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "./database"

/**
 * WHAT A CHANGING ROOM LOOKS LIKE, AND WHERE THAT PICTURE COMES FROM.
 *
 * The same chain as `venue-cover.ts` and `pitch-cover.ts`, for a changing room:
 *
 *   1. the room's OWN uploaded photo (`venue_changing_rooms.cover_image_path`);
 *   2. a DELIBERATE Ovalball Image Library selection (`venue_changing_rooms.cover_stock_key`);
 *   3. nothing -- a plain header rather than a fabricated photograph of a room that is not this one.
 */
export type ChangingRoomCover = { kind: "cover"; url: string } | { kind: "stock"; key: string } | { kind: "none" }

/** Same bucket as team/venue/pitch covers (`club-news-media`) -- see venue-cover.ts for why. */
export function changingRoomCoverUrlFromPath(supabase: SupabaseClient<Database>, path: string | null | undefined): string | null {
  const trimmed = (path ?? "").trim()
  if (!trimmed) return null
  return supabase.storage.from("club-news-media").getPublicUrl(trimmed).data.publicUrl
}

export function resolveChangingRoomCover(input: {
  supabase: SupabaseClient<Database>
  coverImagePath: string | null | undefined
  coverStockKey: string | null | undefined
}): ChangingRoomCover {
  const cover = changingRoomCoverUrlFromPath(input.supabase, input.coverImagePath)
  if (cover) return { kind: "cover", url: cover }
  if (input.coverStockKey) return { kind: "stock", key: input.coverStockKey }
  return { kind: "none" }
}
