import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import type { KitConfig, KitPattern } from "../agenda/kit"
import { clubLogoUrlFromPath, resolveClubLogoPathFrom } from "../club-logo"
import { resolveClubTheme, type ClubTheme } from "./theme"

type Client = SupabaseClient<Database>

/**
 * CLUB BRANDING, for both clients (CA-M2).
 *
 * THREE IDENTITIES, NEVER CONFUSED. A PERSON has an avatar (`profiles.avatar_storage_path`); a CLUB
 * has a crest (`clubs.logo_storage_path`, falling back to the Club Directory's branding logo); a
 * KIT is playing colours (`club_kits`). This module carries the club's two -- crest and kit -- and
 * never the person's. The crest URL below comes from the logo columns only; a kit is never a crest.
 *
 * ONE COLOUR SOURCE. A club's colours are derived from its home kit by `resolveClubTheme`; there is no
 * "mobile primary colour" and no branding colour table. Changing the home kit changes the theme.
 *
 * READS go to the tables under RLS, as the website's Club Profile page reads them. The kit WRITE is
 * the existing domain operation `upsert_club_kit` (club.profile.edit at the club; the CHECK
 * constraints validate pattern and colours). The crest write is the storage bucket's own policy
 * (`club-logos`, club.logo.manage) plus `clubs.logo_storage_path`, which the app's
 * `identity/images.ts` and the website's actions both already use -- not repeated here.
 */

export type KitVariant = "primary" | "alternate"

export interface ClubBranding {
  clubId: string
  clubName: string | null
  crest: {
    url: string | null
    /** own = the club's upload; directory = the Club Directory's branding logo; none = initials. */
    source: "own" | "directory" | "none"
  }
  kits: Record<KitVariant, KitConfig | null>
  /** The theme every club surface derives from the home kit. */
  theme: ClubTheme
}

export async function readClubBranding(supabase: Client, clubId: string): Promise<ClubBranding | null> {
  const [{ data: club, error }, { data: kits }] = await Promise.all([
    supabase.from("clubs").select("id, logo_storage_path, club_directory(name, logo_storage_path)").eq("id", clubId).maybeSingle(),
    supabase.from("club_kits").select("variant, pattern, primary_colour, secondary_colour, accent_colour").eq("club_id", clubId),
  ])
  if (error) throw error
  if (!club) return null
  const byVariant: Record<KitVariant, KitConfig | null> = { primary: null, alternate: null }
  for (const k of kits ?? []) {
    if (k.variant === "primary" || k.variant === "alternate") {
      byVariant[k.variant] = { pattern: k.pattern as KitPattern, primaryColour: k.primary_colour, secondaryColour: k.secondary_colour, accentColour: k.accent_colour }
    }
  }
  const path = resolveClubLogoPathFrom(club.logo_storage_path, club.club_directory?.logo_storage_path)
  return {
    clubId: club.id,
    clubName: club.club_directory?.name ?? null,
    crest: { url: clubLogoUrlFromPath(supabase, path), source: club.logo_storage_path ? "own" : club.club_directory?.logo_storage_path ? "directory" : "none" },
    kits: byVariant,
    theme: resolveClubTheme(byVariant.primary),
  }
}

/** The kit domain operation. Throws the server's own error (42501 no authority, 23514 a value the CHECK constraints refuse). */
export async function saveClubKit(supabase: Client, clubId: string, variant: KitVariant, kit: KitConfig): Promise<void> {
  const { error } = await supabase.rpc("upsert_club_kit", {
    p_club_id: clubId,
    p_variant: variant,
    p_pattern: kit.pattern,
    p_primary_colour: kit.primaryColour,
    p_secondary_colour: kit.secondaryColour ?? undefined,
    p_accent_colour: kit.accentColour ?? undefined,
  })
  if (error) throw error
}

export interface BrandingCapabilities {
  /** club.logo.manage: replace or remove the crest. */
  crest: boolean
  /** club.profile.edit: change the kit (the same key the website's Club Profile page gates on). */
  kit: boolean
}

/** Asked of the server in one round trip; never derived from a role. */
export async function readBrandingCapabilities(supabase: Client, clubId: string): Promise<BrandingCapabilities> {
  const { data, error } = await supabase.rpc("my_capabilities", { p_scope_type: "club", p_club_id: clubId })
  if (error) return { crest: false, kit: false }
  const allowed = new Set((data ?? []).filter((r) => r.allowed === true).map((r) => r.capability_key))
  return { crest: allowed.has("club.logo.manage"), kit: allowed.has("club.profile.edit") }
}

/** One error rule for kit saves, shared with the website's action wording. */
export function kitErrorMessage(error: unknown, fallback: string): string {
  const e = (error ?? {}) as { code?: string; message?: string }
  if (e.code === "23514") return "That kit isn't valid — check the pattern and colour values."
  if (e.code === "42501") return "You don't have permission to change this club's kit."
  return fallback
}
