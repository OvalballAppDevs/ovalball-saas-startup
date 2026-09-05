"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { searchUkAddresses, type AddressLookupResult } from "@/lib/address-lookup/lookup"

/**
 * Venue address lookup: any authenticated user, unlike Site Admin's own
 * club_directory lookupAddress (admin/clubs/[directoryId]/actions.ts).
 * searchUkAddresses is a stateless proxy to an external API keyed
 * server-side -- not sensitive on its own -- and the real write boundary
 * (Club Admin or Site Admin of this specific club) is already enforced by
 * create_venue/update_venue at save time, not here.
 */
export async function lookupVenueAddress(query: string): Promise<AddressLookupResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "You must be signed in." }
  if (query.trim().length < 3) return { status: "ok", candidates: [] }
  return searchUkAddresses(query)
}

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

export type UploadLogoResult = { ok: true; url: string } | { ok: false; error: string }

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
  // Same class of gap as the avatar upload action: the sidebar/context-
  // switcher club identity is rendered by the root (app) layout, which
  // page-level revalidation above does not touch -- without this the new
  // logo only shows on /club itself until a hard reload.
  revalidatePath("/", "layout")
  return { ok: true, url: supabase.storage.from("club-logos").getPublicUrl(path).data.publicUrl }
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
  revalidatePath("/", "layout")
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

export type ClubPitch = {
  id: string
  displayName: string
  description: string | null
  active: boolean
  sortOrder: number
}

/**
 * All four thin wrappers around the club_pitches RPCs -- can_manage_club_fixtures
 * (Site Admin / Club Admin / Fixture Secretary of this club) is the real
 * authorization boundary inside each RPC, not this action. Archiving
 * (set_club_pitch_active false) is the only removal path -- there is no
 * delete action here, matching the RPC surface (no hard-delete, ever, so a
 * pitch with historical fixture references is never orphaned).
 */
export async function createClubPitch(clubId: string, displayName: string, description: string): Promise<SaveClubProfileResult> {
  if (!displayName.trim()) return { ok: false, error: "A pitch name is required." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("create_club_pitch", {
    p_club_id: clubId,
    p_display_name: displayName.trim(),
    p_description: description.trim() || undefined,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club")
  return { ok: true }
}

export async function renameClubPitch(pitchId: string, newName: string): Promise<SaveClubProfileResult> {
  if (!newName.trim()) return { ok: false, error: "A pitch name is required." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("rename_club_pitch", { p_pitch_id: pitchId, p_new_name: newName.trim() })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club")
  return { ok: true }
}

export async function reorderClubPitches(clubId: string, pitchIds: string[]): Promise<SaveClubProfileResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("reorder_club_pitches", { p_club_id: clubId, p_pitch_ids: pitchIds })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club")
  return { ok: true }
}

export async function setClubPitchActive(pitchId: string, active: boolean): Promise<SaveClubProfileResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_club_pitch_active", { p_pitch_id: pitchId, p_active: active })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club")
  return { ok: true }
}

/**
 * Assigns (or clears) which Venue an existing pitch belongs to -- an
 * ordinary pitch-level write, so it stays under club_pitches' own
 * existing can_manage_club_fixtures RLS (the same authority that already
 * lets a Fixtures Secretary create/rename pitches), not the narrower
 * manage-venues boundary the Venue RPCs themselves require.
 */
export async function setClubPitchVenue(pitchId: string, venueId: string | null): Promise<SaveClubProfileResult> {
  const supabase = await createClient()
  const { error } = await supabase.from("club_pitches").update({ venue_id: venueId }).eq("id", pitchId)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/venues")
  return { ok: true }
}

export type ClubVenue = {
  id: string
  name: string
  address: string | null
  postcode: string | null
  directions: string | null
  active: boolean
  isDefaultHome: boolean
}

/**
 * Lookup Administration: Venues. A venue is a club-structural entity
 * (Club Admin / Site Admin only to create/edit/deactivate -- see
 * create_venue/update_venue/set_venue_active/set_default_venue's own RLS-
 * equivalent checks), distinct from club_pitches' broader
 * can_manage_club_fixtures write authority. Never a hard delete --
 * set_venue_active(false) is the only removal path.
 */
export async function createVenue(input: {
  clubId: string
  name: string
  address: string
  postcode: string
  directions: string
  setDefault: boolean
}): Promise<SaveClubProfileResult> {
  if (!input.name.trim()) return { ok: false, error: "A venue name is required." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("create_venue", {
    p_club_id: input.clubId,
    p_name: input.name.trim(),
    p_address: input.address.trim(),
    p_postcode: input.postcode.trim(),
    p_directions: input.directions.trim(),
    p_set_default: input.setDefault,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/venues")
  return { ok: true }
}

export async function updateVenue(input: { id: string; name: string; address: string; postcode: string; directions: string }): Promise<SaveClubProfileResult> {
  if (!input.name.trim()) return { ok: false, error: "A venue name is required." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("update_venue", {
    p_id: input.id,
    p_name: input.name.trim(),
    p_address: input.address.trim(),
    p_postcode: input.postcode.trim(),
    p_directions: input.directions.trim(),
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/venues")
  return { ok: true }
}

export async function setVenueActive(venueId: string, active: boolean): Promise<SaveClubProfileResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_venue_active", { p_id: venueId, p_active: active })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/venues")
  return { ok: true }
}

export async function setDefaultVenue(venueId: string): Promise<SaveClubProfileResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_default_venue", { p_id: venueId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/venues")
  return { ok: true }
}

export interface ClubMessagingPolicyInput {
  clubId: string
  useDefaultDirectAttachments: boolean
  allowDirectAttachments: boolean
  useDefaultDocumentLibrarySharing: boolean
  allowDocumentLibrarySharing: boolean
  useDefaultImageUploads: boolean
  allowImageUploads: boolean
  useDefaultContactCardSharing: boolean
  allowContactCardSharing: boolean
  useDefaultParticipantManagement: boolean
  allowParticipantManagement: boolean
}

/**
 * update_club_message_policy itself is the real authorization boundary
 * (is_club_admin(clubId) or Full Site Admin) and itself re-checks every
 * global *_club_override_allowed flag before accepting a non-default
 * value -- this action only forwards the call.
 */
export type SchedulingGroupMember = { id: string; displayName: string; ageGroup: string | null }
export type SchedulingGroup = { id: string; displayTag: string; alias: string | null; active: boolean; members: SchedulingGroupMember[] }

/**
 * create_scheduling_group / set_scheduling_group_members /
 * set_scheduling_group_active / set_scheduling_group_alias are the real
 * authorization + U6-U8-only-two-or-more-ages + season-binding boundary
 * (internal.validate_mini_rugby_team_set, internal.validate_scheduling_
 * group_season) -- these only forward the call. seasonId is required:
 * every Mini-Rugby Group belongs to exactly one season for its whole life
 * (Section 13/14) -- the caller resolves "current season" via the same
 * shared resolver Calendar uses, never a second guess here.
 */
export async function createSchedulingGroup(clubId: string, teamIds: string[], seasonId: string): Promise<SaveClubProfileResult> {
  if (teamIds.length < 2) return { ok: false, error: "Select at least two teams (different ages)." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("create_scheduling_group", { p_club_id: clubId, p_team_ids: teamIds, p_season_id: seasonId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club")
  return { ok: true }
}

export async function setSchedulingGroupAlias(groupId: string, alias: string): Promise<SaveClubProfileResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_scheduling_group_alias", { p_group_id: groupId, p_alias: alias })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club")
  return { ok: true }
}

export async function setSchedulingGroupMembers(groupId: string, teamIds: string[]): Promise<SaveClubProfileResult> {
  if (teamIds.length < 2) return { ok: false, error: "Select at least two teams (different ages)." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_scheduling_group_members", { p_group_id: groupId, p_team_ids: teamIds })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club")
  return { ok: true }
}

export async function setSchedulingGroupActive(groupId: string, active: boolean): Promise<SaveClubProfileResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_scheduling_group_active", { p_group_id: groupId, p_active: active })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club")
  return { ok: true }
}

export async function updateClubMessagingPolicy(input: ClubMessagingPolicyInput): Promise<SaveClubProfileResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("update_club_message_policy", {
    p_club_id: input.clubId,
    p_use_default_direct_attachments: input.useDefaultDirectAttachments,
    p_allow_direct_attachments: input.allowDirectAttachments,
    p_use_default_document_library_sharing: input.useDefaultDocumentLibrarySharing,
    p_allow_document_library_sharing: input.allowDocumentLibrarySharing,
    p_use_default_image_uploads: input.useDefaultImageUploads,
    p_allow_image_uploads: input.allowImageUploads,
    p_use_default_contact_card_sharing: input.useDefaultContactCardSharing,
    p_allow_contact_card_sharing: input.allowContactCardSharing,
    p_use_default_participant_management: input.useDefaultParticipantManagement,
    p_allow_participant_management: input.allowParticipantManagement,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club")
  return { ok: true }
}
