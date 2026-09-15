import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

/**
 * The canonical personal-avatar rule: `profiles.avatar_storage_path` (bucket `avatars`), completely independent
 * of club logo (lib/app-context/club-logo.ts) -- no fallback chain, no directory-seeded default, because a
 * personal avatar genuinely has only the one source. Every consumer other than the upload/remove actions
 * themselves (which need the raw path, not a resolved URL) calls these instead.
 *
 * The bucket is private (Identity/Auth Slice 4a, Phase 2 Z-12): a picture is served through a short-lived signed
 * URL minted with the viewer's own session, so the bucket's policy decides who sees it -- an adult's picture any
 * signed-in person, a minor's only the minor, their guardians and the staff who may view them. A picture the
 * viewer may not see resolves to null and the interface shows initials.
 */
const SIGNED_URL_SECONDS = 60 * 60

export async function resolvePersonalAvatarUrl(supabase: SupabaseClient<Database>, avatarStoragePath: string | null | undefined): Promise<string | null> {
  if (!avatarStoragePath) return null
  const { data } = await supabase.storage.from("avatars").createSignedUrl(avatarStoragePath, SIGNED_URL_SECONDS)
  return data?.signedUrl ?? null
}

/** Many pictures in one round trip; the map is keyed by storage path and omits any the viewer may not see. */
export async function resolvePersonalAvatarUrls(
  supabase: SupabaseClient<Database>,
  avatarStoragePaths: Iterable<string | null | undefined>
): Promise<Map<string, string>> {
  const paths = Array.from(new Set(Array.from(avatarStoragePaths).filter((p): p is string => Boolean(p))))
  const urls = new Map<string, string>()
  if (paths.length === 0) return urls
  const { data } = await supabase.storage.from("avatars").createSignedUrls(paths, SIGNED_URL_SECONDS)
  for (const row of data ?? []) {
    if (row.path && row.signedUrl && !row.error) urls.set(row.path, row.signedUrl)
  }
  return urls
}
