import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@ovalball/contracts"

import { readFileBytes, type PickedFile } from "../messages/pickers"
import { friendly, logDetail } from "../errors/translate"

/**
 * CHANGING THE PICTURE WHERE THE PICTURE IS.
 *
 * The owner's instruction: "I should be able to click the profile picture in the
 * top left and change the profile picture there and then, on club admin I should
 * be able to click the club logo at the top and change that too and it changes in
 * canonically." So the image is not merely a picture on these two surfaces -- it
 * is the control for changing it.
 *
 * "CANONICALLY" IS THE OPERATIVE WORD, and it is why this module is thirty lines
 * of writing and a page of reasoning. Each write goes to the ONE canonical record
 * the whole platform reads:
 *
 *   a person   ->  profiles.avatar_storage_path, file in the PRIVATE `avatars`
 *                  bucket under the person's own id
 *   a club     ->  clubs.logo_storage_path, file in the PUBLIC `club-logos`
 *                  bucket under the club's own id
 *
 * so the new picture appears in the sidebar, in a conversation, on a fixture
 * card, in the Club Directory and in an email, because all of those already read
 * those two columns. An in-place editor that wrote a copy for the screen it was
 * invoked from would be the exact opposite of what was asked for.
 *
 * THE UPLOAD IS THE AUTHORITY CHECK, and it is the database's. `avatars` carries
 * own-path-only policies, so a person can write nowhere but their own folder;
 * `club-logos` carries `club_logos_insert_club_admin`, which resolves
 * `club.logo.manage` at the club whose id is the first path segment. This module
 * therefore does not decide who may do either of these -- it cannot, and a client
 * that tried would be a security boundary on a device an attacker owns. What it
 * does is ASK first (`canManageClubCrest`) so that the control is not offered to
 * somebody the write would refuse.
 *
 * ORDER MATTERS: upload, then link, then delete the old file. Linking before
 * uploading would point the platform at a file that does not exist yet; deleting
 * before linking would blank every screen if the link then failed. The same
 * upload-then-link order the website's own two actions use, for the same reason.
 *
 * A PERSON IS NOT A CLUB. Two functions, two buckets, two columns, and nothing
 * shared between them but the byte-reading. The website once had a `fallback`
 * prop that let a crest stand in for an avatar, and a team's playing shirt ended
 * up where a club's crest belonged; the fix was to remove the possibility rather
 * than to correct each call. There is deliberately no generic
 * `uploadImage(kind, …)` here.
 *
 * A CHILD'S PHOTO IS NOT REACHABLE FROM HERE. `player-avatars` is a separate
 * private bucket under its own guardian-scoped policy. "Editable where shown"
 * applies to the account holder's own picture and to a club's brand.
 */

type Client = SupabaseClient<Database>

export type ImageResult = { ok: true } | { ok: false; message: string }

/** PNG, JPEG and WebP, matching what the website's two actions accept. */
const EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
}

/** 2MB, the same ceiling both web actions enforce. The pickers already resize and re-encode to well under it. */
const MAX_BYTES = 2 * 1024 * 1024

function checkFile(file: PickedFile): string | null {
  if (!EXTENSION[file.mimeType]) return "That picture needs to be a PNG, JPEG or WebP."
  if (file.sizeBytes > MAX_BYTES) return "That picture is too large. It needs to be under 2MB."
  return null
}

/**
 * THE SIGNED-IN PERSON'S OWN PICTURE.
 *
 * `auth.uid()` is the folder, so the own-path-only storage policy is what admits
 * the write. Nobody can change anybody else's picture through this path, whatever
 * a client passed, because there is no id to pass.
 */
export async function replaceMyAvatar(supabase: Client, file: PickedFile): Promise<ImageResult> {
  const invalid = checkFile(file)
  if (invalid) return { ok: false, message: invalid }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: "Sign in again to change your picture." }

  const bytes = await readFileBytes(file.uri)
  if (!bytes) return { ok: false, message: "That picture couldn't be read. Try choosing it again." }

  const { data: existing } = await supabase.from("profiles").select("avatar_storage_path").eq("id", user.id).maybeSingle()
  const path = `${user.id}/avatar-${Date.now()}.${EXTENSION[file.mimeType]}`

  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, bytes, { contentType: file.mimeType, upsert: false })
  if (uploadError) return fail(uploadError, "your picture")

  const { data: linked, error: linkError } = await supabase
    .from("profiles")
    .update({ avatar_storage_path: path })
    .eq("id", user.id)
    .select("id")
  if (linkError || !linked?.length) {
    // THE LINK IS THE CHANGE. An upload that is not linked is an orphan file, so
    // it is removed rather than left behind -- and a refused UPDATE returns zero
    // ROWS rather than an error under RLS, which is why the row count is checked
    // and not just the error.
    await supabase.storage.from("avatars").remove([path])
    return fail(linkError ?? { message: "permission denied" }, "your picture")
  }

  if (existing?.avatar_storage_path && existing.avatar_storage_path !== path) {
    await supabase.storage.from("avatars").remove([existing.avatar_storage_path])
  }
  return { ok: true }
}

/** Clearing the column IS the removal; the storage delete is cleanup, not the boundary. */
export async function removeMyAvatar(supabase: Client): Promise<ImageResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: "Sign in again to change your picture." }

  const { data: existing } = await supabase.from("profiles").select("avatar_storage_path").eq("id", user.id).maybeSingle()
  const { data: cleared, error } = await supabase.from("profiles").update({ avatar_storage_path: null }).eq("id", user.id).select("id")
  if (error || !cleared?.length) return fail(error ?? { message: "permission denied" }, "your picture")
  if (existing?.avatar_storage_path) await supabase.storage.from("avatars").remove([existing.avatar_storage_path])
  return { ok: true }
}

/**
 * MAY THIS PERSON CHANGE THIS CLUB'S CREST?
 *
 * Asked of `my_capabilities` at club scope, which is the same engine
 * `club_logos_insert_club_admin` evaluates -- so the answer the control is drawn
 * from and the answer the write is judged by come from one place. A false here
 * means the crest stays a picture rather than becoming a control that fails.
 */
export async function canManageClubCrest(supabase: Client, clubId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("my_capabilities", {
    p_scope_type: "club",
    p_club_id: clubId,
  })
  if (error) return false
  return (data ?? []).some((row) => row.capability_key === "club.logo.manage" && row.allowed === true)
}

/**
 * THE CLUB'S OWN CREST.
 *
 * The club id is the first path segment, which is exactly what the storage policy
 * reads, so passing somebody else's club id produces a refusal rather than a
 * write. `clubs.logo_storage_path` is then the one column every surface resolves
 * a crest from -- the club's own upload first, the Club Directory's branding logo
 * as the fallback, and nothing else.
 */
export async function replaceClubCrest(supabase: Client, clubId: string, file: PickedFile): Promise<ImageResult> {
  const invalid = checkFile(file)
  if (invalid) return { ok: false, message: invalid }

  const bytes = await readFileBytes(file.uri)
  if (!bytes) return { ok: false, message: "That picture couldn't be read. Try choosing it again." }

  const { data: existing } = await supabase.from("clubs").select("logo_storage_path").eq("id", clubId).maybeSingle()
  const path = `${clubId}/logo-${Date.now()}.${EXTENSION[file.mimeType]}`

  const { error: uploadError } = await supabase.storage
    .from("club-logos")
    .upload(path, bytes, { contentType: file.mimeType, upsert: false })
  if (uploadError) return fail(uploadError, "this club's crest")

  const { data: linked, error: linkError } = await supabase
    .from("clubs")
    .update({ logo_storage_path: path })
    .eq("id", clubId)
    .select("id")
  if (linkError || !linked?.length) {
    await supabase.storage.from("club-logos").remove([path])
    return fail(linkError ?? { message: "permission denied" }, "this club's crest")
  }

  if (existing?.logo_storage_path && existing.logo_storage_path !== path) {
    await supabase.storage.from("club-logos").remove([existing.logo_storage_path])
  }
  return { ok: true }
}

/**
 * Removing the club's own upload.
 *
 * The crest does NOT disappear: the canonical resolver falls back to the Club
 * Directory's branding logo, which is a real identity for the club rather than a
 * blank. That is what "remove" means here, and it is what the website's own
 * remove action does.
 */
export async function removeClubCrest(supabase: Client, clubId: string): Promise<ImageResult> {
  const { data: existing } = await supabase.from("clubs").select("logo_storage_path").eq("id", clubId).maybeSingle()
  const { data: cleared, error } = await supabase.from("clubs").update({ logo_storage_path: null }).eq("id", clubId).select("id")
  if (error || !cleared?.length) return fail(error ?? { message: "permission denied" }, "this club's crest")
  if (existing?.logo_storage_path) await supabase.storage.from("club-logos").remove([existing.logo_storage_path])
  return { ok: true }
}

function fail(error: unknown, subject: string): ImageResult {
  const problem = friendly(error, subject)
  logDetail("identity image", problem)
  return { ok: false, message: problem.retryable ? problem.message : `You cannot change ${subject}.` }
}

/**
 * A CHILD'S PICTURE (CA-M9): the private `player-avatars` bucket, the path in the child's own folder,
 * then `set_player_avatar` -- the canonical operation, which verifies the path belongs to that player
 * and that this caller may edit the player's profile as family. The bucket's own policies re-check the
 * same authority on the upload. Never the person's bucket, never a team's.
 */
export async function replaceChildAvatar(supabase: Client, playerId: string, file: PickedFile): Promise<ImageResult> {
  const invalid = checkFile(file)
  if (invalid) return { ok: false, message: invalid }
  const bytes = await readFileBytes(file.uri)
  if (!bytes) return { ok: false, message: "That picture couldn't be read. Try choosing it again." }
  const path = `${playerId}/avatar-${Date.now()}.${EXTENSION[file.mimeType]}`
  const { error: uploadError } = await supabase.storage.from("player-avatars").upload(path, bytes, { contentType: file.mimeType, upsert: true })
  if (uploadError) return fail(uploadError, "this picture")
  const { error } = await supabase.rpc("set_player_avatar", { p_player_id: playerId, p_storage_path: path })
  if (error) {
    await supabase.storage.from("player-avatars").remove([path])
    return fail(error, "this picture")
  }
  return { ok: true }
}

export async function removeChildAvatar(supabase: Client, playerId: string): Promise<ImageResult> {
  const { error } = await supabase.rpc("set_player_avatar", { p_player_id: playerId, p_storage_path: "" })
  if (error) return fail(error, "this picture")
  return { ok: true }
}
