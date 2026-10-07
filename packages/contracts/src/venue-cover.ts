import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "./database"

/**
 * WHAT A VENUE LOOKS LIKE, AND WHERE THAT PICTURE COMES FROM.
 *
 * The same chain `team-cover.ts` already established, applied to the same problem for a different
 * entity rather than a second one invented alongside it (Training Planning brief, Section 17):
 *
 *   1. the venue's OWN uploaded photo, if somebody at the club has set one (`venues.cover_image_path`);
 *   2. a DELIBERATE Ovalball Image Library selection (`venues.cover_stock_key`) -- still a choice
 *      somebody at the club made, just from curated stock rather than an upload;
 *   3. nothing -- a venue with no imagery gets a plain header rather than a fabricated photograph of
 *      somewhere else's ground.
 *
 * There is no crest-style fallback for a venue the way a team falls back to its club's crest: a venue
 * has no third canonical image to borrow.
 */
export type VenueCover = { kind: "cover"; url: string } | { kind: "stock"; key: string } | { kind: "none" }

/**
 * The public URL for a venue cover, or null. Same bucket as team covers and article heroes
 * (`club-news-media`) -- venue imagery is published with the club, not sensitive, and reuses the
 * storage/policy surface that already exists rather than a second bucket for one column.
 */
export function venueCoverUrlFromPath(supabase: SupabaseClient<Database>, path: string | null | undefined): string | null {
  const trimmed = (path ?? "").trim()
  if (!trimmed) return null
  return supabase.storage.from("club-news-media").getPublicUrl(trimmed).data.publicUrl
}

export function resolveVenueCover(input: {
  supabase: SupabaseClient<Database>
  coverImagePath: string | null | undefined
  coverStockKey: string | null | undefined
}): VenueCover {
  const cover = venueCoverUrlFromPath(input.supabase, input.coverImagePath)
  if (cover) return { kind: "cover", url: cover }
  if (input.coverStockKey) return { kind: "stock", key: input.coverStockKey }
  return { kind: "none" }
}
