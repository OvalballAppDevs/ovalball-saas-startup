import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import { matchAndValidateImportRow, type ImportRowMatchResult, type LookupCache } from "./import-engine"
import {
  isBlankRow,
  normaliseDate,
  normaliseHomeAway,
  normaliseTime,
  toRawRecord,
  type CellState,
  type PlannerDraftRow,
  type PlannerField,
  type PlannerRowResult,
} from "./planner-model"

/**
 * VALIDATION, AND NOTHING ELSE.
 *
 * Every canonical identity in a planner row -- our team, the opponent,
 * the competition, the venue -- is resolved by the ONE import engine, the
 * same one a CSV upload goes through. What this file adds is the three
 * fields that have no canonical record behind them (date, the two times,
 * and which side we are on) and the per-cell states the grid colours
 * itself with.
 *
 * It writes nothing. The person is told what Ovalball understood before
 * anything is created, and the creation path resolves against the same
 * records, so what the grid shows and what it will do cannot drift.
 */

export async function validatePlannerRows(
  supabase: SupabaseClient<Database>,
  rows: PlannerDraftRow[],
  clubId: string,
): Promise<PlannerRowResult[]> {
  const results: PlannerRowResult[] = []

  // ONE CACHE, THIS CALL ONLY.
  //
  // A season is repetitive: five teams, a dozen opponents, two venues,
  // spread over a hundred rows. Without this, matching a 120-row paste
  // asked the database the same few dozen questions several hundred times
  // and took over half a minute.
  //
  // It is created here and dropped when this function returns, so it can
  // never answer one club's question with another's rows. Every key
  // includes the club scope for the same reason.
  const cache: LookupCache = new Map()

  for (const row of rows) {
    if (isBlankRow(row)) {
      results.push(blankResult(row.key))
      continue
    }

    const errors: string[] = []
    const cells: Partial<Record<PlannerField, CellState>> = {}

    // The fields the engine does not parse are checked here, in the same
    // vocabulary, so an unreadable time is a named cell rather than a
    // mystery a person has to bisect by deleting rows.
    if (!row.date) {
      // No message: the engine says "no date" on every route into it, and
      // two sentences about one empty cell is one too many.
      cells.date = "empty"
    } else if (!normaliseDate(row.date)) {
      cells.date = "error"
      errors.push(`"${row.date}" is not a date Ovalball recognises. Use 14/08/2027 or 2027-08-14.`)
    } else {
      cells.date = "valid"
    }

    for (const [field, label] of [
      ["kickoff", "Kick off"],
      ["meet", "Meet"],
    ] as const) {
      const value = row[field]
      if (!value) {
        cells[field] = "empty"
      } else if (!normaliseTime(value)) {
        cells[field] = "error"
        errors.push(`${label} "${value}" is not a time. Use 11:00, 1100 or 9:30.`)
      } else {
        cells[field] = "valid"
      }
    }

    if (!row.homeAway) {
      cells.homeAway = "empty"
    } else if (!normaliseHomeAway(row.homeAway)) {
      cells.homeAway = "error"
      errors.push(`"${row.homeAway}" is not Home or Away.`)
    } else {
      cells.homeAway = "valid"
    }

    // A contradictory row is one the person can fix, never a failed
    // request that loses the other forty-nine.
    let match: ImportRowMatchResult
    try {
      match = await matchAndValidateImportRow(supabase, toRawRecord(row), clubId, cache)
    } catch (readError) {
      results.push({
        ...blankResult(row.key),
        status: "invalid",
        errors: [...errors, readError instanceof Error ? readError.message : "This row could not be read."],
        cells,
      })
      continue
    }

    cells.ourTeam = match.resolvedHomeTeamId ? "valid" : row.ourTeam ? "review" : "empty"
    // "suggested" is the honest middle state: the opponent is a real club
    // in the Club Directory, but not one that runs this fixture as an
    // Ovalball team -- so the match is booked against them rather than
    // asked of them, and the person should know which they are getting.
    cells.oppositionClub = match.resolvedAwayTeamId
      ? "valid"
      : match.resolvedAwayDirectoryId
        ? "suggested"
        : row.oppositionClub
          ? "review"
          : "empty"
    cells.oppositionTeam = match.resolvedAwayTeamId ? "valid" : row.oppositionTeam ? "review" : "empty"
    cells.competition = match.resolvedCompetitionEditionId ? "valid" : row.competition ? "review" : "empty"
    cells.venue = match.resolvedVenueId ? "valid" : row.venue ? "review" : "empty"
    cells.pitch = match.resolvedPitchId ? "valid" : row.pitch ? "review" : "empty"

    const allErrors = [...new Set([...errors, ...match.errors])]
    const unreadable = cells.date === "error" || cells.kickoff === "error" || cells.meet === "error" || cells.homeAway === "error"

    const status =
      allErrors.length === 0
        ? match.conflictingFixtureId
          ? "conflict"
          : "ready"
        : unreadable || match.status === "invalid"
          ? "invalid"
          : "review"

    results.push({
      key: row.key,
      status,
      errors: allErrors,
      cells,
      resolvedOurTeamId: match.resolvedHomeTeamId,
      resolvedOppositionTeamId: match.resolvedAwayTeamId,
      resolvedOppositionDirectoryId: match.resolvedAwayDirectoryId,
      resolvedCompetitionEditionId: match.resolvedCompetitionEditionId,
      resolvedVenueId: match.resolvedVenueId,
      resolvedPitchId: match.resolvedPitchId,
      conflictingFixtureId: match.conflictingFixtureId,
      // An opponent who is a real Ovalball team is ASKED, never booked --
      // the same rule one fixture at a time has always followed.
      willSendRequest: Boolean(match.resolvedAwayTeamId),
    })
  }

  return results
}

function blankResult(key: string): PlannerRowResult {
  return {
    key,
    status: "blank",
    errors: [],
    cells: {},
    resolvedOurTeamId: null,
    resolvedOppositionTeamId: null,
    resolvedOppositionDirectoryId: null,
    resolvedCompetitionEditionId: null,
    resolvedVenueId: null,
    resolvedPitchId: null,
    conflictingFixtureId: null,
    willSendRequest: false,
  }
}
