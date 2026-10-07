import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "./database"

type Client = SupabaseClient<Database>

/** One error rule, matching team_media's own (`team/media.ts`). */
export function venueMediaErrorMessage(error: unknown, fallback: string): string {
  const e = (error ?? {}) as { code?: string; message?: string }
  if (e.code === "42501" || e.code === "22023" || e.code === "23514" || e.code === "P0001" || e.code === "P0002") return e.message || fallback
  return fallback
}

/**
 * THE ONE GOVERNED COVER WRITE for a venue -- an upload (`storagePath`) or an Ovalball library
 * selection (`stockKey`), never both. Mirrors `setTeamCover` (`team/media.ts`) exactly. Server
 * revalidates the stock key against `set_venue_cover`'s own allow-list.
 */
export async function setVenueCover(supabase: Client, venueId: string, selection: { storagePath: string } | { stockKey: string } | null): Promise<void> {
  const { error } = await supabase.rpc("set_venue_cover", {
    p_venue_id: venueId,
    p_storage_path: (selection && "storagePath" in selection ? selection.storagePath : null) as string,
    p_stock_key: (selection && "stockKey" in selection ? selection.stockKey : null) as string,
  })
  if (error) throw error
}

/** Uploads a new venue cover photo's bytes, matching `may_manage_venue_media`'s path shape
 * `{club_id}/venue-{venue_id}/{uuid}.{ext}` in the shared `club-news-media` bucket. */
export async function uploadVenueCoverPhoto(supabase: Client, clubId: string, venueId: string, bytes: ArrayBuffer, contentType: string): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg"
  const path = `${clubId}/venue-${venueId}/${cryptoRandomId()}.${ext}`
  const { error } = await supabase.storage.from("club-news-media").upload(path, bytes, { contentType, upsert: false })
  if (error) return { ok: false, message: venueMediaErrorMessage(error, "That photo couldn't be uploaded.") }
  return { ok: true, path }
}

/** Same Math.random()-based UUID v4 as team/media.ts -- see that file's comment: globalThis.crypto is
 * not reliably present in this Hermes runtime, and this package is shared (not mobile-only) so it
 * cannot reach for expo-crypto either. */
function cryptoRandomId(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16)
  const segment = (n: number) => Array.from({ length: n }, hex).join("")
  const variant = ["8", "9", "a", "b"][Math.floor(Math.random() * 4)]
  return `${segment(8)}-${segment(4)}-4${segment(3)}-${variant}${segment(3)}-${segment(12)}`
}
