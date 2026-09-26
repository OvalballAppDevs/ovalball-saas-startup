import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

type Client = SupabaseClient<Database>

/**
 * CLUBHOUSE PROGRAMME SECTIONS 15/16 -- LOOKING FOR OPPOSITION / OPPORTUNITY MATCHING.
 *
 * The one shared read/write layer for both clients over the current migration
 * (20270560000000_looking_for_opposition_current.sql) -- the parked draft this reconciles against was
 * never applied. Every function here is a thin forward to a SECURITY DEFINER RPC that re-checks its own
 * authority; nothing here decides anything the server does not also decide.
 *
 * DISTANCE AND PARTNERSHIP ARE DELIBERATELY NOT COMPUTED HERE. find_fixture_opportunities returns raw,
 * already-public club_directory location facts for the publishing club (never its venue -- Section 3's
 * own architecture note). The caller combines an FixtureOpportunity's publishingClubDirectory* fields
 * with its own already-known origin via the EXISTING resolveClubLocation/distanceMiles
 * (map-read-model.ts) -- never a second geo calculation. Partnership state is similarly left to the
 * caller, which already has the Clubhouse markers list (buildPartnershipIndex/resolvePartnershipStatus)
 * for the clubs in view.
 */

export type FixtureOpportunityVenuePreference = "home" | "away" | "either"
export type FixtureOpportunityAvailability = "unknown" | "no_known_clash" | "busy"
export type FixtureOpportunityResponseStatus = "pending" | "accepted" | "declined" | "withdrawn" | "superseded"

export interface FixtureOpportunity {
  id: string
  proposedDate: string
  kickoffTime: string | null
  venuePreference: FixtureOpportunityVenuePreference
  gameType: string | null
  note: string | null
  updatedAt: string
  /** True when the viewer's own team published this listing -- shown for management regardless of effective status (filled/cancelled/expired). */
  isMine: boolean
  publishingTeamId: string
  publishingTeamDisplayName: string
  publishingTeamRugbyCode: string | null
  publishingTeamCategory: string
  publishingTeamAgeGroup: string | null
  publishingTeamGender: string | null
  publishingTeamSquadDesignation: string | null
  publishingClubId: string
  publishingClubDirectoryId: string
  publishingClubName: string
  publishingClubLogoStoragePath: string | null
  /** Raw club_directory geo facts -- never the club's own venue. Combine with the caller's own origin via resolveClubLocation/distanceMiles for a real distance. */
  publishingClubDirectoryLatitude: number | null
  publishingClubDirectoryLongitude: number | null
  publishingClubDirectoryGeocodeStatus: string
  publishingClubSlug: string | null
  /** Never computed for the viewer's own (is_mine) rows -- only meaningful when discovering somebody else's listing. */
  myTeamAvailability: FixtureOpportunityAvailability | null
  myResponseId: string | null
  myResponseStatus: FixtureOpportunityResponseStatus | null
}

interface FixtureOpportunityRow {
  opportunity_id: string
  proposed_date: string
  kickoff_time: string | null
  venue_preference: string
  game_type: string | null
  note: string | null
  updated_at: string
  is_mine: boolean
  publishing_team_id: string
  publishing_team_display_name: string
  publishing_team_rugby_code: string | null
  publishing_team_category: string
  publishing_team_age_group: string | null
  publishing_team_gender: string | null
  publishing_team_squad_designation: string | null
  publishing_club_id: string
  publishing_club_directory_id: string
  publishing_club_name: string
  publishing_club_logo_storage_path: string | null
  publishing_club_directory_latitude: number | null
  publishing_club_directory_longitude: number | null
  publishing_club_directory_geocode_status: string
  publishing_club_slug: string | null
  my_team_availability: string | null
  my_response_id: string | null
  my_response_status: string | null
}

function projectOpportunity(r: FixtureOpportunityRow): FixtureOpportunity {
  return {
    id: r.opportunity_id,
    proposedDate: r.proposed_date,
    kickoffTime: r.kickoff_time,
    venuePreference: r.venue_preference as FixtureOpportunityVenuePreference,
    gameType: r.game_type,
    note: r.note,
    updatedAt: r.updated_at,
    isMine: r.is_mine,
    publishingTeamId: r.publishing_team_id,
    publishingTeamDisplayName: r.publishing_team_display_name,
    publishingTeamRugbyCode: r.publishing_team_rugby_code,
    publishingTeamCategory: r.publishing_team_category,
    publishingTeamAgeGroup: r.publishing_team_age_group,
    publishingTeamGender: r.publishing_team_gender,
    publishingTeamSquadDesignation: r.publishing_team_squad_designation,
    publishingClubId: r.publishing_club_id,
    publishingClubDirectoryId: r.publishing_club_directory_id,
    publishingClubName: r.publishing_club_name,
    publishingClubLogoStoragePath: r.publishing_club_logo_storage_path,
    publishingClubDirectoryLatitude: r.publishing_club_directory_latitude,
    publishingClubDirectoryLongitude: r.publishing_club_directory_longitude,
    publishingClubDirectoryGeocodeStatus: r.publishing_club_directory_geocode_status,
    publishingClubSlug: r.publishing_club_slug,
    myTeamAvailability: r.my_team_availability as FixtureOpportunityAvailability | null,
    myResponseId: r.my_response_id,
    myResponseStatus: r.my_response_status as FixtureOpportunityResponseStatus | null,
  }
}

/** Section 16: one batched read -- the viewer's own live listings plus every other genuinely open, compatible one. */
export async function readFixtureOpportunities(supabase: Client, teamId: string): Promise<FixtureOpportunity[]> {
  const { data, error } = await supabase.rpc("find_fixture_opportunities", { p_team_id: teamId })
  if (error) throw error
  return ((data ?? []) as unknown as FixtureOpportunityRow[]).map(projectOpportunity)
}

export interface PublishFixtureOpportunityInput {
  teamId: string
  date: string
  kickoffTime?: string | null
  venuePreference: FixtureOpportunityVenuePreference
  gameType?: string | null
  note?: string | null
}

export async function publishFixtureOpportunity(supabase: Client, input: PublishFixtureOpportunityInput): Promise<string> {
  const { data, error } = await supabase.rpc("publish_fixture_opportunity", {
    p_team_id: input.teamId,
    p_date: input.date,
    p_kickoff_time: (input.kickoffTime ?? null) as unknown as string,
    p_venue_preference: input.venuePreference,
    p_game_type: (input.gameType ?? null) as unknown as string,
    p_note: input.note?.trim() || undefined,
  })
  if (error) throw error
  return data as unknown as string
}

export async function cancelFixtureOpportunity(supabase: Client, opportunityId: string, expectedUpdatedAt?: string | null): Promise<void> {
  const { error } = await supabase.rpc("cancel_fixture_opportunity", { p_opportunity_id: opportunityId, p_expected_updated_at: expectedUpdatedAt ?? undefined })
  if (error) throw error
}

export async function respondToFixtureOpportunity(supabase: Client, opportunityId: string, respondingTeamId: string, note?: string | null): Promise<string> {
  const { data, error } = await supabase.rpc("respond_to_fixture_opportunity", {
    p_opportunity_id: opportunityId,
    p_responding_team_id: respondingTeamId,
    p_note: note?.trim() || undefined,
  })
  if (error) throw error
  return data as unknown as string
}

export async function withdrawFixtureOpportunityResponse(supabase: Client, responseId: string): Promise<void> {
  const { error } = await supabase.rpc("withdraw_fixture_opportunity_response", { p_response_id: responseId })
  if (error) throw error
}

export async function declineFixtureOpportunityResponse(supabase: Client, responseId: string): Promise<void> {
  const { error } = await supabase.rpc("decline_fixture_opportunity_response", { p_response_id: responseId })
  if (error) throw error
}

export interface FixtureOpportunityResponseRow {
  id: string
  respondingTeamId: string
  respondingTeamDisplayName: string
  respondingTeamCategory: string
  respondingTeamAgeGroup: string | null
  respondingTeamGender: string | null
  respondingTeamSquadDesignation: string | null
  respondingTeamRugbyCode: string | null
  respondingClubName: string | null
  note: string | null
  status: FixtureOpportunityResponseStatus
  createdAt: string
  decidedAt: string | null
}

interface RawResponseRow {
  id: string
  responding_team_id: string
  note: string | null
  status: string
  created_at: string
  decided_at: string | null
  teams: {
    display_name: string
    category: string
    age_group: string | null
    gender: string | null
    squad_designation: string | null
    rugby_code: string | null
    clubs: { club_directory: { name: string } | null } | null
  } | null
}

/**
 * Core flow F ("Review responses"): every response to ONE of the viewer's own opportunities, with the
 * responding team's identity for display. RLS-governed, not a SECURITY DEFINER bypass --
 * fixture_opportunity_responses_select_scoped already admits the publisher (fixture.request.respond) to
 * every response on their own listing; this is a plain read through that policy, fetched on demand
 * (per-opportunity) rather than batched into find_fixture_opportunities, which stays a lean discovery
 * read.
 */
export async function readFixtureOpportunityResponses(supabase: Client, opportunityId: string): Promise<FixtureOpportunityResponseRow[]> {
  const { data, error } = await supabase
    .from("fixture_opportunity_responses")
    .select(
      "id, responding_team_id, note, status, created_at, decided_at, teams(display_name, category, age_group, gender, squad_designation, rugby_code, clubs(club_directory(name)))"
    )
    .eq("opportunity_id", opportunityId)
    .order("created_at", { ascending: true })
  if (error) throw error
  return ((data ?? []) as unknown as RawResponseRow[]).map((r) => ({
    id: r.id,
    respondingTeamId: r.responding_team_id,
    respondingTeamDisplayName: r.teams?.display_name ?? "A team",
    respondingTeamCategory: r.teams?.category ?? "youth",
    respondingTeamAgeGroup: r.teams?.age_group ?? null,
    respondingTeamGender: r.teams?.gender ?? null,
    respondingTeamSquadDesignation: r.teams?.squad_designation ?? null,
    respondingTeamRugbyCode: r.teams?.rugby_code ?? null,
    respondingClubName: r.teams?.clubs?.club_directory?.name ?? null,
    note: r.note,
    status: r.status as FixtureOpportunityResponseStatus,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
  }))
}

export interface AcceptFixtureOpportunityResponseResult {
  ok: true
  fixtureId: string
}

export type AcceptFixtureOpportunityResponseError = {
  ok: false
  /** True only for the specific "an open request between these teams for this date already exists" refusal (errcode 23505) -- the pre-existing request's id is carried in the Postgres error's `hint` field so the caller can offer a real route to it. */
  isDuplicateRequest: boolean
  existingRequestId: string | null
  message: string
}

/**
 * Never throws for the one refusal that needs a specific, actionable client response (an existing open
 * fixture_requests row already covers this pair/date) -- everything else still throws, matching every
 * other wrapper in this module.
 */
export async function acceptFixtureOpportunityResponse(
  supabase: Client,
  responseId: string,
  expectedUpdatedAt?: string | null
): Promise<AcceptFixtureOpportunityResponseResult | AcceptFixtureOpportunityResponseError> {
  const { data, error } = await supabase.rpc("accept_fixture_opportunity_response", { p_response_id: responseId, p_expected_updated_at: expectedUpdatedAt ?? undefined })
  if (error) {
    if (error.code === "23505") {
      return { ok: false, isDuplicateRequest: true, existingRequestId: error.hint ?? null, message: error.message }
    }
    throw error
  }
  return { ok: true, fixtureId: data as unknown as string }
}
