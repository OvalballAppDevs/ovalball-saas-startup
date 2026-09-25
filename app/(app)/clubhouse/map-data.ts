"use server"

import { readClubhouseMarkers, type ClubMapMarker, type ClubPartnershipStatus } from "@ovalball/contracts/clubhouse"

import { createClient } from "@/lib/supabase/server"

/**
 * CLUBHOUSE V1 CONSOLIDATION: this used to be its own query (`getPartnerClubsMapData`), duplicated
 * from nothing else -- now it is a thin wrapper around the ONE shared read model
 * (`packages/contracts/src/clubhouse/map-read-model.ts`) both clients call, so mobile and web can
 * never quietly disagree about what "On Ovalball", "Partner" or "hasLocation" mean. The function name
 * and the `MapClub` alias are kept so every existing consumer in this directory (`club-map.tsx`,
 * `partner-clubs-explorer.tsx`, `club-map-card.tsx`) needed no changes beyond this file.
 */
export type MapClubPartnershipStatus = ClubPartnershipStatus
export type MapClub = ClubMapMarker

export async function getPartnerClubsMapData(callerClubId: string | null, callerTeamId: string | null = null): Promise<MapClub[]> {
  const supabase = await createClient()
  return readClubhouseMarkers(supabase, callerClubId, callerTeamId)
}
