import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

type Client = SupabaseClient<Database>

/**
 * TEAM GALLERY -- real photographs belonging to this team (Team Profile Section 5), genuinely distinct
 * from the Ovalball Image Library's curated stock (`cover-library.ts`): a gallery photo is never
 * presented as though a stock image depicts it, and a stock image is never listed as gallery history.
 *
 * PRIVATE BUCKET, SIGNED URLS ONLY. `team-gallery-media` is not public, unlike the older
 * `club-news-media` bucket team covers still use -- the same posture Identity/Auth Slice 4a already
 * moved personal avatars to (`personal-avatar.ts`), chosen deliberately here because a gallery can
 * contain photographs of children and Ovalball has no canonical per-child media-publication-consent
 * record (see the migration's own safeguarding note, `20270572000000`). A viewer who cannot see this
 * team's roster resolves to no photos at all, never a broken image.
 */
const SIGNED_URL_SECONDS = 60 * 60

export interface TeamMediaItem {
  id: string
  storagePath: string
  url: string | null
  caption: string | null
  uploadedBy: string
  createdAt: string
}

export async function readTeamMedia(supabase: Client, teamId: string, limit = 60): Promise<TeamMediaItem[]> {
  const { data, error } = await supabase.rpc("read_team_media", { p_team_id: teamId, p_limit: limit })
  if (error) throw error
  const rows = data ?? []
  if (rows.length === 0) return []
  const { data: signed } = await supabase.storage
    .from("team-gallery-media")
    .createSignedUrls(rows.map((r) => r.storage_path), SIGNED_URL_SECONDS)
  const urls = new Map<string, string>()
  for (const row of signed ?? []) {
    if (row.path && row.signedUrl && !row.error) urls.set(row.path, row.signedUrl)
  }
  return rows.map((r) => ({
    id: r.id,
    storagePath: r.storage_path,
    url: urls.get(r.storage_path) ?? null,
    caption: r.caption,
    uploadedBy: r.uploaded_by,
    createdAt: r.created_at,
  }))
}

/** One error rule, matching team_staff's own. */
export function teamMediaErrorMessage(error: unknown, fallback: string): string {
  const e = (error ?? {}) as { code?: string; message?: string }
  if (e.code === "42501" || e.code === "22023" || e.code === "23514" || e.code === "P0001" || e.code === "P0002") return e.message || fallback
  return fallback
}

/**
 * UPLOADS THE BYTES, THEN RECORDS THE CANONICAL ROW -- upload-then-link, the same order
 * `replaceClubCrest`/`replaceClubCover` already use (`apps/mobile/src/identity/images.ts`), so a failed
 * link never leaves the canonical Gallery pointing at nothing, and a failed upload never creates an
 * orphan record. The storage policy re-derives the team from the path itself
 * (`internal.may_access_team_gallery_media`) and the RPC re-checks the same authority again -- the
 * client's own belief about `canManageMedia` decides nothing.
 */
export async function addTeamMediaPhoto(
  supabase: Client,
  teamId: string,
  bytes: ArrayBuffer,
  contentType: string,
  caption?: string
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg"
  const path = `${teamId}/${cryptoRandomId()}.${ext}`
  const { error: uploadError } = await supabase.storage.from("team-gallery-media").upload(path, bytes, { contentType, upsert: false })
  if (uploadError) return { ok: false, message: teamMediaErrorMessage(uploadError, "That photo couldn't be uploaded.") }

  const { data, error } = await supabase.rpc("add_team_media", { p_team_id: teamId, p_storage_path: path, p_caption: caption ?? undefined })
  if (error || !data) {
    await supabase.storage.from("team-gallery-media").remove([path])
    return { ok: false, message: teamMediaErrorMessage(error, "That photo couldn't be added to the gallery.") }
  }
  return { ok: true, id: data }
}

/** Retires the canonical record, then best-effort removes the storage object -- the record is the
 * boundary (Section 7's "must remove/retire the canonical record"), the storage cleanup is tidiness. */
export async function removeTeamMediaPhoto(supabase: Client, mediaId: string, storagePath: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc("remove_team_media", { p_media_id: mediaId })
  if (error) return { ok: false, message: teamMediaErrorMessage(error, "That photo couldn't be removed.") }
  await supabase.storage.from("team-gallery-media").remove([storagePath])
  return { ok: true }
}

/**
 * THE ONE GOVERNED COVER WRITE -- an upload (`storagePath`) or an Ovalball library selection
 * (`stockKey`), never both. Server-revalidates the stock key against its own allow-list
 * (`set_team_cover`'s migration), so a client passing an unrecognised key is refused outright.
 */
export async function setTeamCover(supabase: Client, teamId: string, selection: { storagePath: string } | { stockKey: string } | null): Promise<void> {
  // As in staff.ts's setCoachTitle: the generated Args type is imprecisely non-nullable for these two
  // text params, though `set_team_cover` genuinely accepts NULL for whichever half is not selected.
  const { error } = await supabase.rpc("set_team_cover", {
    p_team_id: teamId,
    p_storage_path: (selection && "storagePath" in selection ? selection.storagePath : null) as string,
    p_stock_key: (selection && "stockKey" in selection ? selection.stockKey : null) as string,
  })
  if (error) throw error
}

/** Uploads a new cover photo's bytes to the team's own club-news-media path, matching the existing
 * `teams.cover_image_path` convention (`packages/contracts/src/team-cover.ts`) and the bucket's own
 * established path shape (`internal.may_manage_club_news_media`, `{club_id}/{team_id}/{uuid}.{ext}`) --
 * the SAME bucket a team cover has always lived in, not a second one introduced for this screen. */
export async function uploadTeamCoverPhoto(supabase: Client, clubId: string, teamId: string, bytes: ArrayBuffer, contentType: string): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg"
  const path = `${clubId}/${teamId}/${cryptoRandomId()}.${ext}`
  const { error } = await supabase.storage.from("club-news-media").upload(path, bytes, { contentType, upsert: false })
  if (error) return { ok: false, message: teamMediaErrorMessage(error, "That photo couldn't be uploaded.") }
  return { ok: true, path }
}

/**
 * A real UUID v4, generated from `Math.random()` rather than `crypto.randomUUID()` -- found live, by
 * physical review, that `globalThis.crypto` is undefined in this Hermes runtime (no polyfill is
 * actually installed), which crashed every upload with "Cannot read property 'randomUUID' of
 * undefined". This mirrors the exact reasoning `apps/mobile/src/messages/attachments.ts` and
 * `apps/mobile/src/admin/content/upload.ts` already give for avoiding `crypto.randomUUID` ("not in
 * every React Native runtime") -- their own `randomId()` is not UUID-shaped, though, and this package
 * is shared (not mobile-only), so it cannot import `expo-crypto` either. Only uniqueness is required
 * here, not cryptographic unpredictability, so `Math.random()` is the right tool, not a shortcut.
 */
function cryptoRandomId(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16)
  const segment = (n: number) => Array.from({ length: n }, hex).join("")
  const variant = ["8", "9", "a", "b"][Math.floor(Math.random() * 4)]
  return `${segment(8)}-${segment(4)}-4${segment(3)}-${variant}${segment(3)}-${segment(12)}`
}
