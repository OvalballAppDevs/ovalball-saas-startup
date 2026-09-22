import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@ovalball/contracts"
import type { AvailabilityStatus } from "@ovalball/contracts/availability"

import type { RegisterEntry } from "../components/availability-register"

/**
 * ONE TRAINING SESSION.
 *
 * TRAINING IS NOT A FIXTURE AND IS NEVER TURNED INTO ONE. It has no opposition, no home or away and no
 * result; it has a squad, a ground, a time and a plan. The canonical reader says so in its own shape --
 * `get_training_session_card` returns a team label, a venue, a pitch, an agenda and the viewer's own
 * attendance, and nothing about an opponent.
 *
 * AUTHORITY ARRIVES WITH THE ROW. `can_manage` and `can_view_register` are the server's answers, not
 * something derived here from a role name: `internal.can_manage_training` is the resolver, and the
 * override mutation re-runs it regardless of what any client drew.
 *
 * A RECURRING SESSION IS A REAL OCCURRENCE. Ovalball materialises training from a plan, so what this
 * reads is a persisted session with its own id -- never a date computed on a phone from a rule. That is
 * why editing one is an OVERRIDE: it changes this occurrence without touching the plan that generated
 * it, which is what somebody moving next Tuesday actually means.
 */

type Client = SupabaseClient<Database>

export interface TrainingSession {
  id: string
  clubId: string | null
  teamId: string | null
  teamLabel: string | null
  date: string
  startTime: string | null
  endTime: string | null
  durationMinutes: number | null
  venueId: string | null
  venueName: string | null
  pitchId: string | null
  pitchName: string | null
  status: string | null
  agenda: string | null
  furtherNotes: string | null
  notes: string | null
  cancelledAt: string | null
  cancellationReason: string | null
  cancelledByName: string | null
  /** The viewer's own answer, where they are somebody who answers. Null for staff. */
  myAttendance: string | null
  canManage: boolean
  canViewRegister: boolean
}

/**
 * ONE PERSON THIS VIEWER MAY ANSWER FOR, AND WHETHER THEY MAY ACTUALLY ANSWER.
 *
 * The identical shape the fixture half uses (`MyAvailability` in
 * `src/match-centre/load.ts`), because the two RPCs behind them now return the
 * identical column set -- which is the point of having asked the same question in
 * the same way on both halves of a rugby week.
 */
export interface TrainingAvailability {
  playerId: string
  firstName: string
  displayName: string
  isSelf: boolean
  response: AvailabilityStatus | null
  canRespond: boolean
  cannotRespondReason: string | null
}

/**
 * WHOM THIS VIEWER MAY ANSWER FOR ON THIS SESSION.
 *
 * `public.get_my_players_for_training_session` is the canonical reader the
 * website's Training Centre resolver also calls, and since M6 it carries the
 * authority inline -- so the control is never drawn where
 * `respond_to_training_attendance` would refuse, and neither client has to call
 * `get_my_attendance_authority` once per child to find out.
 *
 * A CANCELLED SESSION STILL LISTS THE CHILD, with can_respond false and the
 * reason. A parent should be able to see what they had said before the session
 * was called off rather than find the whole section gone.
 */
export async function loadMyTrainingAvailability(supabase: Client, sessionId: string): Promise<TrainingAvailability[]> {
  const { data } = await supabase.rpc("get_my_players_for_training_session", { p_training_session_id: sessionId })
  return (data ?? []).map((r) => ({
    playerId: r.player_id,
    firstName: r.first_name ?? "",
    displayName: `${r.first_name ?? ""} ${r.surname ?? ""}`.trim() || "Player",
    // From players.user_id, resolved by the RPC -- never inferred here.
    isSelf: r.relationship === "self",
    response: (r.current_status as AvailabilityStatus | null) ?? null,
    canRespond: r.can_respond,
    cannotRespondReason: r.denial_reason,
  }))
}

/**
 * THE REGISTER -- who is expected, and what each of them said.
 *
 * `public.get_training_register` is the same RPC the website's register renders,
 * and it REFUSES outright without `team.attendance.view` or training-management
 * authority rather than returning a filtered list. So this is not "fetch then
 * hide": a viewer who may not see the register gets an error from the database
 * and an empty array from here, and the section is not rendered.
 */
export async function loadTrainingRegister(supabase: Client, sessionId: string): Promise<RegisterEntry[]> {
  const { data, error } = await supabase.rpc("get_training_register", { p_training_session_id: sessionId })
  if (error) return []
  return (data ?? []).map((r) => ({
    playerId: r.player_id,
    firstName: r.first_name ?? "",
    surname: r.surname ?? "",
    status: (r.status as AvailabilityStatus | null) ?? null,
  }))
}

export async function loadTrainingSession(supabase: Client, sessionId: string): Promise<TrainingSession | null> {
  const { data } = await supabase.rpc("get_training_session_card", { p_training_session_id: sessionId })
  const row = data?.[0]
  if (!row) return null
  return {
    id: row.id,
    clubId: row.club_id,
    teamId: row.team_id,
    teamLabel: row.team_label,
    date: row.session_date,
    startTime: row.start_time ? String(row.start_time).slice(0, 5) : null,
    endTime: row.end_time ? String(row.end_time).slice(0, 5) : null,
    durationMinutes: row.duration_minutes,
    venueId: row.venue_id,
    venueName: row.venue_name,
    pitchId: row.pitch_id,
    pitchName: row.pitch_name,
    status: row.status,
    agenda: row.agenda,
    furtherNotes: row.further_notes,
    notes: row.notes,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    cancelledByName: row.cancelled_by_name,
    myAttendance: row.my_attendance_status,
    canManage: row.can_manage === true,
    canViewRegister: row.can_view_register === true,
  }
}

export type TrainingResult = { ok: true } | { ok: false; message: string }

function failed(error: { message?: string; code?: string } | null, fallback: string): TrainingResult {
  const message = error?.message?.trim()
  if (!message || error?.code === "42501" || /row-level security|permission denied/i.test(message)) {
    return { ok: false, message: fallback }
  }
  return { ok: false, message }
}

/**
 * CHANGING THIS OCCURRENCE, NOT THE PLAN.
 *
 * `override_training_session` writes an override on one materialised session. Moving next Tuesday's
 * session to a different pitch does not reschedule every Tuesday for the rest of the season, which is
 * what a plan edit would do and almost never what somebody means.
 *
 * ONLY WHAT CHANGED IS SENT. The RPC treats a null as "leave it", so passing every field back would be
 * harmless but passing a CLEARED field is how somebody's agenda disappears; each caller sends its one
 * value.
 */
export async function overrideTrainingSession(
  supabase: Client,
  sessionId: string,
  patch: {
    date?: string
    startTime?: string | null
    durationMinutes?: number | null
    venueId?: string | null
    pitchId?: string | null
    agenda?: string | null
    furtherNotes?: string | null
  }
): Promise<TrainingResult> {
  const { error } = await supabase.rpc("override_training_session", {
    p_session_id: sessionId,
    p_session_date: (patch.date ?? null) as unknown as string,
    p_start_time: (patch.startTime ?? null) as unknown as string,
    p_duration_minutes: (patch.durationMinutes ?? null) as unknown as number,
    p_venue_id: (patch.venueId ?? null) as unknown as string,
    p_pitch_id: (patch.pitchId ?? null) as unknown as string,
    p_cancel: false,
    p_reason: null as unknown as string,
    p_agenda: (patch.agenda ?? null) as unknown as string,
    p_further_notes: (patch.furtherNotes ?? null) as unknown as string,
  })
  return error ? failed(error, "You can't change this training session.") : { ok: true }
}

/**
 * Cancelling, which is its own flow and requires a reason.
 *
 * `override_training_session` routes a cancel straight through to this rather than duplicating it,
 * which is why there is one place a session becomes cancelled and one place the reason is demanded.
 */
export async function cancelTrainingSession(supabase: Client, sessionId: string, reason: string): Promise<TrainingResult> {
  const trimmed = reason.trim()
  if (!trimmed) return { ok: false, message: "Say why it is cancelled, so the squad and their families are told." }
  const { error } = await supabase.rpc("cancel_training_session", { p_session_id: sessionId, p_reason: trimmed })
  return error ? failed(error, "You can't cancel this training session.") : { ok: true }
}
