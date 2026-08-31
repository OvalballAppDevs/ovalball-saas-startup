"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type SaveClubProfileResult = { ok: true } | { ok: false; error: string }

export interface ClubProfileInput {
  clubId: string
  bio: string
  website: string
  facebookUrl: string
  addressDisplay: string
}

/**
 * Only ever touches `clubs` columns -- never club_directory (the canonical,
 * governing-body-sourced record). RLS (clubs_update_admin: is_site_admin()
 * or is_club_admin(id)) is the real boundary; this action doesn't check
 * authorization itself.
 */
export async function saveClubProfile(input: ClubProfileInput): Promise<SaveClubProfileResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("clubs")
    .update({
      bio: input.bio || null,
      website: input.website || null,
      facebook_url: input.facebookUrl || null,
      address_display: input.addressDisplay || null,
    })
    .eq("id", input.clubId)

  if (error) return { ok: false, error: error.message }
  revalidatePath("/club")
  return { ok: true }
}

export type UploadLogoResult = { ok: true; path: string } | { ok: false; error: string }

const MAX_LOGO_BYTES = 2 * 1024 * 1024
const ALLOWED_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"])

export async function uploadClubLogo(clubId: string, formData: FormData): Promise<UploadLogoResult> {
  const file = formData.get("logo")
  if (!(file instanceof File)) {
    return { ok: false, error: "No file provided." }
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { ok: false, error: "Logo must be under 2MB." }
  }
  if (!ALLOWED_LOGO_TYPES.has(file.type)) {
    return { ok: false, error: "Logo must be PNG, JPEG, WebP, or SVG." }
  }

  const supabase = await createClient()

  // Ownership check up front, before touching Storage -- the bucket policy
  // (club_logos_insert_club_admin) is the real enforcement, but failing
  // fast with a clear message here avoids a confusing generic Storage error
  // for the common case of an unauthorised attempt.
  const { data: club } = await supabase.from("clubs").select("id").eq("id", clubId).maybeSingle()
  if (!club) {
    return { ok: false, error: "Club not found or you don't have access to it." }
  }

  const extension = file.name.split(".").pop() ?? "png"
  const path = `${clubId}/logo-${Date.now()}.${extension}`

  const { error: uploadError } = await supabase.storage.from("club-logos").upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (uploadError) return { ok: false, error: uploadError.message }

  const { error: updateError } = await supabase.from("clubs").update({ logo_storage_path: path }).eq("id", clubId)
  if (updateError) return { ok: false, error: updateError.message }

  revalidatePath("/club")
  revalidatePath(`/club/${clubId}`, "page")
  return { ok: true, path }
}

/**
 * Clears the reference and removes the Storage object -- never leaves an
 * orphaned file behind. clubs.logo_storage_path going to null is what
 * actually "removes" the crest from every screen that reads it (club
 * profile, public page, nav); the Storage delete is cleanup, not the
 * authorization boundary (club_logos_delete_club_admin already covers it).
 */
export async function removeClubLogo(clubId: string): Promise<SaveClubProfileResult> {
  const supabase = await createClient()

  const { data: club } = await supabase.from("clubs").select("logo_storage_path").eq("id", clubId).maybeSingle()
  if (!club) return { ok: false, error: "Club not found or you don't have access to it." }

  const { error: updateError } = await supabase.from("clubs").update({ logo_storage_path: null }).eq("id", clubId)
  if (updateError) return { ok: false, error: updateError.message }

  if (club.logo_storage_path) {
    await supabase.storage.from("club-logos").remove([club.logo_storage_path])
  }

  revalidatePath("/club")
  return { ok: true }
}

export type ClubContact = {
  id: string
  role: "fixture_secretary" | "minis_secretary" | "general"
  name: string
  phone: string | null
  email: string | null
  isPublic: boolean
}

export interface SaveContactInput {
  clubId: string
  id?: string
  role: ClubContact["role"]
  name: string
  phone: string
  email: string
  isPublic: boolean
}

/**
 * One upsert action for both create and edit -- club_contacts_write_admin /
 * club_contacts_update_admin (both is_club_admin(club_id)) are the real
 * boundary. Used for the club's public-facing phone/email presence rather
 * than adding raw phone/email columns to `clubs` -- club_contacts already
 * models exactly this (named contact + role + is_public) and already has
 * full CRUD RLS, so reusing it avoids a second, parallel profile-contact
 * system.
 */
export async function saveClubContact(input: SaveContactInput): Promise<SaveClubProfileResult> {
  if (!input.name.trim()) return { ok: false, error: "Name is required." }

  const supabase = await createClient()
  const row = {
    club_id: input.clubId,
    role: input.role,
    name: input.name.trim(),
    phone: input.phone.trim() || null,
    email: input.email.trim() || null,
    is_public: input.isPublic,
  }

  const { error } = input.id
    ? await supabase.from("club_contacts").update(row).eq("id", input.id)
    : await supabase.from("club_contacts").insert(row)

  if (error) return { ok: false, error: error.message }
  revalidatePath("/club")
  return { ok: true }
}

export async function deleteClubContact(contactId: string): Promise<SaveClubProfileResult> {
  const supabase = await createClient()
  const { error } = await supabase.from("club_contacts").delete().eq("id", contactId)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club")
  return { ok: true }
}
