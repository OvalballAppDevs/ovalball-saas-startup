import "server-only"

/**
 * Online Directory Verification's per-club research step. Given one
 * canonical club_directory row, look it up against authoritative public
 * sources and return proposed field values (or "no result", or a flagged
 * conflict) -- never applies anything itself, matching the rest of this
 * app's staging-then-review pattern.
 *
 * Source priority policy (checked in this exact order, never violated):
 *   1. Official governing body (RFU / Scottish Rugby / WRU / IRFU / Rugby
 *      Australia-equivalent by nation, or the relevant league body)
 *   2. Official club website
 *   3. Official constituent body / competition source
 *   4. Other authoritative rugby source
 * A general web search is DISCOVERY ONLY -- it may help locate the club's
 * own site or governing-body listing, but its results are never treated
 * as canonical evidence on their own; every proposal's `source` must name
 * which of the four tiers above it actually came from.
 *
 * NOT CONNECTED in this local environment -- no research provider API key
 * is configured (see .env.example). This is genuinely wire-able code, not
 * a stub that pretends to work: with a real provider configured,
 * researchClub() would make real requests against real governing-body/
 * club-website sources and return real evidence. Locally it returns
 * status: "not_configured" for every club, so the run architecture (which
 * IS fully real and tested) reports honest "no authoritative result"
 * outcomes rather than fabricating research it never actually did -- the
 * same reasoning as lib/address-lookup/lookup.ts's own "not_configured"
 * path.
 */

export interface DirectoryVerificationProposal {
  field:
    | "name"
    | "country"
    | "nation"
    | "region"
    | "county"
    | "town"
    | "home_ground"
    | "address"
    | "postcode"
    | "website"
    | "official_email"
    | "constituent_body"
    | "notes"
  currentValue: string | null
  proposedValue: string
  source: string
  sourceUrl: string | null
  confidence: "high" | "medium" | "low"
}

export interface DirectoryVerificationRugbyCodeFlag {
  currentValue: string | null
  proposedValue: string
  reason: string
}

export interface ClubToResearch {
  directoryId: string
  name: string
  town: string | null
  county: string | null
  postcode: string | null
  website: string | null
  constituentBody: string | null
  rugbyCode: string | null
}

export type DirectoryVerificationResult =
  | { status: "not_configured" }
  | { status: "no_result" }
  | { status: "ok"; proposals: DirectoryVerificationProposal[]; logoCandidate: { sourceUrl: string; evidence: string } | null }
  | { status: "conflict"; proposals: DirectoryVerificationProposal[]; reason: string }
  | { status: "rugby_code_conflict"; flag: DirectoryVerificationRugbyCodeFlag }
  | { status: "error"; message: string }

export async function researchClub(_club: ClubToResearch): Promise<DirectoryVerificationResult> {
  // No provider configured locally -- see module comment. A real
  // integration would call the governing-body/club-website sources here,
  // in the priority order documented above, and return a real "ok" /
  // "conflict" / "rugby_code_conflict" / "no_result" outcome instead.
  return { status: "not_configured" }
}
