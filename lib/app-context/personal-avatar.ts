import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

/**
 * The canonical personal-avatar rule: `profiles.avatar_storage_path` (bucket
 * `avatars`), completely independent of club logo (lib/app-context/club-
 * logo.ts) -- no fallback chain, no directory-seeded default, because a
 * personal avatar genuinely has only the one source. Found duplicated
 * across 4 independent read call sites before this pass (each doing its
 * own `getPublicUrl` call); this is the one place every consumer other
 * than the upload/remove actions themselves (which need the raw path, not
 * a resolved URL) should call instead.
 */
export function resolvePersonalAvatarUrl(supabase: SupabaseClient<Database>, avatarStoragePath: string | null | undefined): string | null {
  return avatarStoragePath ? supabase.storage.from("avatars").getPublicUrl(avatarStoragePath).data.publicUrl : null
}
