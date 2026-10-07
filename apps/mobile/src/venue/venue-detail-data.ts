import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@ovalball/contracts/database"
import { createClubPitch } from "@ovalball/contracts/club/venues"
import { setPitchCover, uploadPitchCoverPhoto } from "@ovalball/contracts/pitch-media"
import { createVenueChangingRoom } from "@ovalball/contracts/club/venues"
import { setChangingRoomCover, uploadChangingRoomCoverPhoto } from "@ovalball/contracts/changing-room-media"

import { readFileBytes } from "../messages/pickers"
import type { PitchDraft } from "./create-venue-logic"
import type { ChangingRoomDraft } from "./create-venue-logic"

type Client = SupabaseClient<Database>

/**
 * ADD A PITCH TO AN EXISTING VENUE -- the same two-step create-then-apply-photo shape the Add Venue
 * wizard already established (`create-venue-data.ts`), reused here rather than duplicated: a stock
 * photo travels inline with creation, an uploaded photo needs the pitch's own id first. This is the
 * ONE creation path for a pitch reached from Venue Detail's Pitches tab, sharing `createClubPitch` and
 * `setPitchCover`/`uploadPitchCoverPhoto` with every other pitch-creation surface.
 */
export async function addPitchToVenue(supabase: Client, clubId: string, venueId: string, draft: PitchDraft): Promise<string> {
  const pitchId = await createClubPitch(supabase, clubId, draft.name.trim(), venueId)
  if (draft.photo.kind === "stock") {
    await setPitchCover(supabase, pitchId, { stockKey: draft.photo.key }).catch(() => undefined)
  } else if (draft.photo.kind === "upload") {
    const bytes = await readFileBytes(draft.photo.localUri)
    if (bytes) {
      const uploaded = await uploadPitchCoverPhoto(supabase, clubId, pitchId, bytes, draft.photo.mimeType)
      if (uploaded.ok) await setPitchCover(supabase, pitchId, { storagePath: uploaded.path }).catch(() => undefined)
    }
  }
  return pitchId
}

/**
 * ADD A CHANGING ROOM TO AN EXISTING VENUE -- the same shape as `addPitchToVenue`, but a single
 * changing room only (Venue Detail's own quantity control expands client-side into N sequential
 * creations, each individually addressable from the moment it exists -- never a decorative count).
 */
export async function addChangingRoomToVenue(supabase: Client, clubId: string, venueId: string, draft: ChangingRoomDraft): Promise<string[]> {
  const quantity = Math.max(1, Math.round(draft.quantity))
  const ids: string[] = []
  for (let i = 1; i <= quantity; i++) {
    const name = quantity === 1 ? draft.name.trim() : `${draft.name.trim()} ${i}`
    const stockKey = draft.photo.kind === "stock" ? draft.photo.key : null
    const roomId = await createVenueChangingRoom(supabase, clubId, venueId, name, draft.roomType, stockKey)
    if (draft.photo.kind === "upload") {
      const bytes = await readFileBytes(draft.photo.localUri)
      if (bytes) {
        const uploaded = await uploadChangingRoomCoverPhoto(supabase, clubId, roomId, bytes, draft.photo.mimeType)
        if (uploaded.ok) await setChangingRoomCover(supabase, roomId, { storagePath: uploaded.path }).catch(() => undefined)
      }
    }
    ids.push(roomId)
  }
  return ids
}
