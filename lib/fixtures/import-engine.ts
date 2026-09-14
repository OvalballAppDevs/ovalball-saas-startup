import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import { teamsCanPlayFixture, type TeamEligibilityFields } from "./eligibility"
import { normaliseHeader } from "./header-vocabulary"
import { GAME_TYPE_OPTIONS } from "@/app/(app)/admin/fixtures/types"

/**
 * The ONE staged-CSV matching engine, shared by the Site Admin global
 * import (`app/(app)/admin/fixtures/import/`) and the club-scoped import
 * (`app/(app)/fixtures/import/`) -- one CSV contract, one resolution
 * algorithm, per the mega-spec's "no architectural shortcuts" requirement.
 * Extracted from the original Site-Admin-only implementation without
 * behavioural change for the unscoped (Site Admin) case; the only new
 * behaviour is `restrictHomeClubId`, which narrows the home-team search to
 * one specific club's own teams -- never a second matching algorithm.
 */

export const REQUIRED_IMPORT_COLUMNS = ["home_club", "home_team"] as const

/**
 * A CALL-SCOPED MEMO, AND NOTHING MORE.
 *
 * A season is repetitive by nature: the same five teams, the same dozen
 * opponents and the same two venues appear across a hundred rows. Resolving
 * each one from scratch on every row meant a 120-row paste issued several
 * hundred round trips to answer a few dozen distinct questions, and took
 * over half a minute.
 *
 * The cache changes NOTHING about what a lookup returns. Every key includes
 * every input that could change the answer -- including the club scope -- so
 * a hit is a question already asked with the same arguments in the same
 * call.
 *
 * IT IS CREATED PER CALL AND NEVER SHARED. That is the whole safety
 * argument: a cache that outlived one caller's request would be a cache that
 * could answer one person's question with another person's RLS-filtered
 * results. Callers pass a fresh Map or nothing at all.
 */
export type LookupCache = Map<string, unknown>

// PromiseLike, not Promise: a PostgREST builder is a thenable that is only
// dispatched when awaited, which is exactly what makes it cacheable here.
async function memo<T>(cache: LookupCache | undefined, key: string, run: () => PromiseLike<T>): Promise<T> {
  if (!cache) return run()
  if (cache.has(key)) return cache.get(key) as T
  const value = await run()
  cache.set(key, value)
  return value
}

export function normalizeGameType(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const match = GAME_TYPE_OPTIONS.find((g) => g.toLowerCase() === trimmed.toLowerCase())
  return match ?? null
}

/**
 * v2 export columns are `date`/`kickoff` (lib/fixtures/csv-schema.ts) --
 * a genuine export/import naming mismatch existed here previously
 * (export wrote `date`/`kickoff`, import only ever read the legacy
 * `fixture_date`/`kickoff_time` names), which meant downloading and
 * re-uploading the app's own export silently lost the date and kickoff
 * on every row. Both names are accepted, new name preferred, so a v2
 * export round-trips and an old hand-made v1-style file keeps working.
 */

/**
 * Reads one logical column, accepting any header that normalises to one of
 * the given names.
 *
 * AMBIGUITY IS NOT RESOLVED SILENTLY. If a file carries two different
 * headers that mean the same thing AND they disagree, picking one would
 * quietly discard the other -- so the disagreement is thrown and surfaces as
 * a row error the person can see and fix.
 */
function readColumn(raw: Record<string, string>, ...names: string[]): string {
  const wanted = new Set(names.map(normaliseHeader))
  const found = new Map<string, string>()

  for (const [header, value] of Object.entries(raw)) {
    const key = normaliseHeader(header)
    if (!wanted.has(key)) continue
    const trimmed = value?.trim()
    if (!trimmed) continue
    const existing = found.get(key)
    if (existing !== undefined && existing !== trimmed) {
      throw new Error(
        `This file has more than one "${names[0]}" column and they disagree ("${existing}" and "${trimmed}"). Remove one and upload it again.`,
      )
    }
    found.set(key, trimmed)
  }

  // Caller order is preference order: the canonical name wins over a synonym.
  for (const name of names) {
    const value = found.get(normaliseHeader(name))
    if (value) return value
  }
  return ""
}

const FIXTURE_STATUS_VALUES = ["Planned", "Booked", "To Be Determined", "Cancelled", "Completed"] as const

export interface ImportRowMatchResult {
  status: "ready" | "needs_review" | "conflict" | "update" | "invalid"
  errors: string[]
  resolvedHomeTeamId: string | null
  resolvedAwayTeamId: string | null
  resolvedAwayDirectoryId: string | null
  resolvedCompetitionEditionId: string | null
  resolvedPitchId: string | null
  resolvedVenueId: string | null
  resolvedStatus: string | null
  resolvedHomeScore: number | null
  resolvedAwayScore: number | null
  rawOppositionText: string
  normalizedGameType: string | null
  fixtureDate: string | null
  kickoffTime: string | null
  conflictingFixtureId: string | null
  matchedFixtureId: string | null
  /** "Home" | "Away" | null -- null means the source did not say, which publishes as Home. */
  homeAway: string | null
  meetTime: string | null
  /** An away ground recorded for an opponent not on Ovalball (Club Directory home ground), or the ground proposed to an Ovalball host. */
  resolvedVenueText: string | null
  /** Away against an Ovalball team: the host's pitch proposed with the ground. */
  resolvedPitchText: string | null
}

/**
 * "H", "home" and "HOME" are one answer; anything else is not an answer.
 *
 * A value this does not understand is NOT quietly treated as Home -- the
 * row says so and stays for review, because publishing an away match at
 * the club's own ground sends every parent to the wrong postcode.
 */
export function normaliseHomeAwayValue(raw: string): "Home" | "Away" | null {
  const v = raw.trim().toLowerCase()
  if (v === "h" || v === "home") return "Home"
  if (v === "a" || v === "away") return "Away"
  return null
}

const EMPTY_ROW_FIELDS = {
  resolvedHomeTeamId: null,
  resolvedAwayTeamId: null,
  resolvedAwayDirectoryId: null,
  resolvedCompetitionEditionId: null,
  resolvedPitchId: null,
  resolvedVenueId: null,
  resolvedStatus: null,
  resolvedHomeScore: null,
  resolvedAwayScore: null,
} as const

/**
 * Reconciliation complaint 26 remainder: a historical-backfill CSV row may
 * carry a final status/score -- parsed once, validated, and threaded into
 * every match-result return site below. Both scores must be present
 * together (a lone score is ambiguous, not a valid result) or neither is
 * used. Status must be a real fixtures.status value; an unrecognised
 * value is flagged, never silently dropped.
 */
function parseStatusAndScore(raw: Record<string, string>): { status: string | null; homeScore: number | null; awayScore: number | null; errors: string[] } {
  const errors: string[] = []
  const statusCol = readColumn(raw, "status")
  let status: string | null = null
  if (statusCol) {
    if ((FIXTURE_STATUS_VALUES as readonly string[]).includes(statusCol)) {
      status = statusCol
    } else {
      errors.push(`status "${statusCol}" must be one of ${FIXTURE_STATUS_VALUES.join(", ")} -- needs review.`)
    }
  }

  const homeScoreCol = readColumn(raw, "home_score")
  const awayScoreCol = readColumn(raw, "away_score")
  let homeScore: number | null = null
  let awayScore: number | null = null
  if (homeScoreCol || awayScoreCol) {
    const parsedHome = Number(homeScoreCol)
    const parsedAway = Number(awayScoreCol)
    const bothPresent = homeScoreCol !== "" && awayScoreCol !== ""
    const bothValid = Number.isInteger(parsedHome) && parsedHome >= 0 && Number.isInteger(parsedAway) && parsedAway >= 0
    if (!bothPresent) {
      errors.push("home_score and away_score must both be set together, or both left blank -- needs review.")
    } else if (!bothValid) {
      errors.push(`home_score "${homeScoreCol}" / away_score "${awayScoreCol}" must both be whole numbers >= 0 -- needs review.`)
    } else {
      homeScore = parsedHome
      awayScore = parsedAway
    }
  }

  return { status, homeScore, awayScore, errors }
}

/**
 * `restrictHomeClubId`: when set (the club-scoped import case), the home
 * team can only ever resolve to a team belonging to THIS club -- a row
 * naming a different club's team as home never resolves, it is flagged
 * `needs_review` like any other unmatched row, never silently redirected
 * or auto-corrected. The Site Admin global import passes this as
 * undefined and keeps its original unrestricted (name-matched-across-all-
 * clubs) behaviour exactly as before.
 */
export async function matchAndValidateImportRow(
  supabase: SupabaseClient<Database>,
  raw: Record<string, string>,
  restrictHomeClubId?: string,
  cache?: LookupCache
): Promise<ImportRowMatchResult> {
  const errors: string[] = []
  const homeClub = readColumn(raw, "home_club")
  const homeTeam = readColumn(raw, "home_team")
  const awayClub = readColumn(raw, "away_club")
  const awayTeam = readColumn(raw, "away_team")
  const fixtureDate = readColumn(raw, "date", "fixture_date") || null
  const kickoffTime = readColumn(raw, "kickoff", "kickoff_time") || null
  const rugbyCode = readColumn(raw, "rugby_code").toLowerCase()
  const seasonId = readColumn(raw, "season_id")
  const seasonLabel = readColumn(raw, "season_label")
  const competitionEditionIdCol = readColumn(raw, "competition_edition_id")
  const competitionLabel = readColumn(raw, "competition")
  const pitchIdCol = readColumn(raw, "pitch_id")
  const pitchName = readColumn(raw, "pitch_name")
  const venueIdCol = readColumn(raw, "venue_id")
  const venueName = readColumn(raw, "venue_name")
  const sourceReference = raw.source_reference?.trim() ?? ""
  const explicitFixtureId = raw.fixture_id?.trim() || null

  // WHICH SIDE, AND WHEN TO BE THERE.
  //
  // Both columns were in the synonym vocabulary but nothing ever read
  // them, so a file that carried "H/A" and "Meet" had both silently
  // discarded. They are carried on the result rather than resolved,
  // because neither needs a canonical lookup -- one is an enum, the other
  // a clock time the database parses itself.
  const homeAwayCol = readColumn(raw, "home_away")
  const homeAway = homeAwayCol ? normaliseHomeAwayValue(homeAwayCol) : null
  if (homeAwayCol && !homeAway) {
    errors.push(`"${homeAwayCol}" is not Home or Away -- needs review.`)
  }
  const meetTime = readColumn(raw, "meet_time", "meet") || null
  const carried: { homeAway: "Home" | "Away" | null; meetTime: string | null; resolvedVenueText: string | null; resolvedPitchText: string | null } = {
    homeAway,
    meetTime,
    resolvedVenueText: null,
    resolvedPitchText: null,
  }
  const { status: resolvedStatus, homeScore: resolvedHomeScore, awayScore: resolvedAwayScore, errors: statusScoreErrors } = parseStatusAndScore(raw)

  // An explicit fixture_id column names an EXISTING fixture to update --
  // never ambiguous, so it short-circuits the whole create/duplicate-
  // detection path below (Section BN: "a CSV row with a valid existing
  // fixture_id the user has permission to edit stages as an update, not
  // a duplicate create"). Resolution is restricted to the same club scope
  // as everything else in a club-scoped batch (a Site Admin global import
  // may update any fixture).
  if (explicitFixtureId) {
    // Two plain queries rather than an embedded relation select -- the
    // embedded form (`teams:owning_team_id(club_id)`) triggers a known
    // supabase-js generic-inference depth limit on this project's schema
    // size ("Type instantiation is excessively deep").
    const { data: matchedFixture } = await supabase.from("fixtures").select("id, owning_team_id").eq("id", explicitFixtureId).maybeSingle()
    let matchedClubId: string | null = null
    if (matchedFixture?.owning_team_id) {
      const { data: owningTeam } = await supabase.from("teams").select("club_id").eq("id", matchedFixture.owning_team_id).maybeSingle()
      matchedClubId = owningTeam?.club_id ?? null
    }
    const matched = matchedFixture ? { id: matchedFixture.id, clubId: matchedClubId } : null
    if (!matched) {
      return {
        status: "invalid",
        errors: [`fixture_id "${explicitFixtureId}" does not exist.`],
        ...EMPTY_ROW_FIELDS,
        rawOppositionText: "",
        normalizedGameType: normalizeGameType(raw.game_type ?? ""),
        fixtureDate,
        kickoffTime,
        conflictingFixtureId: null,
        matchedFixtureId: null,
        ...carried,
      }
    }
    if (restrictHomeClubId && matched.clubId !== restrictHomeClubId) {
      return {
        status: "invalid",
        errors: [`fixture_id "${explicitFixtureId}" does not belong to your club -- cannot update it.`],
        ...EMPTY_ROW_FIELDS,
        rawOppositionText: "",
        normalizedGameType: normalizeGameType(raw.game_type ?? ""),
        fixtureDate,
        kickoffTime,
        conflictingFixtureId: null,
        matchedFixtureId: null,
        ...carried,
      }
    }
    const normalizedGameType = normalizeGameType(raw.game_type ?? "")
    const updateErrors: string[] = [...statusScoreErrors]
    if (raw.game_type?.trim() && !normalizedGameType) {
      updateErrors.push(`Game type "${raw.game_type}" did not match Friendly / League Fixture / Cup Fixture / Scheduled Match -- needs review.`)
    }

    // An update row may also correct the competition edition/pitch -- same
    // real-record-only resolution as the create path below.
    const {
      competitionEditionId,
      pitchId,
      venueId,
      errors: linkErrors,
    } = await resolveCompetitionAndPitchAndVenue(
      supabase,
      rugbyCode,
      competitionEditionIdCol,
      competitionLabel,
      pitchIdCol,
      pitchName,
      venueIdCol,
      venueName,
      restrictHomeClubId ?? matched.clubId ?? undefined
    )
    updateErrors.push(...linkErrors)

    if (updateErrors.length > 0) {
      return {
        status: "needs_review",
        errors: updateErrors,
        ...EMPTY_ROW_FIELDS,
        resolvedCompetitionEditionId: competitionEditionId,
        resolvedPitchId: pitchId,
        resolvedVenueId: venueId,
        resolvedStatus,
        resolvedHomeScore,
        resolvedAwayScore,
        rawOppositionText: "",
        normalizedGameType,
        fixtureDate,
        kickoffTime,
        conflictingFixtureId: null,
        matchedFixtureId: explicitFixtureId,
        ...carried,
      }
    }
    return {
      status: "update",
      errors: [],
      ...EMPTY_ROW_FIELDS,
      resolvedCompetitionEditionId: competitionEditionId,
      resolvedPitchId: pitchId,
      resolvedVenueId: venueId,
      resolvedStatus,
      resolvedHomeScore,
      resolvedAwayScore,
      rawOppositionText: "",
      normalizedGameType,
      fixtureDate,
      kickoffTime,
      conflictingFixtureId: null,
      matchedFixtureId: explicitFixtureId,
      ...carried,
    }
  }

  errors.push(...statusScoreErrors)
  // On a club-scoped import the home club is already known -- the row only
  // has to say which of that club's teams is playing. Requiring the club's
  // own name on every row was asking for something the import already had.
  const homeClubKnown = Boolean(homeClub) || Boolean(restrictHomeClubId)
  if (!homeClubKnown || !homeTeam) {
    errors.push(restrictHomeClubId ? "Missing our team." : "Missing home_club or home_team.")
  }
  if (!awayClub && !awayTeam) {
    errors.push("Missing away_club/away_team (or an opposition description).")
  }
  if (rugbyCode && rugbyCode !== "union" && rugbyCode !== "league") {
    errors.push(`rugby_code "${raw.rugby_code}" must be "union" or "league" -- needs review.`)
  }

  const eligibilityCols = "id, display_name, rugby_code, category, age_group, team_number, gender, club_id, active, clubs!inner(club_directory!inner(name))"

  let resolvedHomeTeamId: string | null = null
  let resolvedHomeTeamFields: TeamEligibilityFields | null = null
  if (homeClubKnown && homeTeam) {
    // Reconciliation complaint 27: the LOCAL side must be an actual ACTIVE
    // club team, never merely a name that happens to exist in this club's
    // `teams` rows (a canonical identity that was later deactivated must
    // never be silently imported against). Run the active-only match
    // first; only when it finds nothing do we separately check whether an
    // INACTIVE row of the same name exists, purely to give a clearer,
    // more actionable error than a bare "not found".
    const { data: homeMatches } = await memo(cache, `home|${restrictHomeClubId ?? ""}|${homeClub}|${homeTeam}`, async () => {
      let homeQuery = supabase.from("teams").select(eligibilityCols).ilike("display_name", homeTeam).eq("active", true).limit(3)
      homeQuery = restrictHomeClubId ? homeQuery.eq("club_id", restrictHomeClubId) : homeQuery.ilike("clubs.club_directory.name", homeClub)
      return homeQuery
    })
    if (!homeMatches || homeMatches.length === 0) {
      const { data: inactiveMatch } = await memo(cache, `homeInactive|${restrictHomeClubId ?? ""}|${homeClub}|${homeTeam}`, async () => {
        let inactiveQuery = supabase.from("teams").select("id").ilike("display_name", homeTeam).eq("active", false).limit(1)
        inactiveQuery = restrictHomeClubId ? inactiveQuery.eq("club_id", restrictHomeClubId) : inactiveQuery.ilike("clubs.club_directory.name", homeClub)
        return inactiveQuery
      })
      errors.push(
        inactiveMatch && inactiveMatch.length > 0
          ? `Home team "${homeTeam}" exists but is not currently an active team -- needs review.`
          : restrictHomeClubId
            ? `Home team "${homeTeam}" could not be found for your club -- needs review.`
            : `Home team "${homeTeam}" at "${homeClub}" could not be found -- needs review.`
      )
    } else if (homeMatches.length > 1) {
      errors.push(`Home team "${homeTeam}" at "${homeClub}" matched more than one team -- needs review.`)
    } else {
      resolvedHomeTeamId = homeMatches[0].id
      resolvedHomeTeamFields = {
        rugbyCode: homeMatches[0].rugby_code,
        category: homeMatches[0].category,
        ageGroup: homeMatches[0].age_group,
        teamNumber: homeMatches[0].team_number,
        gender: homeMatches[0].gender,
      }
      if (rugbyCode && rugbyCode !== homeMatches[0].rugby_code) {
        errors.push(`rugby_code "${raw.rugby_code}" does not match ${homeTeam}'s actual rugby code (${homeMatches[0].rugby_code}) -- needs review.`)
      }
    }
  }

  let resolvedAwayTeamId: string | null = null
  let resolvedAwayDirectoryId: string | null = null
  let ageMismatch = false
  if (awayClub && awayTeam) {
    // Reconciliation complaint 28: the opponent side resolves the same
    // way the Calendar/Site Admin opponent pickers already do -- an
    // activated club that operates a matching ACTIVE team resolves to
    // that real team_id; anything else (no matching active team, or an
    // unactivated club) falls through to the Club Directory-only
    // resolution below, never a stale/inactive team_id.
    const { data: awayTeamMatches } = await memo(cache, `awayTeam|${awayClub}|${awayTeam}`, () =>
      supabase
        .from("teams")
        .select(eligibilityCols)
        .ilike("display_name", awayTeam)
        .ilike("clubs.club_directory.name", awayClub)
        .eq("active", true)
        .limit(3)
    )
    if (awayTeamMatches && awayTeamMatches.length === 1) {
      resolvedAwayTeamId = awayTeamMatches[0].id
      if (resolvedHomeTeamFields) {
        const awayFields: TeamEligibilityFields = {
          rugbyCode: awayTeamMatches[0].rugby_code,
          category: awayTeamMatches[0].category,
          ageGroup: awayTeamMatches[0].age_group,
          teamNumber: awayTeamMatches[0].team_number,
          gender: awayTeamMatches[0].gender,
        }
        if (!teamsCanPlayFixture(resolvedHomeTeamFields, awayFields)) {
          errors.push(`Age-grade mismatch: ${resolvedHomeTeamFields.ageGroup ?? homeTeam} teams may only play ${resolvedHomeTeamFields.ageGroup ?? homeTeam} opposition.`)
          resolvedAwayTeamId = null
          ageMismatch = true
        }
      }
    } else if (awayTeamMatches && awayTeamMatches.length > 1) {
      errors.push(`Away team "${awayTeam}" at "${awayClub}" matched more than one team -- needs review.`)
    }
  }
  if (!resolvedAwayTeamId && awayClub && !ageMismatch) {
    const { data: directoryMatches } = await memo(cache, `directory|${awayClub}`, () =>
      supabase.from("club_directory").select("id, name").ilike("name", awayClub).limit(3)
    )
    if (directoryMatches && directoryMatches.length === 1) {
      resolvedAwayDirectoryId = directoryMatches[0].id
      // AN OVALBALL CLUB IS ASKED, NEVER BOOKED. A fixture against one is a
      // request to one of their teams, so a row naming the club without a
      // team they run cannot be recorded against the club directly.
      const { data: tenant } = await memo(cache, `tenantClub|${resolvedAwayDirectoryId}`, () =>
        supabase.from("clubs").select("id").eq("directory_id", resolvedAwayDirectoryId as string).eq("status", "active").maybeSingle()
      )
      if (tenant) {
        errors.push(
          awayTeam
            ? `${directoryMatches[0].name} is on Ovalball, but "${awayTeam}" is not one of their teams. Choose one of their teams so they can be asked.`
            : `${directoryMatches[0].name} is on Ovalball, so they are asked rather than booked. Choose which of their teams this fixture is against.`,
        )
      }
    } else if (directoryMatches && directoryMatches.length > 1) {
      errors.push(`Opponent club "${awayClub}" matched more than one directory entry -- needs review.`)
    } else {
      // The Club Directory is the ONLY opposition source (mega-spec:
      // "no free-text opponent as authority") -- an away_club that
      // resolves to neither a specific team nor a directory entry must
      // never silently publish on raw text alone.
      errors.push(`Opponent club "${awayClub}" could not be found in the canonical Club Directory -- needs review.`)
    }
  }

  const rawOppositionText = [awayTeam, awayClub].filter(Boolean).join(", ") || awayClub || awayTeam || "Unknown opposition"

  const normalizedGameType = normalizeGameType(raw.game_type ?? "")
  if (raw.game_type?.trim() && !normalizedGameType) {
    errors.push(`Game type "${raw.game_type}" did not match Friendly / League Fixture / Cup Fixture / Scheduled Match -- needs review.`)
  }

  if (!fixtureDate) {
    errors.push("No date -- needs review before this can be published as scheduled.")
  }

  // Reconciliation complaint 23: season is validated against real Site
  // Admin Season records, never created from CSV text. Since a fixture's
  // season_id auto-resolves from its kickoff_date at insert time
  // (internal.resolve_season_for_date, unaffected by anything here), this
  // is purely a consistency check -- a season_id/season_label the CSV
  // names that does not correspond to a real row is flagged, rather than
  // silently ignored.
  if (seasonId) {
    const { data: seasonRow } = await memo(cache, `seasonId|${seasonId}`, () =>
      supabase.from("seasons").select("id").eq("id", seasonId).maybeSingle()
    )
    if (!seasonRow) errors.push(`season_id "${seasonId}" does not match a real Site Admin Season record -- needs review.`)
  } else if (seasonLabel) {
    const { data: seasonRow } = await memo(cache, `seasonLabel|${seasonLabel}`, () =>
      supabase.from("seasons").select("id").ilike("name", seasonLabel).maybeSingle()
    )
    if (!seasonRow) errors.push(`Season "${seasonLabel}" does not match a real Site Admin Season record -- needs review.`)
  }

  const {
    competitionEditionId,
    pitchId,
    venueId,
    errors: linkErrors,
  } = await resolveCompetitionAndPitchAndVenue(
    supabase,
    rugbyCode || resolvedHomeTeamFields?.rugbyCode || "",
    competitionEditionIdCol,
    competitionLabel,
    pitchIdCol,
    pitchName,
    venueIdCol,
    venueName,
    restrictHomeClubId,
    cache,
    fixtureDate
  )

  // AN AWAY GROUND IS THE OTHER CLUB'S. A venue that is not one of our grounds
  // is not an error on an away row when it is genuinely theirs. An Ovalball
  // opponent is asked, so the ground is PROPOSED to them on the request and
  // becomes the fixture's ground when they accept (never dropped). A club not
  // on Ovalball has its home ground recorded in the Club Directory, which
  // travels with the fixture as that recorded ground. Anything else is still
  // refused -- a venue is never invented from what was typed.
  const notOurVenue = linkErrors.findIndex((e) => e.startsWith(`Venue "${venueName}" could not be found for your club`))
  // The host's pitch, like its ground, is proposed to an Ovalball opponent rather than looked up among ours.
  const notOurPitch = linkErrors.findIndex((e) => e.startsWith(`Pitch "${pitchName}" could not be found for your club`))
  if (notOurPitch >= 0 && homeAway === "Away" && resolvedAwayTeamId) {
    linkErrors.splice(notOurPitch, 1)
    carried.resolvedPitchText = pitchName.trim().slice(0, 200) || null
  }
  if (notOurVenue >= 0 && homeAway === "Away") {
    if (resolvedAwayTeamId) {
      linkErrors.splice(linkErrors.findIndex((e) => e.startsWith(`Venue "${venueName}" could not be found for your club`)), 1)
      carried.resolvedVenueText = venueName.trim().slice(0, 200) || null
    } else if (resolvedAwayDirectoryId) {
      const { data: ground } = await memo(cache, `directoryGround|${resolvedAwayDirectoryId}`, () =>
        supabase.from("club_directory").select("home_ground").eq("id", resolvedAwayDirectoryId as string).maybeSingle()
      )
      // An Ovalball club's own default ground is its recorded ground too.
      const { data: tenantGround } = await memo(cache, `tenantGround|${resolvedAwayDirectoryId}`, () =>
        supabase
          .from("venues")
          .select("name, clubs!inner(directory_id, status)")
          .eq("clubs.directory_id", resolvedAwayDirectoryId as string)
          .eq("clubs.status", "active")
          .eq("is_default_home", true)
          .eq("active", true)
          .limit(1)
          .maybeSingle()
      )
      const recorded = [tenantGround?.name?.trim(), ground?.home_ground?.trim()].find(
        (g): g is string => Boolean(g) && g!.toLowerCase() === venueName.trim().toLowerCase(),
      )
      if (recorded) {
        linkErrors.splice(notOurVenue, 1)
        carried.resolvedVenueText = recorded
      }
    }
  }
  errors.push(...linkErrors)

  if (sourceReference) {
    const { data: existingRef } = await supabase
      .from("fixture_source_refs")
      .select("id")
      .eq("source_system", "csv_import")
      .eq("source_id", sourceReference)
      .maybeSingle()
    if (existingRef) {
      return {
        status: "invalid",
        errors: [`source_reference "${sourceReference}" was already imported previously.`],
        resolvedHomeTeamId,
        resolvedAwayTeamId,
        resolvedAwayDirectoryId,
        resolvedCompetitionEditionId: competitionEditionId,
        resolvedPitchId: pitchId,
        resolvedVenueId: venueId,
        resolvedStatus,
        resolvedHomeScore,
        resolvedAwayScore,
        rawOppositionText,
        normalizedGameType,
        fixtureDate,
        kickoffTime,
        conflictingFixtureId: null,
        matchedFixtureId: null,
        ...carried,
      }
    }
  }

  let conflictingFixtureId: string | null = null
  if (resolvedHomeTeamId && fixtureDate) {
    const { data: existingFixtures } = await memo(cache, `clash|${resolvedHomeTeamId}|${fixtureDate}`, () =>
      supabase
        .from("fixtures")
        .select("id")
        .eq("owning_team_id", resolvedHomeTeamId)
        .eq("kickoff_date", fixtureDate)
        .neq("status", "Cancelled")
        .limit(1)
    )
    if (existingFixtures && existingFixtures.length > 0) {
      conflictingFixtureId = existingFixtures[0].id
    }
  }

  if (errors.length > 0) {
    // homeClubKnown, not homeClub. On a club-scoped import the club is
    // implied rather than typed, so testing the raw column graded EVERY
    // imperfect row as hard-invalid -- unfixable, when the actual fault was
    // usually one correctable field.
    const hasHardFailure = !homeClubKnown || !homeTeam || (!awayClub && !awayTeam)
    return {
      status: hasHardFailure ? "invalid" : "needs_review",
      errors,
      resolvedHomeTeamId,
      resolvedAwayTeamId,
      resolvedAwayDirectoryId,
      resolvedCompetitionEditionId: competitionEditionId,
      resolvedPitchId: pitchId,
      resolvedVenueId: venueId,
      resolvedStatus,
      resolvedHomeScore,
      resolvedAwayScore,
      rawOppositionText,
      normalizedGameType,
      fixtureDate,
      kickoffTime,
      conflictingFixtureId,
      matchedFixtureId: null,
      ...carried,
    }
  }

  if (conflictingFixtureId) {
    return {
      status: "conflict",
      errors: [],
      resolvedHomeTeamId,
      resolvedAwayTeamId,
      resolvedAwayDirectoryId,
      resolvedCompetitionEditionId: competitionEditionId,
      resolvedPitchId: pitchId,
      resolvedVenueId: venueId,
      resolvedStatus,
      resolvedHomeScore,
      resolvedAwayScore,
      rawOppositionText,
      normalizedGameType,
      fixtureDate,
      kickoffTime,
      conflictingFixtureId,
      matchedFixtureId: null,
      ...carried,
    }
  }

  return {
    status: "ready",
    errors: [],
    resolvedHomeTeamId,
    resolvedAwayTeamId,
    resolvedAwayDirectoryId,
    resolvedCompetitionEditionId: competitionEditionId,
    resolvedPitchId: pitchId,
    resolvedVenueId: venueId,
    resolvedStatus,
    resolvedHomeScore,
    resolvedAwayScore,
    rawOppositionText,
    normalizedGameType,
    fixtureDate,
    kickoffTime,
    conflictingFixtureId: null,
    matchedFixtureId: null,
    ...carried,
  }
}

/**
 * Reconciliation complaints 25/26, extended for the Venue instruction:
 * resolves a competition edition, a pitch, and a venue from real, existing
 * records only -- never creates a competition, edition, pitch, or venue
 * from CSV/UI text. Prefers the stable id column
 * (`competition_edition_id`/`pitch_id`/`venue_id`) when present; falls back to the
 * human-readable column (`competition` as "Name · Season", `pitch_name`)
 * only as a convenience for hand-edited files, matching the same
 * id-first-then-label pattern used for season resolution above. Returns
 * an error (never a silent skip) when a non-empty column names something
 * that cannot be resolved to a real record.
 */
async function resolveCompetitionAndPitchAndVenue(
  supabase: SupabaseClient<Database>,
  rugbyCode: string,
  competitionEditionIdCol: string,
  competitionLabel: string,
  pitchIdCol: string,
  pitchName: string,
  venueIdCol: string,
  venueName: string,
  clubId: string | undefined,
  cache?: LookupCache,
  fixtureDate?: string | null
): Promise<{ competitionEditionId: string | null; pitchId: string | null; venueId: string | null; errors: string[] }> {
  const errors: string[] = []
  let competitionEditionId: string | null = null
  let pitchId: string | null = null
  let venueId: string | null = null

  if (competitionEditionIdCol) {
    const { data } = await memo(cache, `editionId|${competitionEditionIdCol}`, () =>
      supabase.from("competition_editions").select("id, rugby_code, active").eq("id", competitionEditionIdCol).maybeSingle()
    )
    if (!data || !data.active) {
      errors.push(`competition_edition_id "${competitionEditionIdCol}" does not match a real, active competition edition -- needs review.`)
    } else if (rugbyCode && data.rugby_code !== rugbyCode) {
      errors.push(`competition_edition_id "${competitionEditionIdCol}" is a ${data.rugby_code} competition, but this row is ${rugbyCode} -- needs review.`)
    } else {
      competitionEditionId = data.id
    }
  } else if (competitionLabel) {
    const [namePart] = competitionLabel.split("·").map((s) => s.trim())
    // `!inner`: without it PostgREST filters only the EMBEDDED competition, so
    // every active edition came back (with competitions: null) and a unique
    // name was reported as matching "more than one active edition".
    const { data } = await memo(cache, `editionLabel|${namePart || competitionLabel}`, () =>
      supabase
        .from("competition_editions")
        .select("id, rugby_code, active, competitions!inner(name), seasons(name, starts_on, ends_on, pre_season_starts_on)")
        .eq("active", true)
        .ilike("competitions.name", namePart || competitionLabel)
        .limit(10)
    )
    const byCode = (data ?? []).filter((row) => (rugbyCode ? row.rugby_code === rugbyCode : true))
    // A competition runs every season, so its name alone names several
    // editions. The fixture's own date picks the edition whose canonical season
    // contains it; nothing is guessed when the date does not decide.
    const inSeason = fixtureDate
      ? byCode.filter((row) => {
          const season = row.seasons
          if (!season) return false
          const start = season.pre_season_starts_on ?? season.starts_on
          return fixtureDate >= start && fixtureDate <= season.ends_on
        })
      : []
    const matches = byCode.length > 1 && inSeason.length === 1 ? inSeason : byCode
    if (matches.length === 1) {
      competitionEditionId = matches[0].id
    } else if (matches.length > 1) {
      errors.push(`Competition "${competitionLabel}" matched more than one active edition -- needs review.`)
    } else {
      errors.push(`Competition "${competitionLabel}" does not match a real, active competition edition -- needs review.`)
    }
  }

  if (pitchIdCol) {
    const pitchQuery = supabase.from("club_pitches").select("id, club_id, active").eq("id", pitchIdCol).maybeSingle()
    const { data } = await pitchQuery
    if (!data || !data.active) {
      errors.push(`pitch_id "${pitchIdCol}" does not match a real, active pitch -- needs review.`)
    } else if (clubId && data.club_id !== clubId) {
      errors.push(`pitch_id "${pitchIdCol}" does not belong to your club -- needs review.`)
    } else {
      pitchId = data.id
    }
  } else if (pitchName && clubId) {
    const { data } = await memo(cache, `pitchName|${clubId}|${pitchName}`, () =>
      supabase.from("club_pitches").select("id").eq("club_id", clubId).ilike("display_name", pitchName).eq("active", true).limit(2)
    )
    if (data && data.length === 1) {
      pitchId = data[0].id
    } else if (data && data.length > 1) {
      errors.push(`Pitch "${pitchName}" matched more than one pitch -- needs review.`)
    } else {
      errors.push(`Pitch "${pitchName}" could not be found for your club -- needs review.`)
    }
  }

  // Venue instruction Section 20: same real-record-only resolution as
  // pitch above -- never silently invents a venue from a typo, stages
  // for review instead.
  if (venueIdCol) {
    const { data } = await supabase.from("venues").select("id, club_id, active").eq("id", venueIdCol).maybeSingle()
    if (!data || !data.active) {
      errors.push(`venue_id "${venueIdCol}" does not match a real, active venue -- needs review.`)
    } else if (clubId && data.club_id !== clubId) {
      errors.push(`venue_id "${venueIdCol}" does not belong to your club -- needs review.`)
    } else {
      venueId = data.id
    }
  } else if (venueName && clubId) {
    const { data } = await memo(cache, `venueName|${clubId}|${venueName}`, () =>
      supabase.from("venues").select("id").eq("club_id", clubId).ilike("name", venueName).eq("active", true).limit(2)
    )
    if (data && data.length === 1) {
      venueId = data[0].id
    } else if (data && data.length > 1) {
      errors.push(`Venue "${venueName}" matched more than one venue -- needs review.`)
    } else {
      errors.push(`Venue "${venueName}" could not be found for your club -- needs review.`)
    }
  }

  // A PITCH IS AT A VENUE. Both resolving on their own is not enough: "Pitch
  // 2" is a real pitch and "Towneley Park" is a real venue, and a fixture
  // naming both sends a team to a pitch that is not at the ground they were
  // told. Checked here, in the one engine, so a typed row, a pasted row, a
  // filled row and an uploaded file all get the same answer.
  if (pitchId && venueId) {
    const { data: pitchVenue } = await memo(cache, `pitchVenue|${pitchId}`, () =>
      supabase.from("club_pitches").select("venue_id").eq("id", pitchId as string).maybeSingle()
    )
    if (pitchVenue?.venue_id && pitchVenue.venue_id !== venueId) {
      errors.push(`Pitch "${pitchName || pitchIdCol}" is not at venue "${venueName || venueIdCol}" -- needs review.`)
      pitchId = null
    }
  }

  return { competitionEditionId, pitchId, venueId, errors }
}

export interface RowCorrectionInput {
  homeTeamId?: string | null
  awayTeamId?: string | null
  awayDirectoryId?: string | null
  awayRawText?: string
  fixtureDate?: string | null
  kickoffTime?: string | null
  normalizedGameType?: string | null
  competitionEditionId?: string | null
  pitchId?: string | null
  venueId?: string | null
  fixtureStatus?: string | null
  homeScore?: number | null
  awayScore?: number | null
}

/**
 * Reconciliation complaint 26: the staging review previously offered
 * nothing but Exclude for a needs_review/invalid row -- no way to
 * correct Home Team, Away Club/Team, Date, Kickoff, Competition, or
 * Pitch via canonical controls. This applies a correction (each field
 * chosen from a real canonical picker in the UI -- never re-typed free
 * text) and re-derives the row's status exactly like a fresh match
 * would: 'ready' when every required field now resolves and there is no
 * scheduling conflict, 'conflict' when one is found, otherwise the row
 * stays 'needs_review' with whatever is still missing.
 */
export async function applyRowCorrection(
  supabase: SupabaseClient<Database>,
  rowId: string,
  correction: RowCorrectionInput,
  restrictHomeClubId?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: row } = await supabase.from("fixture_import_rows").select("*").eq("id", rowId).maybeSingle()
  if (!row) return { ok: false, error: "Import row not found." }

  const homeTeamId = correction.homeTeamId !== undefined ? correction.homeTeamId : row.resolved_home_team_id
  const awayTeamId = correction.awayTeamId !== undefined ? correction.awayTeamId : row.resolved_away_team_id
  const awayDirectoryId = correction.awayDirectoryId !== undefined ? correction.awayDirectoryId : row.resolved_away_directory_id
  const fixtureDate = correction.fixtureDate !== undefined ? correction.fixtureDate : row.fixture_date
  const kickoffTime = correction.kickoffTime !== undefined ? correction.kickoffTime : row.kickoff_time
  const normalizedGameType = correction.normalizedGameType !== undefined ? correction.normalizedGameType : row.normalized_game_type
  const competitionEditionId = correction.competitionEditionId !== undefined ? correction.competitionEditionId : row.resolved_competition_edition_id
  const pitchId = correction.pitchId !== undefined ? correction.pitchId : row.resolved_pitch_id
  const venueId = correction.venueId !== undefined ? correction.venueId : row.resolved_venue_id
  const fixtureStatus = correction.fixtureStatus !== undefined ? correction.fixtureStatus : row.resolved_status
  const homeScore = correction.homeScore !== undefined ? correction.homeScore : row.resolved_home_score
  const awayScore = correction.awayScore !== undefined ? correction.awayScore : row.resolved_away_score
  const rawOppositionText = correction.awayRawText?.trim() || row.raw_opposition_text || "Unknown opposition"

  if (restrictHomeClubId && homeTeamId) {
    const { data: team } = await supabase.from("teams").select("club_id, active").eq("id", homeTeamId).maybeSingle()
    if (!team || team.club_id !== restrictHomeClubId) return { ok: false, error: "That team does not belong to your club." }
    if (!team.active) return { ok: false, error: "That team is not currently active." }
  }
  if (restrictHomeClubId && pitchId) {
    const { data: pitch } = await supabase.from("club_pitches").select("club_id").eq("id", pitchId).maybeSingle()
    if (!pitch || pitch.club_id !== restrictHomeClubId) return { ok: false, error: "That pitch does not belong to your club." }
  }
  if (restrictHomeClubId && venueId) {
    const { data: venue } = await supabase.from("venues").select("club_id").eq("id", venueId).maybeSingle()
    if (!venue || venue.club_id !== restrictHomeClubId) return { ok: false, error: "That venue does not belong to your club." }
  }

  const errors: string[] = []
  if (!homeTeamId) errors.push("A home team is required.")
  if (!awayTeamId && !awayDirectoryId) errors.push("An opponent club or resolved opponent team is required.")
  if (!fixtureDate) errors.push("A date is required.")

  let conflictingFixtureId: string | null = null
  if (homeTeamId && fixtureDate) {
    const { data: existingFixtures } = await supabase
      .from("fixtures")
      .select("id")
      .eq("owning_team_id", homeTeamId)
      .eq("kickoff_date", fixtureDate)
      .neq("status", "Cancelled")
      .limit(1)
    if (existingFixtures && existingFixtures.length > 0) conflictingFixtureId = existingFixtures[0].id
  }

  const status: ImportRowMatchResult["status"] = errors.length > 0 ? "needs_review" : conflictingFixtureId ? "conflict" : "ready"

  const { error } = await supabase
    .from("fixture_import_rows")
    .update({
      resolved_home_team_id: homeTeamId,
      resolved_away_team_id: awayTeamId,
      resolved_away_directory_id: awayDirectoryId,
      resolved_competition_edition_id: competitionEditionId,
      resolved_pitch_id: pitchId,
      resolved_venue_id: venueId,
      resolved_status: fixtureStatus,
      resolved_home_score: homeScore,
      resolved_away_score: awayScore,
      raw_opposition_text: rawOppositionText,
      fixture_date: fixtureDate,
      kickoff_time: kickoffTime,
      normalized_game_type: normalizedGameType,
      conflicting_fixture_id: conflictingFixtureId,
      conflict_decision: null,
      status,
      errors,
    })
    .eq("id", rowId)

  if (error) return { ok: false, error: "Couldn't save that correction. Please try again." }
  return { ok: true }
}

/**
 * Stages every row of a parsed CSV into `fixture_import_rows` under a new
 * `fixture_import_batches` row -- the ONE code path both the Site Admin
 * and club-scoped import server actions call. `clubId` set = a club-
 * scoped batch (home-team resolution restricted to that club, RLS-gated
 * accordingly); omitted = the original Site Admin global import.
 */
export async function stageImportBatch(
  supabase: SupabaseClient<Database>,
  uploadedBy: string,
  filename: string,
  rawRows: Record<string, string>[],
  clubId?: string
): Promise<{ ok: true; batchId: string } | { ok: false; error: string }> {
  if (rawRows.length === 0) return { ok: false, error: "The file has no data rows." }
  // THE SAME HEADER VOCABULARY THE ROWS ARE READ WITH.
  //
  // This check used exact key matching while every row below is read
  // through readColumn's normalisation and synonyms -- so a file headed
  // "Our Team" was rejected for missing "home_team" that the parser would
  // have understood perfectly well one line later.
  //
  // A CLUB-SCOPED IMPORT DOES NOT NAME ITS OWN CLUB. When clubId is set the
  // home club IS the club doing the importing (restrictHomeClubId narrows
  // team resolution to exactly that club), so demanding a home_club column
  // asks a secretary to type their own club's name on all two hundred rows
  // to tell us something we already know.
  const presentHeaders = new Set(Object.keys(rawRows[0]).map(normaliseHeader))
  const required = clubId
    ? REQUIRED_IMPORT_COLUMNS.filter((c) => c !== "home_club")
    : REQUIRED_IMPORT_COLUMNS
  const missing = required.filter((c) => !presentHeaders.has(normaliseHeader(c)))
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing required column(s): ${missing.join(", ")}. Headings like "Our Team" or "Opposition Club" are understood too.`,
    }
  }

  const { data: batch, error: batchError } = await supabase
    .from("fixture_import_batches")
    .insert({ uploaded_by: uploadedBy, filename, row_count: rawRows.length, state: "processing", club_id: clubId ?? null })
    .select("id")
    .single()
  if (batchError || !batch) {
    console.error("stageImportBatch failed:", batchError)
    return { ok: false, error: "Couldn't start the import. Please try again." }
  }

  let hasNeedsReview = false
  for (let i = 0; i < rawRows.length; i++) {
    // A header the file itself contradicts (two "Date" columns that
    // disagree) is a problem with THAT ROW's file, not a reason to abandon
    // the upload -- it becomes an invalid row the person can see and fix,
    // exactly like a date that will not parse.
    let result: ImportRowMatchResult
    try {
      result = await matchAndValidateImportRow(supabase, rawRows[i], clubId)
    } catch (headerError) {
      result = {
        status: "invalid",
        errors: [headerError instanceof Error ? headerError.message : "This row could not be read."],
        ...EMPTY_ROW_FIELDS,
        rawOppositionText: "",
        normalizedGameType: null,
        fixtureDate: null,
        kickoffTime: null,
        conflictingFixtureId: null,
        matchedFixtureId: null,
        homeAway: null,
        meetTime: null,
        resolvedVenueText: null,
        resolvedPitchText: null,
      }
    }
    if (result.status !== "ready") hasNeedsReview = true

    const { error: rowError } = await supabase.from("fixture_import_rows").insert({
      batch_id: batch.id,
      row_number: i + 1,
      raw: rawRows[i],
      status: result.status,
      errors: result.errors,
      resolved_home_team_id: result.resolvedHomeTeamId,
      resolved_away_team_id: result.resolvedAwayTeamId,
      resolved_away_directory_id: result.resolvedAwayDirectoryId,
      resolved_competition_edition_id: result.resolvedCompetitionEditionId,
      resolved_pitch_id: result.resolvedPitchId,
      resolved_venue_id: result.resolvedVenueId,
      resolved_venue_text: result.resolvedVenueText,
      resolved_pitch_text: result.resolvedPitchText,
      resolved_status: result.resolvedStatus,
      resolved_home_score: result.resolvedHomeScore,
      resolved_away_score: result.resolvedAwayScore,
      raw_opposition_text: result.rawOppositionText,
      normalized_game_type: result.normalizedGameType,
      fixture_date: result.fixtureDate,
      kickoff_time: result.kickoffTime,
      // Staged, not assumed. publish_import_row reads null as Home and as
      // no meet time, which is exactly what a file that says nothing means.
      home_away: result.homeAway,
      meet_time: result.meetTime,
      source_reference: rawRows[i].source_reference?.trim() || null,
      notes: rawRows[i].notes?.trim() || null,
      conflicting_fixture_id: result.conflictingFixtureId,
      matched_fixture_id: result.matchedFixtureId,
    })
    if (rowError) {
      console.error(`stageImportBatch row ${i + 1} insert failed:`, rowError)
    }
  }

  await supabase
    .from("fixture_import_batches")
    .update({ state: hasNeedsReview ? "needs_review" : "ready_to_publish" })
    .eq("id", batch.id)

  return { ok: true, batchId: batch.id }
}
