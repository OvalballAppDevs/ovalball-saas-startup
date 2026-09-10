import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { resolveClubLogoPath } from "@/lib/app-context/club-logo"
import { getSiteUrl } from "@/lib/site-url"
import type { Database } from "@/types/database.types"

/**
 * The club crest URL an email may embed -- never a raw storage URL, always a
 * stable path on Ovalball's own origin, and never emitted at all unless the
 * club genuinely has an image.
 *
 * WHY THIS EXISTS SEPARATELY FROM resolveClubLogoUrl (lib/app-context/club-logo.ts)
 *
 * That function is correct for in-app UI: a signed-in Site Admin's browser
 * loading `supabase.storage.getPublicUrl()` is an ordinary web request to
 * Ovalball's own Supabase project, and the club-logos bucket also allows SVG,
 * which is fine for a page a browser renders as HTML. Neither is fine inside
 * a transactional email: every image in Ovalball mail must resolve to
 * Ovalball's OWN origin (the same invariant the brand logo route exists to
 * hold), and SVG is a script-bearing format no mail client should be asked to
 * parse. `/email-assets/club-crest/[clubId]` is the seam that enforces both
 * -- see its route handler for the content-type gate.
 *
 * WHY THIS RETURNS null RATHER THAN A URL THAT MIGHT 404
 *
 * clubIdentity() renders no placeholder when logoUrl is null -- "a broken
 * image icon in an invitation reads as a broken product" is the whole reason
 * that renderer takes a nullable URL at all. So the caller must know BEFORE
 * building the email's data whether a crest genuinely exists; this resolves
 * that once, here, rather than every call site re-deriving it.
 */
export async function resolveClubCrestEmailUrl(
  supabase: SupabaseClient<Database>,
  clubId: string | null
): Promise<string | null> {
  if (!clubId) return null
  const { data: club } = await supabase
    .from("clubs")
    .select("logo_storage_path, club_directory(logo_storage_path)")
    .eq("id", clubId)
    .maybeSingle()
  if (!club || !resolveClubLogoPath(club)) return null
  // The URL names the CLUB, never the file: exactly the brand logo's own
  // permanence property, so an email sent today keeps working if the crest
  // is changed tomorrow, and the route -- not this URL -- decides which
  // bytes that stable address serves.
  return `${getSiteUrl()}/email-assets/club-crest/${clubId}`
}

/**
 * The same for an OPPONENT that has never claimed an Ovalball account -- a
 * `club_directory` row with no `clubs` row yet. Deliberately a separate
 * function rather than an optional second parameter on the one above: a
 * claimed club and an unclaimed directory entry are different tables with
 * different ids, and folding them into one signature is how a caller ends up
 * passing a directory id where a club id was expected.
 */
export async function resolveDirectoryCrestEmailUrl(
  supabase: SupabaseClient<Database>,
  directoryId: string | null
): Promise<string | null> {
  if (!directoryId) return null
  const { data: directory } = await supabase
    .from("club_directory")
    .select("logo_storage_path")
    .eq("id", directoryId)
    .maybeSingle()
  if (!directory?.logo_storage_path) return null
  return `${getSiteUrl()}/email-assets/directory-crest/${directoryId}`
}
