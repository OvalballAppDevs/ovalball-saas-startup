import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "./database"

type Client = SupabaseClient<Database>

/**
 * CHANGING A TOURNAMENT'S PHOTOGRAPH.
 *
 * Mirrors `venue-media.ts` exactly, because it is the same job: one governed write that takes an upload
 * or a library selection and never both, and one upload helper whose path shape is the one the storage
 * policy recognises. A tournament-specific upload mechanism would be a second answer to a question the
 * platform has already answered three times.
 */

/** One error rule, matching `venueMediaErrorMessage` and `team/media.ts`: the database's own sentence
 * is shown when the database wrote one deliberately, and anything else becomes the caller's fallback
 * rather than leaking a Postgres message onto a screen. */
export function tournamentMediaErrorMessage(error: unknown, fallback: string): string {
  const e = (error ?? {}) as { code?: string; message?: string }
  if (e.code === "42501" || e.code === "22023" || e.code === "23514" || e.code === "P0001" || e.code === "P0002") return e.message || fallback
  return fallback
}

/**
 * THE ONE GOVERNED COVER WRITE for a tournament -- an upload (`storagePath`), an Ovalball library
 * selection (`stockKey`), or `null` to go back to the canonical default.
 *
 * `null` CLEARS BOTH COLUMNS rather than writing the default's key. "Nobody has chosen" and "somebody
 * chose the picture that happens to be the default" are different facts, and only the first one keeps
 * following the default when the default changes.
 *
 * The server revalidates the stock key against `set_tournament_cover`'s own allow-list, so a key the
 * app no longer ships cannot be stored by an out-of-date client.
 */
export async function setTournamentCover(
  supabase: Client,
  tournamentId: string,
  selection: { storagePath: string } | { stockKey: string } | null,
): Promise<void> {
  const { error } = await supabase.rpc("set_tournament_cover", {
    p_tournament_id: tournamentId,
    p_storage_path: (selection && "storagePath" in selection ? selection.storagePath : null) as string,
    p_stock_key: (selection && "stockKey" in selection ? selection.stockKey : null) as string,
  })
  if (error) throw error
}

/** What the app will accept from a device library, and what the storage policy's path pattern allows.
 * Stated once so the picker, the validator and the error message cannot disagree. */
export const TOURNAMENT_COVER_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const
export const TOURNAMENT_COVER_MAX_BYTES = 10 * 1024 * 1024

export function tournamentCoverTypeProblem(contentType: string, bytes: number): string | null {
  if (!(TOURNAMENT_COVER_MIME_TYPES as readonly string[]).includes(contentType)) {
    return "That file is not an image Ovalball can use. Choose a JPEG, PNG or WebP photo."
  }
  if (bytes > TOURNAMENT_COVER_MAX_BYTES) {
    return "That photo is too large. Choose one under 10MB."
  }
  return null
}

/**
 * Uploads a new tournament cover photo's bytes, matching `internal.may_manage_tournament_media`'s path
 * shape `{club_id}/tournament-{tournament_id}/{uuid}.{ext}` in the shared `club-news-media` bucket.
 *
 * THE PATH IS THE CLAIM, so it is built from the ids rather than from anything the device told us: a
 * local file's own name never reaches storage, which is also why no device path can leak into a row.
 */
export async function uploadTournamentCoverPhoto(
  supabase: Client,
  clubId: string,
  tournamentId: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const problem = tournamentCoverTypeProblem(contentType, bytes.byteLength)
  if (problem) return { ok: false, message: problem }

  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg"
  const path = `${clubId}/tournament-${tournamentId}/${cryptoRandomId()}.${ext}`
  const { error } = await supabase.storage.from("club-news-media").upload(path, bytes, { contentType, upsert: false })
  if (error) return { ok: false, message: tournamentMediaErrorMessage(error, "That photo couldn't be uploaded.") }
  return { ok: true, path }
}

/** Same Math.random()-based UUID v4 as `venue-media.ts` and `team/media.ts` -- see those files:
 * `globalThis.crypto` is not reliably present in this Hermes runtime, and this package is shared
 * rather than mobile-only, so it cannot reach for expo-crypto either. */
function cryptoRandomId(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16)
  const segment = (n: number) => Array.from({ length: n }, hex).join("")
  const variant = ["8", "9", "a", "b"][Math.floor(Math.random() * 4)]
  return `${segment(8)}-${segment(4)}-4${segment(3)}-${variant}${segment(3)}-${segment(12)}`
}
