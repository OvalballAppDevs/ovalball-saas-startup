import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@ovalball/contracts/database"
import { readClubVenues } from "@ovalball/contracts/club/venues"
import { setVenueCover, uploadVenueCoverPhoto } from "@ovalball/contracts/venue-media"
import { setPitchCover, uploadPitchCoverPhoto } from "@ovalball/contracts/pitch-media"
import { setChangingRoomCover, uploadChangingRoomCoverPhoto } from "@ovalball/contracts/changing-room-media"

import { readFileBytes } from "../messages/pickers"
import type { ChangingRoomDraft, PitchDraft, VenueWizardDraft } from "./create-venue-logic"
import { changingRoomDraftToPayload, pitchDraftToPayload } from "./create-venue-logic"

type Client = SupabaseClient<Database>

/**
 * ADD VENUE WIZARD'S OWN SUBMISSION -- one atomic RPC (`create_venue_with_pitches`, Section: Venues &
 * Pitches wizard) for the venue, its address, its facilities and every pitch's canonical fields
 * (stock-photo selections travel inline, since a stock key needs no id to apply). An UPLOADED photo
 * cannot travel inline -- the storage path is keyed by the venue's/pitch's own id
 * (`{club}/venue-{id}/...`), which does not exist until this call returns -- so those are applied in a
 * second pass immediately afterwards, matched back to the pitches they belong to by name (pitch names
 * are unique per club -- `club_pitches_club_id_display_name_key` -- so this match is exact, never a
 * guess).
 */
export async function createVenueWithPitches(supabase: Client, clubId: string, draft: VenueWizardDraft): Promise<string> {
  const { data, error } = await supabase.rpc("create_venue_with_pitches", {
    p_club_id: clubId,
    p_name: draft.name.trim(),
    p_directions: null,
    p_line1: draft.line1.trim() || null,
    p_line2: draft.line2.trim() || null,
    p_town: draft.town.trim() || null,
    p_county: draft.county.trim() || null,
    p_postcode: draft.postcode.trim() || null,
    p_country: draft.country.trim() || null,
    p_set_default: draft.setPrimary,
    p_catering_available: draft.cateringAvailable,
    p_changing_rooms_available: draft.changingRoomsAvailable,
    p_cover_image_path: null,
    p_cover_stock_key: draft.photo.kind === "stock" ? draft.photo.key : null,
    p_pitches: draft.pitches.map(pitchDraftToPayload),
    p_changing_rooms: draft.changingRoomsAvailable ? draft.changingRooms.map(changingRoomDraftToPayload) : [],
    p_latitude: draft.resolvedLatitude,
    p_longitude: draft.resolvedLongitude,
    p_provider_ref: draft.addressProviderRef,
  } as never)
  if (error) throw error
  const venueId = data as string

  await applyPendingUploads(supabase, clubId, venueId, draft)
  return venueId
}

async function applyPendingUploads(supabase: Client, clubId: string, venueId: string, draft: VenueWizardDraft): Promise<void> {
  if (draft.photo.kind === "upload") {
    const bytes = await readFileBytes(draft.photo.localUri)
    if (bytes) {
      const uploaded = await uploadVenueCoverPhoto(supabase, clubId, venueId, bytes, draft.photo.mimeType)
      if (uploaded.ok) await setVenueCover(supabase, venueId, { storagePath: uploaded.path }).catch(() => undefined)
    }
  }

  const pitchesNeedingUpload = draft.pitches.filter((p): p is PitchDraft & { photo: { kind: "upload"; localUri: string; mimeType: string } } => p.photo.kind === "upload")
  if (pitchesNeedingUpload.length === 0) return

  const { pitches } = await readClubVenues(supabase, clubId)
  const createdPitches = pitches.filter((p) => p.venueId === venueId)
  for (const draftPitch of pitchesNeedingUpload) {
    const match = createdPitches.find((p) => p.displayName.trim().toLowerCase() === draftPitch.name.trim().toLowerCase())
    if (!match) continue
    const bytes = await readFileBytes(draftPitch.photo.localUri)
    if (!bytes) continue
    const uploaded = await uploadPitchCoverPhoto(supabase, clubId, match.id, bytes, draftPitch.photo.mimeType)
    if (uploaded.ok) await setPitchCover(supabase, match.id, { storagePath: uploaded.path }).catch(() => undefined)
  }

  if (!draft.changingRoomsAvailable) return
  const changingRoomsNeedingUpload = draft.changingRooms.filter((r): r is ChangingRoomDraft & { photo: { kind: "upload"; localUri: string; mimeType: string } } => r.photo.kind === "upload")
  if (changingRoomsNeedingUpload.length === 0) return

  const { data: createdRooms, error: roomsError } = await supabase.from("venue_changing_rooms").select("id, display_name").eq("venue_id", venueId)
  if (roomsError) return
  const rooms = createdRooms ?? []

  for (const draftRoom of changingRoomsNeedingUpload) {
    const baseName = draftRoom.name.trim().toLowerCase()
    // Quantity expansion means one draft entry becomes N rows named "Name" (qty 1) or "Name 1".."Name N"
    // (qty > 1) -- every expanded row for this entry gets the same uploaded photo.
    const matches = rooms.filter((r) => {
      const created = r.display_name.trim().toLowerCase()
      return created === baseName || /^\d+$/.test(created.slice(baseName.length + 1)) && created.startsWith(`${baseName} `)
    })
    if (matches.length === 0) continue
    const bytes = await readFileBytes(draftRoom.photo.localUri)
    if (!bytes) continue
    for (const match of matches) {
      const uploaded = await uploadChangingRoomCoverPhoto(supabase, clubId, match.id, bytes, draftRoom.photo.mimeType)
      if (uploaded.ok) await setChangingRoomCover(supabase, match.id, { storagePath: uploaded.path }).catch(() => undefined)
    }
  }
}

export async function countClubVenues(supabase: Client, clubId: string): Promise<number> {
  const { venues } = await readClubVenues(supabase, clubId)
  return venues.length
}
