import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

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

export type BodyRole = "BODY_ADMIN" | "BODY_COMPETITIONS" | "BODY_VIEWER"

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
}

/** How a body type reads to a person, rather than as a database enum. */
export const BODY_TYPE_LABEL: Record<string, string> = {
  GEOGRAPHIC: "County union",
  ARMED_FORCES: "Armed forces union",
  UNIVERSITY: "University union",
  SCHOOLS: "Schools union",
  REFEREES: "Referees' society",
}

export const BODY_ROLE_LABEL: Record<BodyRole, string> = {
  BODY_ADMIN: "Administrator",
  BODY_COMPETITIONS: "Competitions",
  BODY_VIEWER: "Viewer",
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
  }))
}
