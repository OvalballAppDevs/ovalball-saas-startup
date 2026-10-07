import { resolveVenueCover } from "@ovalball/contracts/venue-cover"
import { resolvePitchCover } from "@ovalball/contracts/pitch-cover"
import { resolveChangingRoomCover } from "@ovalball/contracts/changing-room-cover"

import { supabase } from "../../auth/supabase"
import { coverPhotoSource } from "../../media/stock-assets"

/**
 * THE PICTURE FOR A GROUND, PITCH OR CHANGING ROOM -- through the one Stock Media Library.
 *
 * A host club on Ovalball: the record's own canonical cover, or the library picture its club chose for it, by
 * the same resolver every venue screen uses. Nothing chosen, or a host that is not on Ovalball: the library's
 * one fallback rule, seeded by the record (or, with no record, the match) -- the same picture on every visit,
 * every device and every surface, and labelled as illustrative wherever it is shown.
 */
type Cover = { coverImagePath: string | null; coverStockKey: string | null }
export type PhotoSource = { uri: string } | number

/**
 * Whether the record has a PHOTOGRAPH of its own -- an uploaded cover. A library picture, chosen or standing in,
 * is Ovalball's illustration of a ground like this one, never this ground, and is labelled so wherever it is
 * large enough to be mistaken for the place.
 */
export function hasOwnPicture(cover: Cover | null | undefined): boolean {
  return Boolean(cover?.coverImagePath)
}

export function venuePhoto(cover: Cover | null, seed: string): PhotoSource {
  return coverPhotoSource("VENUE", cover ? resolveVenueCover({ supabase, ...cover }) : { kind: "none" }, seed)
}

export function pitchPhoto(cover: Cover | null, seed: string): PhotoSource {
  return coverPhotoSource("PITCH", cover ? resolvePitchCover({ supabase, ...cover }) : { kind: "none" }, seed)
}

export function roomPhoto(cover: Cover | null, seed: string): PhotoSource {
  return coverPhotoSource("CHANGING_ROOM", cover ? resolveChangingRoomCover({ supabase, ...cover }) : { kind: "none" }, seed)
}
