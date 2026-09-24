import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@ovalball/contracts/database"
import { articleImagePath, articleImageUrl, IMAGE_EXTENSION, MAX_IMAGE_BYTES, isArticleImageInUse } from "@ovalball/contracts/club/content"

import { readFileBytes, type PickedFile } from "../../messages/pickers"

/**
 * AN ARTICLE'S PICTURE, into the club's own folder of the PUBLIC `club-news-media` bucket.
 *
 * THE UPLOAD IS THE AUTHORITY CHECK, and it is the database's: the bucket's policy resolves
 * `internal.may_manage_club_news_media(name)` from the path's club and team segments, so a tampered
 * id fails at storage rather than here. The path shape is the website's (`{club}/{team|club}/{id}.ext`)
 * and the extension comes from the verified type, never from the file's name. Nothing here decides who
 * may write; it asks nothing and lets the write answer.
 */
export type UploadResult = { ok: true; path: string; url: string } | { ok: false; message: string }

/** A path segment that reveals nothing. `crypto.randomUUID` is not in every React Native runtime. */
function randomId(): string {
  const parts: string[] = []
  for (let i = 0; i < 4; i += 1) parts.push(Math.random().toString(36).slice(2, 10))
  return `${Date.now().toString(36)}-${parts.join("")}`
}

export async function uploadArticleImage(supabase: SupabaseClient<Database>, clubId: string, teamId: string | null, file: PickedFile): Promise<UploadResult> {
  const ext = IMAGE_EXTENSION[file.mimeType === "image/jpg" ? "image/jpeg" : file.mimeType]
  if (!ext) return { ok: false, message: "Use a JPG, PNG or WebP image." }
  if (file.sizeBytes > MAX_IMAGE_BYTES) return { ok: false, message: "That image is larger than 5MB. Choose a smaller one." }
  const bytes = await readFileBytes(file.uri)
  if (!bytes) return { ok: false, message: "That picture couldn't be read. Try choosing it again." }
  const path = articleImagePath(clubId, teamId, randomId(), ext)
  const { error } = await supabase.storage.from("club-news-media").upload(path, bytes, { contentType: file.mimeType === "image/jpg" ? "image/jpeg" : file.mimeType, upsert: false })
  if (error) return { ok: false, message: "The image could not be uploaded. Check you can write news here and try again." }
  return { ok: true, path, url: articleImageUrl(supabase, path) ?? "" }
}

/** Removes an image uploaded in the editor but never saved to an article. Cleanup, not a boundary. */
export async function discardArticleImage(supabase: SupabaseClient<Database>, path: string): Promise<void> {
  const inUse = await isArticleImageInUse(supabase, path)
  if (inUse) return
  await supabase.storage.from("club-news-media").remove([path])
}
