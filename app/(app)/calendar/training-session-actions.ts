"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type TrainingActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

const SAFE_TRAINING_ERROR_PREFIXES = [
  "A reason is required",
  "Cancellation reason is too long",
  "Reason is too long",
  "Not authorized",
  "You are not authorized",
  "Training session not found",
  "Training plan not found",
  "This training session has already been cancelled",
  "A completed training session cannot be cancelled",
  "This training session has been cancelled",
  "The selected pitch does not belong",
  "Agenda cannot be blank",
  "Agenda is too long",
  "Further notes are too long",
  "Invalid attendance status",
  "This player is not associated",
  "You must be signed in",
  "Age could not be verified",
  "Guardian consent for self-attendance",
  "Players under 16",
]

function toPublicTrainingSessionError(message: string): string {
  if (SAFE_TRAINING_ERROR_PREFIXES.some((p) => message.startsWith(p))) return message
  console.error("Training session RPC raw error (sanitized before returning to browser):", message)
  return "Something went wrong. Please try again."
}

export interface TrainingSessionCard {
  id: string
  clubId: string
  teamId: string | null
  teamLabel: string
  schedulingGroupId: string | null
  seasonId: string | null
  trainingPlanId: string | null
  sessionDate: string
  startTime: string | null
  endTime: string | null
  durationMinutes: number | null
  venueId: string | null
  venueName: string | null
  pitchId: string | null
  pitchName: string | null
  status: "PLANNED" | "CANCELLED"
  source: "MANUAL" | "AUTOMATIC_PLAN"
  agenda: string
  furtherNotes: string | null
  notes: string | null
  cancelledAt: string | null
  cancellationReason: string | null
  cancelledByName: string | null
  myAttendanceStatus: "ATTENDING" | "CANNOT_ATTEND" | "UNSURE" | null
  canManage: boolean
  canViewRegister: boolean
}

export async function getTrainingSessionCard(sessionId: string): Promise<TrainingActionResult<TrainingSessionCard>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("get_training_session_card", { p_training_session_id: sessionId })
  if (error) return { ok: false, error: toPublicTrainingSessionError(error.message) }
  const row = (data as unknown[])?.[0] as Record<string, unknown> | undefined
  if (!row) return { ok: false, error: "Training session not found." }
  return {
    ok: true,
    data: {
      id: row.id as string,
      clubId: row.club_id as string,
      teamId: row.team_id as string | null,
      teamLabel: row.team_label as string,
      schedulingGroupId: row.scheduling_group_id as string | null,
      seasonId: row.season_id as string | null,
      trainingPlanId: row.training_plan_id as string | null,
      sessionDate: row.session_date as string,
      startTime: row.start_time as string | null,
      endTime: row.end_time as string | null,
      durationMinutes: row.duration_minutes as number | null,
      venueId: row.venue_id as string | null,
      venueName: row.venue_name as string | null,
      pitchId: row.pitch_id as string | null,
      pitchName: row.pitch_name as string | null,
      status: row.status as "PLANNED" | "CANCELLED",
      source: row.source as "MANUAL" | "AUTOMATIC_PLAN",
      agenda: row.agenda as string,
      furtherNotes: row.further_notes as string | null,
      notes: row.notes as string | null,
      cancelledAt: row.cancelled_at as string | null,
      cancellationReason: row.cancellation_reason as string | null,
      cancelledByName: row.cancelled_by_name as string | null,
      myAttendanceStatus: row.my_attendance_status as "ATTENDING" | "CANNOT_ATTEND" | "UNSURE" | null,
      canManage: row.can_manage as boolean,
      canViewRegister: row.can_view_register as boolean,
    },
  }
}

export interface TrainingRegisterRow {
  playerId: string
  firstName: string
  surname: string
  status: "ATTENDING" | "CANNOT_ATTEND" | "UNSURE" | null
  responseSource: "guardian" | "player" | "staff" | null
  respondedAt: string | null
}

export async function getTrainingRegister(sessionId: string): Promise<TrainingActionResult<TrainingRegisterRow[]>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("get_training_register", { p_training_session_id: sessionId })
  if (error) return { ok: false, error: toPublicTrainingSessionError(error.message) }
  const rows = ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    playerId: r.player_id as string,
    firstName: r.first_name as string,
    surname: r.surname as string,
    status: r.status as TrainingRegisterRow["status"],
    responseSource: r.response_source as TrainingRegisterRow["responseSource"],
    respondedAt: r.responded_at as string | null,
  }))
  return { ok: true, data: rows }
}

export interface MyTrainingPlayer {
  playerId: string
  firstName: string
  surname: string
  relationship: "guardian" | "self"
  currentStatus: "ATTENDING" | "CANNOT_ATTEND" | "UNSURE" | null
}

export async function getMyPlayersForTrainingSession(sessionId: string): Promise<TrainingActionResult<MyTrainingPlayer[]>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("get_my_players_for_training_session", { p_training_session_id: sessionId })
  if (error) return { ok: false, error: toPublicTrainingSessionError(error.message) }
  const rows = ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    playerId: r.player_id as string,
    firstName: r.first_name as string,
    surname: r.surname as string,
    relationship: r.relationship as "guardian" | "self",
    currentStatus: r.current_status as MyTrainingPlayer["currentStatus"],
  }))
  return { ok: true, data: rows }
}

export async function respondToTrainingAttendance(sessionId: string, playerId: string, status: "ATTENDING" | "CANNOT_ATTEND" | "UNSURE"): Promise<TrainingActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("respond_to_training_attendance", { p_training_session_id: sessionId, p_player_id: playerId, p_status: status })
  if (error) return { ok: false, error: toPublicTrainingSessionError(error.message) }
  revalidatePath("/calendar")
  revalidatePath("/dashboard")
  return { ok: true, data: undefined }
}

export async function cancelTrainingSessionWithReason(sessionId: string, reason: string): Promise<TrainingActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("cancel_training_session", { p_session_id: sessionId, p_reason: reason })
  if (error) return { ok: false, error: toPublicTrainingSessionError(error.message) }
  revalidatePath("/calendar")
  revalidatePath("/dashboard")
  revalidatePath("/club/training")
  revalidatePath("/calendar/pitch-allocation")
  return { ok: true, data: undefined }
}

export interface EditTrainingSessionInput {
  agenda?: string
  furtherNotes?: string
  startTime?: string
  durationMinutes?: number
  venueId?: string
  pitchId?: string
}

export async function editTrainingSession(sessionId: string, input: EditTrainingSessionInput): Promise<TrainingActionResult> {
  const supabase = await createClient()
  const rpcArgs = {
    p_session_id: sessionId,
    p_session_date: null,
    p_start_time: input.startTime ?? null,
    p_duration_minutes: input.durationMinutes ?? null,
    p_venue_id: input.venueId ?? null,
    p_pitch_id: input.pitchId ?? null,
    p_cancel: false,
    p_reason: null,
    p_agenda: input.agenda ?? null,
    p_further_notes: input.furtherNotes ?? null,
  }
  // p_session_date/p_venue_id/p_pitch_id/p_reason/p_agenda/p_further_notes are genuinely nullable at the SQL level; see save_training_plan's own comment on this generated-types limitation.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await supabase.rpc("override_training_session", rpcArgs as any)
  if (error) return { ok: false, error: toPublicTrainingSessionError(error.message) }
  revalidatePath("/calendar")
  revalidatePath("/dashboard")
  revalidatePath("/club/training")
  return { ok: true, data: undefined }
}

export interface TrainingPlanDeletionImpact {
  teamLabel: string
  scheduleMode: string
  venueName: string | null
  pitchName: string | null
  futureSessionCount: number
}

export async function getTrainingPlanDeletionImpact(planId: string): Promise<TrainingActionResult<TrainingPlanDeletionImpact>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("get_training_plan_deletion_impact", { p_plan_id: planId })
  if (error) return { ok: false, error: toPublicTrainingSessionError(error.message) }
  const row = (data as unknown[])?.[0] as Record<string, unknown> | undefined
  if (!row) return { ok: false, error: "Training plan not found." }
  return {
    ok: true,
    data: {
      teamLabel: row.team_label as string,
      scheduleMode: row.schedule_mode as string,
      venueName: row.venue_name as string | null,
      pitchName: row.pitch_name as string | null,
      futureSessionCount: row.future_session_count as number,
    },
  }
}

export async function deleteTrainingPlan(planId: string, reason: string): Promise<TrainingActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("deactivate_training_plan", { p_plan_id: planId, p_reason: reason })
  if (error) return { ok: false, error: toPublicTrainingSessionError(error.message) }
  revalidatePath("/calendar")
  revalidatePath("/dashboard")
  revalidatePath("/club/training")
  revalidatePath("/calendar/pitch-allocation")
  return { ok: true, data: undefined }
}
