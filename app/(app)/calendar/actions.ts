"use server"

import { revalidatePath } from "next/cache"

import { dateWithinAnySeason, type SeasonRow } from "@/lib/calendar/season-window"
import { createClient } from "@/lib/supabase/server"

export type CalendarActionResult = { ok: true } | { ok: false; error: string }

export interface CreateTrainingInput {
  clubId: string
  teamId: string | null
  schedulingGroupId: string | null
  sessionDate: string
  startTime: string | null
  endTime: string | null
  pitchId: string | null
  notes: string | null
}

/**
 * Pre-Season/Main-Season date-boundary addendum, Section 7: date
 * restrictions must not be UI-only -- re-fetches this club's own season
 * rows fresh (never trusts a client-supplied range) and rejects a
 * sessionDate that falls within NONE of them, before ever reaching
 * create_training_session. Deliberately permissive when the club simply
 * has no season data configured yet (nothing to violate) -- this only
 * fails closed once real season rows exist and disagree with the
 * submitted date, matching the same canonical seasons table Calendar's
 * own navigation bounds itself to (lib/calendar/season-window.ts), never
 * a second copy of the rule.
 */
async function validateTrainingDateAgainstClubSeasons(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clubId: string,
  sessionDate: string
): Promise<string | null> {
  const { data: club } = await supabase.from("clubs").select("directory_id").eq("id", clubId).maybeSingle()
  if (!club) return null
  const { data: directory } = await supabase.from("club_directory").select("rugby_code").eq("id", club.directory_id).maybeSingle()
  const rugbyCode = directory?.rugby_code ?? null
  if (!rugbyCode) return null

  const { data: seasonRows } = await supabase
    .from("seasons")
    .select("id, name, season_ref, rugby_code, pre_season_starts_on, starts_on, ends_on")
    .eq("rugby_code", rugbyCode)
    .eq("is_regression_fixture", false)
  if (!seasonRows || seasonRows.length === 0) return null

  const seasons: SeasonRow[] = seasonRows.map((s) => ({
    id: s.id,
    name: s.name,
    seasonRef: s.season_ref,
    rugbyCode: s.rugby_code,
    preSeasonStartsOn: s.pre_season_starts_on,
    startsOn: s.starts_on,
    endsOn: s.ends_on,
  }))
  if (!dateWithinAnySeason(seasons, sessionDate)) {
    return "That date falls outside every configured season (Pre-Season through Main Season End) for this club. Choose a date within a real season window."
  }
  return null
}

/** create_training_session is the real boundary (can_manage_training) -- training is a calendar event, never a fake fixture: no opponent, no result. */
export async function createTrainingSession(input: CreateTrainingInput): Promise<CalendarActionResult> {
  const supabase = await createClient()
  const dateError = await validateTrainingDateAgainstClubSeasons(supabase, input.clubId, input.sessionDate)
  if (dateError) return { ok: false, error: dateError }
  const { error } = await supabase.rpc("create_training_session", {
    p_club_id: input.clubId,
    // Declared nullable uuid in SQL (exactly one of the two must be set) --
    // the generated type doesn't capture that, same as p_competition_edition_id elsewhere.
    p_team_id: input.teamId as unknown as string,
    p_scheduling_group_id: input.schedulingGroupId as unknown as string,
    p_session_date: input.sessionDate,
    p_start_time: input.startTime ?? undefined,
    p_end_time: input.endTime ?? undefined,
    p_pitch_id: input.pitchId ?? undefined,
    p_notes: input.notes ?? undefined,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/calendar")
  return { ok: true }
}

export async function cancelTrainingSession(sessionId: string, reason: string | null): Promise<CalendarActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("cancel_training_session", { p_session_id: sessionId, p_reason: reason ?? undefined })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/calendar")
  return { ok: true }
}
