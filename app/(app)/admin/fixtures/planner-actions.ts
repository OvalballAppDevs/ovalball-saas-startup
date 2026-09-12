"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

import { createFixture } from "./actions"

export interface PlannerChange {
  fixtureId: string
  kickoffDate?: string
  kickoffTime?: string | null
  meetTime?: string | null
  venueId?: string | null
  competitionEditionId?: string | null
}

export interface PlannerSaveRow {
  fixtureId: string
  ok: boolean
  error: string | null
}

export type PlannerSaveResult =
  | { ok: true; saved: number; failed: PlannerSaveRow[] }
  | { ok: false; error: string }

/**
 * ONE SAVE FOR THE WHOLE PLANNER.
 *
 * Hands the change set to public.bulk_update_fixtures, which delegates each
 * field to its existing canonical writer -- so this action adds no authority
 * of its own and cannot become a way around one. RLS and each writer's own
 * refusals remain the boundary.
 *
 * PARTIAL SUCCESS IS REPORTED, NEVER HIDDEN. Fixtures are independent: a
 * kick-off that clashes with an existing commitment must not discard eleven
 * good edits. The caller gets a row per failure with the database's own
 * sentence, so the planner can say WHICH fixture needs attention rather than
 * "something went wrong".
 */
export async function saveFixtureEdits(changes: PlannerChange[]): Promise<PlannerSaveResult> {
  if (changes.length === 0) return { ok: true, saved: 0, failed: [] }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You must be signed in." }

  const payload = changes.map((c) => {
    const row: Record<string, string | null> = { fixture_id: c.fixtureId }
    // Only fields the person actually touched are sent. An absent key means
    // "leave it alone"; a null means "clear it", and the two are different.
    if (c.kickoffDate !== undefined) row.kickoff_date = c.kickoffDate
    if (c.kickoffTime !== undefined) row.kickoff_time = c.kickoffTime
    if (c.meetTime !== undefined) row.meet_time = c.meetTime
    if (c.venueId !== undefined) row.venue_id = c.venueId
    if (c.competitionEditionId !== undefined) row.competition_edition_id = c.competitionEditionId
    return row
  })

  const { data, error } = await supabase.rpc("bulk_update_fixtures", { p_changes: payload })
  if (error) {
    console.error("saveFixtureEdits failed:", error)
    return { ok: false, error: error.message || "Those changes could not be saved." }
  }

  const rows = (data ?? []) as unknown as { fixture_id: string; ok: boolean; error_message: string | null }[]
  const failed = rows
    .filter((r) => !r.ok)
    .map((r) => ({ fixtureId: r.fixture_id, ok: false, error: r.error_message }))

  revalidatePath("/admin/fixtures")
  revalidatePath("/fixtures/management")
  revalidatePath("/calendar")

  return { ok: true, saved: rows.length - failed.length, failed }
}

/**
 * Duplicating a fixture is a CREATE, not a row copy.
 *
 * It goes through create_fixture so the age-eligibility rule, the one-match-
 * per-team-per-day capacity trigger and the club's own authority all apply
 * exactly as they would to a fixture typed by hand. Result, cancellation,
 * conversation and request state are never carried forward -- a duplicate is
 * a new arrangement, not a copy of what happened last time.
 */
export async function duplicateFixture(
  fixtureId: string,
): Promise<{ ok: true; kickoffDate: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You must be signed in." }

  const { data: source, error: readError } = await supabase
    .from("fixtures")
    .select(
      "owning_team_id, opponent_team_id, opponent_directory_id, raw_opposition_text, home_away, kickoff_date, kickoff_time, venue_id, pitch_id, competition_edition_id, game_type, notes",
    )
    .eq("id", fixtureId)
    .maybeSingle()

  if (readError || !source) return { ok: false, error: "That fixture could not be read." }

  // THE NEXT FREE WEEK, NOT BLINDLY SEVEN DAYS ON.
  //
  // A team may hold one match per day, and a club that plays weekly already
  // has next Saturday taken -- so a fixed +7 would refuse far more often
  // than it worked. The dates this team already holds are read once, and the
  // first free weekly slot within a season's reach is offered instead.
  const { data: taken } = await supabase
    .from("fixtures")
    .select("kickoff_date")
    .eq("owning_team_id", source.owning_team_id)
    .gt("kickoff_date", source.kickoff_date)

  const occupied = new Set((taken ?? []).map((t) => t.kickoff_date))
  let kickoffDate: string | null = null
  for (let week = 1; week <= 26 && !kickoffDate; week++) {
    const candidate = new Date(`${source.kickoff_date}T00:00:00`)
    candidate.setDate(candidate.getDate() + week * 7)
    const iso = candidate.toISOString().slice(0, 10)
    if (!occupied.has(iso)) kickoffDate = iso
  }

  if (!kickoffDate) {
    return {
      ok: false,
      error: "This team already has a fixture on every week for the next six months. Change a date first, then duplicate.",
    }
  }

  // THE SAME CREATE PATH AS TYPING ONE BY HAND. createFixture already knows
  // that a claimed Ovalball opponent must be ASKED rather than booked, and
  // carries the age-eligibility and one-match-per-team-per-day rules with
  // it. Duplicating through anything else would quietly skip all of that.
  const result = await createFixture({
    owningTeamId: source.owning_team_id,
    homeAway: source.home_away as "Home" | "Away" | "TBD" | "Not Applicable",
    opponentTeamId: source.opponent_team_id,
    opponentDirectoryId: source.opponent_directory_id,
    rawOppositionText: source.raw_opposition_text,
    kickoffDate,
    kickoffTime: source.kickoff_time,
    gameType: source.game_type,
    // A duplicate starts where a new arrangement starts. Result,
    // cancellation, conversation and request state are never carried over.
    status: "Planned",
    venueId: source.venue_id,
    notes: source.notes ?? "",
    competitionEditionId: source.competition_edition_id,
    pitchId: source.pitch_id,
  })

  if (!result.ok) return result
  return { ok: true, kickoffDate }
}
