import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

export interface DataQualityCounts {
  total: number
  verified: number
  needsReview: number
  conflicting: number
  missingAddress: number
  missingTown: number
  missingCounty: number
  missingCountry: number
  missingPostcode: number
  missingHomeGround: number
  missingConstituentBody: number
  missingWebsite: number
  missingLogo: number
  potentialDuplicates: number
}

/**
 * Every count here reads from admin_club_overview (the same
 * security_invoker view the Club Management grid and the per-club Data
 * Quality tab already use) or from club_directory_research_proposals --
 * never a second, parallel definition of what "missing" or "verified"
 * means. flag_unverified in particular is EXACTLY `verification_status
 * NOT ILIKE '%verified%'` (see 20260831200000_admin_club_overview.sql) --
 * this dashboard's "Needs Review" bucket is that same flag, not a
 * reinvented heuristic.
 *
 * "Conflicting" is deliberately NOT derived from verification_status at
 * all (no row is ever seeded with a literal "conflicting" status) --
 * it's the count of directory rows with at least one pending research
 * proposal marked status='conflicting', i.e. a real output of the research
 * pipeline itself, never guessed.
 */
export async function getDataQualityCounts(supabase: SupabaseClient<Database>): Promise<DataQualityCounts> {
  const overview = () => supabase.from("admin_club_overview").select("directory_id", { count: "exact", head: true })

  const [
    { count: total },
    { count: unverified },
    { count: missingAddress },
    { count: missingTown },
    { count: missingCounty },
    { count: missingCountry },
    { count: missingPostcode },
    { count: missingHomeGround },
    { count: missingConstituentBody },
    { count: missingWebsite },
    { count: missingLogo },
    { count: duplicateNormalized },
    { count: conflictingDirectoryCount },
  ] = await Promise.all([
    overview(),
    overview().eq("flag_unverified", true),
    overview().or("address.is.null,address.eq."),
    overview().eq("flag_missing_town", true),
    overview().or("county.is.null,county.eq."),
    overview().or("country.is.null,country.eq."),
    overview().eq("flag_missing_postcode", true),
    overview().or("home_ground.is.null,home_ground.eq."),
    overview().or("constituent_body.is.null,constituent_body.eq."),
    overview().eq("flag_missing_website", true),
    overview().eq("flag_missing_logo", true),
    overview().eq("flag_duplicate_normalized_key", true),
    supabase
      .from("club_directory_research_proposals")
      .select("directory_id", { count: "exact", head: true })
      .eq("status", "conflicting"),
  ])

  const totalN = total ?? 0
  const unverifiedN = unverified ?? 0

  return {
    total: totalN,
    verified: totalN - unverifiedN,
    needsReview: unverifiedN,
    conflicting: conflictingDirectoryCount ?? 0,
    missingAddress: missingAddress ?? 0,
    missingTown: missingTown ?? 0,
    missingCounty: missingCounty ?? 0,
    missingCountry: missingCountry ?? 0,
    missingPostcode: missingPostcode ?? 0,
    missingHomeGround: missingHomeGround ?? 0,
    missingConstituentBody: missingConstituentBody ?? 0,
    missingWebsite: missingWebsite ?? 0,
    missingLogo: missingLogo ?? 0,
    potentialDuplicates: duplicateNormalized ?? 0,
  }
}

export interface PendingProposal {
  id: string
  directoryId: string
  clubName: string
  field: string
  currentValue: string | null
  proposedValue: string
  source: string
  sourceUrl: string | null
  confidence: string
  status: string
  conflictReason: string | null
  researchedAt: string
}

export async function getPendingResearchProposals(supabase: SupabaseClient<Database>): Promise<PendingProposal[]> {
  const { data } = await supabase
    .from("club_directory_research_proposals")
    .select("id, directory_id, field, current_value, proposed_value, source, source_url, confidence, status, conflict_reason, researched_at, club_directory(name)")
    .in("status", ["pending", "conflicting"])
    .order("researched_at", { ascending: false })

  return (data ?? []).map((p) => ({
    id: p.id,
    directoryId: p.directory_id,
    clubName: p.club_directory?.name ?? "Unknown club",
    field: p.field,
    currentValue: p.current_value,
    proposedValue: p.proposed_value,
    source: p.source,
    sourceUrl: p.source_url,
    confidence: p.confidence,
    status: p.status,
    conflictReason: p.conflict_reason,
    researchedAt: p.researched_at,
  }))
}
