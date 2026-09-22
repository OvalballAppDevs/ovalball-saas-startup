import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "./database"

import { BODY_ROLE_ALLOWS, BODY_ROLE_LABEL, BODY_ROLES, type BodyRole } from "./governing-roles"

// One authority for what a role is CALLED and what it ALLOWS; re-exported so a page needs one import.
export { BODY_ROLE_ALLOWS, BODY_ROLE_LABEL, BODY_ROLES }
export type { BodyRole }

/**
 * CONVERGENCE STEP 14 — the governing body read model.
 *
 * Every field here comes from the server, including whether this viewer may manage anything. The UI
 * never decides authority: `get_governing_body` refuses a viewer with no relationship outright, so
 * nothing coming back means "not yours", never "hidden in the browser".
 *
 * Kept in lib/ rather than inside a page component on purpose: a future Ovalball mobile client will
 * need the same answers, and business decisions should not live in a React tree.
 */


export interface GoverningBody {
  bodyId: string
  canonicalName: string
  shortName: string | null
  bodyType: string
  rugbyCode: string
  nation: string
  active: boolean
  sourceUrl: string | null
  sourceCheckedOn: string | null
  myRole: BodyRole | null
  canManage: boolean
  canManageCompetitions: boolean
  affiliatedClubCount: number
  competitionCount: number
}

export interface GoverningBodySummary {
  bodyId: string
  canonicalName: string
  shortName: string | null
  bodyType: string
  myRole: BodyRole
}

export interface AffiliatedClub {
  directoryId: string
  name: string
  town: string | null
  county: string | null
  isOnOvalball: boolean
  /** Set where the club is on Ovalball — its own public home at /club/{slug}, which is where a county officer legitimately goes to look at a club. */
  clubSlug: string | null
  homeGround: string | null
  website: string | null
  rugbyCode: string
}

/** How a body type reads to a person, rather than as a database enum. */
export const BODY_TYPE_LABEL: Record<string, string> = {
  GEOGRAPHIC: "County union",
  ARMED_FORCES: "Armed forces union",
  UNIVERSITY: "University union",
  SCHOOLS: "Schools union",
  REFEREES: "Referees' society",
}


export async function loadMyGoverningBodies(supabase: SupabaseClient<Database>): Promise<GoverningBodySummary[]> {
  const { data, error } = await supabase.rpc("my_governing_bodies")
  if (error || !data) return []
  return data.map((r) => ({
    bodyId: r.body_id,
    canonicalName: r.canonical_name,
    shortName: r.short_name,
    bodyType: r.body_type,
    myRole: r.my_role as BodyRole,
  }))
}

export async function loadGoverningBody(
  supabase: SupabaseClient<Database>,
  bodyId: string
): Promise<GoverningBody | null> {
  const { data, error } = await supabase.rpc("get_governing_body", { p_body_id: bodyId })
  if (error || !data?.[0]) return null
  const r = data[0]
  return {
    bodyId: r.body_id,
    canonicalName: r.canonical_name,
    shortName: r.short_name,
    bodyType: r.body_type,
    rugbyCode: r.rugby_code,
    nation: r.nation,
    active: r.active,
    sourceUrl: r.source_url,
    sourceCheckedOn: r.source_checked_on,
    myRole: (r.my_role as BodyRole | null) ?? null,
    canManage: r.can_manage,
    canManageCompetitions: r.can_manage_competitions,
    affiliatedClubCount: r.affiliated_club_count,
    competitionCount: r.competition_count,
  }
}

export async function loadAffiliatedClubs(
  supabase: SupabaseClient<Database>,
  bodyId: string
): Promise<AffiliatedClub[]> {
  const { data, error } = await supabase.rpc("governing_body_clubs", { p_body_id: bodyId })
  if (error || !data) return []
  return data.map((r) => ({
    directoryId: r.directory_id,
    name: r.name,
    town: r.town,
    county: r.county,
    isOnOvalball: r.is_on_ovalball,
    clubSlug: r.club_slug,
    homeGround: r.home_ground,
    website: r.website,
    rugbyCode: r.rugby_code,
  }))
}

/* ===================================================================================================
 * CONVERGENCE STEP 15 — the rest of the read model.
 *
 * Still in lib/ and still server-shaped, for the reason above: a native client will need the same
 * answers, and none of these decisions belongs in a React tree. Every `can*` flag here arrives from
 * the database, per row, so a page never has to guess whether a control will be refused.
 * =================================================================================================*/

export interface BodyPerson {
  userId: string
  fullName: string | null
  /** Only returned to somebody who can already manage access here — see governing_body_people. */
  email: string | null
  roleKey: BodyRole
  state: "ACTIVE" | "SUSPENDED" | "REVOKED"
  grantedAt: string
  grantedByName: string | null
  isMe: boolean
}

export interface BodyCompetition {
  competitionId: string
  name: string
  slug: string
  rugbyCode: string
  format: string | null
  active: boolean
  /** The current edition, or null where no season is registered yet — a legible state, not an error. */
  editionId: string | null
  seasonName: string | null
  enteredCount: number
  matchCount: number
  resultCount: number
  /** From internal.can_organise_competition — the same predicate the mutations use. */
  canOrganise: boolean
}


export async function loadBodyPeople(supabase: SupabaseClient<Database>, bodyId: string): Promise<BodyPerson[]> {
  const { data, error } = await supabase.rpc("governing_body_people", { p_body_id: bodyId })
  if (error || !data) return []
  return data.map((r) => ({
    userId: r.user_id,
    fullName: r.full_name,
    email: r.email,
    roleKey: r.role_key as BodyRole,
    state: r.state as BodyPerson["state"],
    grantedAt: r.granted_at,
    grantedByName: r.granted_by_name,
    isMe: r.is_me,
  }))
}

export async function loadBodyCompetitions(
  supabase: SupabaseClient<Database>,
  bodyId: string
): Promise<BodyCompetition[]> {
  const { data, error } = await supabase.rpc("governing_body_competitions", { p_body_id: bodyId })
  if (error || !data) return []
  return data.map((r) => ({
    competitionId: r.competition_id,
    name: r.name,
    slug: r.slug,
    rugbyCode: r.rugby_code,
    format: r.format,
    active: r.active,
    editionId: r.edition_id,
    seasonName: r.season_name,
    enteredCount: r.entered_count,
    matchCount: r.match_count,
    resultCount: r.result_count,
    canOrganise: r.can_organise,
  }))
}

/** How a competition's real state reads to somebody running it, rather than as four raw counts. */
export function competitionProgress(c: BodyCompetition): string {
  if (!c.editionId) return "No season registered yet"
  if (c.enteredCount === 0) return "No teams entered yet"
  if (c.matchCount === 0) return `${c.enteredCount} teams entered · no matches drawn`
  if (c.resultCount === 0) return `${c.enteredCount} teams · ${c.matchCount} matches · no results yet`
  if (c.resultCount >= c.matchCount) return `${c.enteredCount} teams · all ${c.matchCount} matches played`
  return `${c.enteredCount} teams · ${c.resultCount} of ${c.matchCount} matches played`
}

/* ===================================================================================================
 * CONVERGENCE STEP 16 — invitations, and one competition's real outcome.
 * =================================================================================================*/

export interface BodyInvitation {
  invitationId: string
  invitedEmail: string
  roleKey: BodyRole
  expiresAt: string
  issuedAt: string
  issuedByName: string | null
  resendCount: number
  /** From internal.can_administer_invitation — the same predicate revoke and resend use. */
  canAdminister: boolean
  /**
   * Answered by the database, not by the browser.
   *
   * Comparing `expiresAt` with `Date.now()` during a render is an impure call whose answer changes
   * between renders — the same defect Step 10 removed from the team page, and the lint rule catches it.
   */
  expiresSoon: boolean
}

export async function loadBodyInvitations(
  supabase: SupabaseClient<Database>,
  bodyId: string
): Promise<BodyInvitation[]> {
  const { data, error } = await supabase.rpc("governing_body_invitations", { p_body_id: bodyId })
  if (error || !data) return []
  return data.map((r) => ({
    invitationId: r.invitation_id,
    invitedEmail: r.invited_email,
    roleKey: r.role_key as BodyRole,
    expiresAt: r.expires_at,
    issuedAt: r.issued_at,
    issuedByName: r.issued_by_name,
    resendCount: r.resend_count,
    canAdminister: r.can_administer,
    expiresSoon: r.expires_soon,
  }))
}

export interface BodyCompetitionMatch {
  matchId: string
  editionId: string
  seasonName: string
  roundNumber: number | null
  stageKind: string | null
  matchDate: string | null
  kickoffTime: string | null
  status: string
  verificationState: string | null
  homeParticipantId: string | null
  awayParticipantId: string | null
  homeLabel: string | null
  awayLabel: string | null
  homeScore: number | null
  awayScore: number | null
  venueLabel: string | null
  /** Neither side is on Ovalball. The organiser still owns the match, and it still counts. */
  isExternalOnly: boolean
}

export async function loadBodyCompetitionMatches(
  supabase: SupabaseClient<Database>,
  competitionId: string
): Promise<BodyCompetitionMatch[]> {
  const { data, error } = await supabase.rpc("governing_body_competition_matches", {
    p_competition_id: competitionId,
  })
  if (error || !data) return []
  return data.map((r) => ({
    matchId: r.match_id,
    editionId: r.edition_id,
    seasonName: r.season_name,
    roundNumber: r.round_number,
    stageKind: r.stage_kind,
    matchDate: r.match_date,
    kickoffTime: r.kickoff_time,
    status: r.status,
    verificationState: r.verification_state,
    homeParticipantId: r.home_participant_id,
    awayParticipantId: r.away_participant_id,
    homeLabel: r.home_label,
    awayLabel: r.away_label,
    homeScore: r.home_score,
    awayScore: r.away_score,
    venueLabel: r.venue_label,
    isExternalOnly: r.is_external_only,
  }))
}

/**
 * Which season a new competition would be in, from the canonical register.
 *
 * Delegated to `public.current_competition_season`, which delegates to `internal.competition_season_for`
 * — the same resolver that actually files the edition. Null means the register has no current or
 * upcoming season for this code, which the product states rather than papering over.
 */
export async function loadCurrentCompetitionSeason(
  supabase: SupabaseClient<Database>,
  rugbyCode: string
): Promise<string | null> {
  const { data } = await supabase.rpc("current_competition_season", { p_rugby_code: rugbyCode }).maybeSingle()
  return data?.season_name ?? null
}
