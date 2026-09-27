import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { clubCoverUrlFromPath, resolveClubLogoUrl } from "../club-logo"

type Client = SupabaseClient<Database>

/**
 * THE CLUB PROFILE, for both clients (CA-M1).
 *
 * Four fields the club writes about itself (`clubs.bio`, `website`, `facebook_url`,
 * `address_display`) and its public-facing contacts (`club_contacts`). The club's NAME is not here:
 * it belongs to the Club Directory, the governing-body-sourced record, and no client edits it. The
 * crest is not here either -- it is the picture in the header, and changing it is done there
 * (`identity/images.ts` on the phone, the Club Profile page on the web), writing to the one
 * canonical `clubs.logo_storage_path`.
 *
 * READS go to the tables under RLS, exactly as the website's page reads them. WRITES go through the
 * domain operations `update_club_profile`, `save_club_contact` and `delete_club_contact`, which
 * carry the authority, the validation and the audit for every client. A client never writes these
 * tables directly, and never decides for itself whether it may.
 */

export type ClubContactRole = "fixture_secretary" | "minis_secretary" | "general"

export const CLUB_CONTACT_ROLE_LABEL: Record<ClubContactRole, string> = {
  fixture_secretary: "Fixture Secretary",
  minis_secretary: "Minis Secretary",
  general: "General Enquiries",
}

export const CLUB_CONTACT_ROLES: ClubContactRole[] = ["fixture_secretary", "minis_secretary", "general"]

export interface ClubContact {
  id: string
  role: ClubContactRole
  name: string
  phone: string | null
  email: string | null
  isPublic: boolean
}

export interface ClubProfileFields {
  bio: string
  website: string
  facebookUrl: string
  addressDisplay: string
}

export interface ClubProfile extends ClubProfileFields {
  clubId: string
  /** From the Club Directory: read-only here. */
  clubName: string | null
  town: string | null
  contacts: ClubContact[]
  /** When the row was last changed, by any client -- what a screen re-reads against. */
  updatedAt: string | null
  /** DISPLAY ONLY here: the crest is edited from Branding (`clubs.logo_storage_path`), never duplicated
   * as a second mutation path on this screen. */
  logoUrl: string | null
  /** Public profile hero image (`clubs.cover_storage_path`) -- editable HERE, alongside bio/website,
   * because it is presentation content on this same profile, not identity. */
  coverUrl: string | null
}

export const EMPTY_CLUB_PROFILE_FIELDS: ClubProfileFields = { bio: "", website: "", facebookUrl: "", addressDisplay: "" }

/** The club's profile as the tables hold it now. Null when the club is not readable by this person. */
export async function readClubProfile(supabase: Client, clubId: string): Promise<ClubProfile | null> {
  const [{ data: club, error }, { data: contacts }] = await Promise.all([
    supabase
      .from("clubs")
      .select("id, bio, website, facebook_url, address_display, updated_at, logo_storage_path, cover_storage_path, club_directory(name, town, logo_storage_path)")
      .eq("id", clubId)
      .maybeSingle(),
    supabase.from("club_contacts").select("id, role, name, phone, email, is_public").eq("club_id", clubId).order("created_at"),
  ])
  if (error) throw error
  if (!club) return null
  return {
    clubId: club.id,
    clubName: club.club_directory?.name ?? null,
    town: club.club_directory?.town ?? null,
    bio: club.bio ?? "",
    website: club.website ?? "",
    facebookUrl: club.facebook_url ?? "",
    addressDisplay: club.address_display ?? "",
    updatedAt: club.updated_at ?? null,
    logoUrl: resolveClubLogoUrl(supabase, club),
    coverUrl: clubCoverUrlFromPath(supabase, club.cover_storage_path),
    contacts: (contacts ?? []).map((c) => ({
      id: c.id,
      role: c.role as ClubContactRole,
      name: c.name,
      phone: c.phone,
      email: c.email,
      isPublic: c.is_public,
    })),
  }
}

/** True when the two field sets differ after the same trimming the server applies -- what "unsaved changes" means. */
export function clubProfileFieldsDiffer(a: ClubProfileFields, b: ClubProfileFields): boolean {
  const t = (s: string) => s.trim()
  return t(a.bio) !== t(b.bio) || t(a.website) !== t(b.website) || t(a.facebookUrl) !== t(b.facebookUrl) || t(a.addressDisplay) !== t(b.addressDisplay)
}

/** The domain operation. Throws the server's own error (42501 for no authority, 22023 for a bad value, P0002 for a missing club). */
export async function updateClubProfile(supabase: Client, clubId: string, fields: ClubProfileFields): Promise<void> {
  const { error } = await supabase.rpc("update_club_profile", {
    p_club_id: clubId,
    p_bio: fields.bio,
    p_website: fields.website,
    p_facebook_url: fields.facebookUrl,
    p_address_display: fields.addressDisplay,
  })
  if (error) throw error
}

export interface ClubContactInput {
  role: ClubContactRole
  name: string
  phone: string
  email: string
  isPublic: boolean
}

/** Create (no contactId) or edit one contact through the domain operation. Returns the contact id. */
export async function saveClubContact(supabase: Client, clubId: string, contactId: string | null, input: ClubContactInput): Promise<string> {
  const { data, error } = await supabase.rpc("save_club_contact", {
    p_club_id: clubId,
    p_contact_id: contactId ?? undefined,
    p_role: input.role,
    p_name: input.name,
    p_phone: input.phone,
    p_email: input.email,
    p_is_public: input.isPublic,
  })
  if (error) throw error
  return data as string
}

export async function deleteClubContact(supabase: Client, contactId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_club_contact", { p_contact_id: contactId })
  if (error) throw error
}

/**
 * Whether THIS person may edit THIS club's profile, asked of the server (`my_capabilities`, the
 * same engine the domain operations and the row policies evaluate). A client draws its controls
 * from this answer and never from a role label; the write is still judged again by the server.
 */
export async function canEditClubProfile(supabase: Client, clubId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("my_capabilities", { p_scope_type: "club", p_club_id: clubId })
  if (error) return false
  return (data ?? []).some((row) => row.capability_key === "club.profile.edit" && row.allowed === true)
}

/**
 * What to tell the person when a domain operation refuses. The server's own sentence is shown for
 * the three outcomes it writes for people -- no authority (42501), a bad value (22023), a row that
 * is not there (P0002) -- and anything else is the fallback, so a driver or network fault never
 * reaches a screen verbatim. One rule for both clients.
 */
export function clubProfileErrorMessage(error: unknown, fallback: string): string {
  const e = (error ?? {}) as { code?: string; message?: string }
  if (e.code === "42501" || e.code === "22023" || e.code === "P0002") return e.message || fallback
  return fallback
}
