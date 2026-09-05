import "server-only"

import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, resolveActiveContext } from "./active-context"
import { buildNavItems } from "./build-nav-items"
import { resolvePersonalAvatarUrl } from "./personal-avatar"
import { getSessionContext } from "./session-context"
import { createClient } from "@/lib/supabase/server"

export interface PublicHeaderIdentity {
  fullName: string
  /**
   * Avatar-initials seed only -- empty when there's no real profile name
   * (e.g. a site-admin-only account with no club, so no profiles row).
   * Deliberately separate from fullName: UserAvatar has no way to tell a
   * real two-word name from a two-word placeholder sentence like "Ovalball
   * user", and would render nonsense initials ("OU") from it.
   */
  avatarSeed: string
  avatarUrl: string | null
  clubName: string | null
  roleLabel: string
  /** Where "Open Ovalball" should land -- the same guard app/(app)/layout.tsx itself uses, never a hardcoded /dashboard. */
  destination: string
}

/**
 * Minimal identity for the PUBLIC homepage header's account control --
 * deliberately only what's needed to render "Callum Smith / Fixture
 * Secretary / Burnley RUFC" and route "Open Ovalball" correctly. Never
 * fetches permissions/tokens for client JS; this whole thing runs
 * server-side in app/page.tsx and is passed down as plain props.
 * Returns null for a logged-out visitor -- the header shows "Sign In".
 */
export async function getPublicHeaderIdentity(): Promise<PublicHeaderIdentity | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const ctx = await getSessionContext(supabase, user)
  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, surname, avatar_storage_path")
    .eq("id", user.id)
    .maybeSingle()

  const avatarUrl = resolvePersonalAvatarUrl(supabase, profile?.avatar_storage_path)

  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const { roleLabel, clubName } = buildNavItems(ctx, activeContext)
  const destination = ctx.isSiteAdmin || ctx.clubMemberships.length > 0 ? "/dashboard" : "/welcome"
  const avatarSeed = [profile?.first_name, profile?.surname].filter(Boolean).join(" ")

  return {
    fullName: avatarSeed || "Ovalball user",
    avatarSeed,
    avatarUrl,
    clubName: ctx.clubMemberships.length > 0 ? clubName : null,
    roleLabel,
    destination,
  }
}
