"use server"

import { revalidatePath } from "next/cache"

import {
  acceptFixtureOpportunityResponse,
  cancelFixtureOpportunity,
  declineFixtureOpportunityResponse,
  publishFixtureOpportunity,
  readClubhouseMarkers,
  readFixtureOpportunities,
  readFixtureOpportunityResponses,
  respondToFixtureOpportunity,
  withdrawFixtureOpportunityResponse,
  type ClubMapMarker,
  type FixtureOpportunity,
  type FixtureOpportunityResponseRow,
  type FixtureOpportunityVenuePreference,
} from "@ovalball/contracts/clubhouse"

import { createClient } from "@/lib/supabase/server"

export interface OpportunitiesRawData {
  opportunities: FixtureOpportunity[]
  /** For distance/partnership only -- combined client-side with resolveClubLocation/distanceMiles/resolvePartnershipStatus, never a second calculation here. */
  markers: ClubMapMarker[]
}

/** One round trip: the discovery/management read plus the same marker population the map already uses, for distance/partnership context. */
export async function getOpportunitiesData(teamId: string, viewerClubId: string | null, viewerTeamId: string | null): Promise<OpportunitiesRawData> {
  const supabase = await createClient()
  const [opportunities, markers] = await Promise.all([readFixtureOpportunities(supabase, teamId), readClubhouseMarkers(supabase, viewerClubId, viewerTeamId)])
  return { opportunities, markers }
}

export type OpportunityActionResult = { ok: true } | { ok: false; error: string }

export async function getOpportunityResponses(opportunityId: string): Promise<FixtureOpportunityResponseRow[]> {
  const supabase = await createClient()
  return readFixtureOpportunityResponses(supabase, opportunityId)
}

export async function publishOpportunity(
  teamId: string,
  date: string,
  kickoffTime: string | null,
  venuePreference: FixtureOpportunityVenuePreference,
  gameType: string | null,
  note: string | null
): Promise<OpportunityActionResult> {
  const supabase = await createClient()
  try {
    await publishFixtureOpportunity(supabase, { teamId, date, kickoffTime, venuePreference, gameType, note })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not publish this listing." }
  }
  revalidatePath("/clubhouse/opportunities")
  return { ok: true }
}

export async function cancelOpportunity(opportunityId: string, expectedUpdatedAt: string | null): Promise<OpportunityActionResult> {
  const supabase = await createClient()
  try {
    await cancelFixtureOpportunity(supabase, opportunityId, expectedUpdatedAt)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not cancel this listing." }
  }
  revalidatePath("/clubhouse/opportunities")
  return { ok: true }
}

export async function respondToOpportunity(opportunityId: string, respondingTeamId: string, note: string | null): Promise<OpportunityActionResult> {
  const supabase = await createClient()
  try {
    await respondToFixtureOpportunity(supabase, opportunityId, respondingTeamId, note)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not send this response." }
  }
  revalidatePath("/clubhouse/opportunities")
  return { ok: true }
}

export async function withdrawOpportunityResponse(responseId: string): Promise<OpportunityActionResult> {
  const supabase = await createClient()
  try {
    await withdrawFixtureOpportunityResponse(supabase, responseId)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not withdraw this response." }
  }
  revalidatePath("/clubhouse/opportunities")
  return { ok: true }
}

export async function declineOpportunityResponse(responseId: string): Promise<OpportunityActionResult> {
  const supabase = await createClient()
  try {
    await declineFixtureOpportunityResponse(supabase, responseId)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not decline this response." }
  }
  revalidatePath("/clubhouse/opportunities")
  return { ok: true }
}

export type AcceptOpportunityResponseResult =
  | { ok: true }
  | { ok: false; isDuplicateRequest: true; existingRequestId: string | null; error: string }
  | { ok: false; isDuplicateRequest: false; error: string }

export async function acceptOpportunityResponse(responseId: string, expectedUpdatedAt: string | null): Promise<AcceptOpportunityResponseResult> {
  const supabase = await createClient()
  try {
    const result = await acceptFixtureOpportunityResponse(supabase, responseId, expectedUpdatedAt)
    if (!result.ok) {
      return { ok: false, isDuplicateRequest: result.isDuplicateRequest, existingRequestId: result.existingRequestId, error: result.message }
    }
  } catch (error) {
    return { ok: false, isDuplicateRequest: false, error: error instanceof Error ? error.message : "Could not accept this response." }
  }
  revalidatePath("/clubhouse/opportunities")
  revalidatePath("/fixtures")
  return { ok: true }
}
