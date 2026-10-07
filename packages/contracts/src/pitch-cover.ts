import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "./database"

/**
 * WHAT A PITCH LOOKS LIKE, AND WHERE THAT PICTURE COMES FROM.
 *
 * The same chain as `venue-cover.ts` and `team-cover.ts`, for a pitch (Training Planning brief,
 * Section 18):
 *
 *   1. the pitch's OWN uploaded photo (`club_pitches.cover_image_path`);
 *   2. a DELIBERATE Ovalball Image Library selection (`club_pitches.cover_stock_key`);
 *   3. nothing -- a plain header rather than a fabricated photograph of a pitch that is not this one.
 *
 * The resolved image is the ONE source every consumer reads: Training Planning, Arena Planning, Pitch
 * Allocation and the Pitch Profile screen itself all call this, never a second copy stored against a
 * training plan or a booking.
 */
export type PitchCover = { kind: "cover"; url: string } | { kind: "stock"; key: string } | { kind: "none" }

/** Same bucket as team/venue covers (`club-news-media`) -- see venue-cover.ts for why. */
export function pitchCoverUrlFromPath(supabase: SupabaseClient<Database>, path: string | null | undefined): string | null {
  const trimmed = (path ?? "").trim()
  if (!trimmed) return null
  return supabase.storage.from("club-news-media").getPublicUrl(trimmed).data.publicUrl
}

export function resolvePitchCover(input: {
  supabase: SupabaseClient<Database>
  coverImagePath: string | null | undefined
  coverStockKey: string | null | undefined
}): PitchCover {
  const cover = pitchCoverUrlFromPath(input.supabase, input.coverImagePath)
  if (cover) return { kind: "cover", url: cover }
  if (input.coverStockKey) return { kind: "stock", key: input.coverStockKey }
  return { kind: "none" }
}
