import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { detectResourceConflicts, type TrainingOccupancy } from "@/lib/pitch-allocation/training-conflicts"
import type { AllocationFixture, PitchOption } from "@/lib/pitch-allocation/types"
import { fullTeamLabel } from "@/lib/teams/compact-label"
import type { Database } from "@/types/database.types"

export interface TrainingException {
  trainingSessionId: string
  teamLabel: string
  date: string
  startTime: string | null
  pitchName: string
  reason: string
  severity: "hard" | "warning"
}

const EXCEPTION_WINDOW_DAYS = 30

/**
 * SIDE PROJECT 2 -- Training Management dashboard "Exceptions / Conflicts"
 * panel (Section 6). Reuses the exact same shared conflict engine the
 * Pitch Allocation board uses (lib/pitch-allocation/training-conflicts.ts)
 * rather than a second ad hoc conflict check -- scans the next 30 days
 * (current/future emphasis, Section 6's own "do not clutter with
 * historical data" instruction) across every date that has at least one
 * training session with a pitch assigned, checking it against both other
 * training sessions AND real fixtures on that same date/pitch.
 */
export async function getTrainingExceptions(supabase: SupabaseClient<Database>, clubId: string): Promise<TrainingException[]> {
  const today = new Date()
  const startIso = today.toISOString().slice(0, 10)
  const endDate = new Date(today)
  endDate.setDate(endDate.getDate() + EXCEPTION_WINDOW_DAYS)
  const endIso = endDate.toISOString().slice(0, 10)

  const { data: teamRows } = await supabase.from("teams").select("id").eq("club_id", clubId)
  const teamIds = (teamRows ?? []).map((t) => t.id)
  if (teamIds.length === 0) return []

  const { data: pitchRows } = await supabase.from("club_pitches").select("id, display_name, active, venue_id, size_category, lane_count").eq("club_id", clubId)
  const pitches: PitchOption[] = (pitchRows ?? []).map((p) => ({ id: p.id, displayName: p.display_name, active: p.active, venueId: p.venue_id, sizeCategory: p.size_category as PitchOption["sizeCategory"], laneCount: p.lane_count }))
  const pitchNameById = new Map(pitches.map((p) => [p.id, p.displayName]))

  const { data: trainingRows } = await supabase
    .from("training_sessions")
    .select("id, team_id, occurrence_date, start_time, duration_minutes, pitch_id, status, source, teams(display_name, category, age_group, gender, squad_designation)")
    .in("team_id", teamIds)
    .neq("status", "CANCELLED")
    .gte("occurrence_date", startIso)
    .lte("occurrence_date", endIso)
    .not("pitch_id", "is", null)

  if (!trainingRows || trainingRows.length === 0) return []

  const datesWithTraining = Array.from(new Set(trainingRows.map((t) => t.occurrence_date).filter((d): d is string => Boolean(d))))

  const { data: fixtureRows } = await supabase
    .from("fixtures")
    .select("id, home_team_id, pitch_id, kickoff_date, kickoff_time, status, teams!fixtures_owning_team_id_fkey(display_name), opponent:teams!fixtures_opponent_team_id_fkey(display_name)")
    .in("home_team_id", teamIds)
    .in("kickoff_date", datesWithTraining)
    .neq("status", "Cancelled")

  const exceptions: TrainingException[] = []

  for (const date of datesWithTraining) {
    const trainingForDate: TrainingOccupancy[] = trainingRows
      .filter((t) => t.occurrence_date === date)
      .map((t) => ({
        trainingSessionId: t.id,
        teamLabel: t.teams ? fullTeamLabel({ category: t.teams.category as "senior" | "youth" | "colts", ageGroup: t.teams.age_group, gender: t.teams.gender, squadDesignation: t.teams.squad_designation }) : "Team",
        venueId: null,
        pitchId: t.pitch_id,
        sessionDate: date,
        startTime: t.start_time,
        durationMinutes: t.duration_minutes,
        status: t.status as "PLANNED" | "CANCELLED",
        source: t.source as "MANUAL" | "AUTOMATIC_PLAN",
      }))

    const fixturesForDate: AllocationFixture[] = (fixtureRows ?? [])
      .filter((f) => f.kickoff_date === date && f.pitch_id && f.kickoff_time)
      .map((f) => ({
        fixtureId: f.id,
        homeTeamId: f.home_team_id!,
        homeTeamLabel: f.teams?.display_name ?? "Team",
        opponentLabel: f.opponent?.display_name ?? "Opponent",
        category: "youth",
        ageGroup: null,
        gender: null,
        status: f.status,
        kickoffDate: date,
        kickoffTime: f.kickoff_time,
        venueId: null,
        pitchId: f.pitch_id,
        durationMinutes: 80,
        durationConfidence: null,
        requiredPitchSize: null,
        requiresOpponentAgreement: false,
        isSharedGroup: false,
        schedulingGroupId: null,
        awaySchedulingGroupId: null,
        effectiveHomeTeamIds: [],
        effectiveAwayTeamIds: [],
      }))

    const { trainingConflicts } = detectResourceConflicts(fixturesForDate, trainingForDate, pitches)
    for (const c of trainingConflicts) {
      const session = trainingForDate.find((t) => t.trainingSessionId === c.trainingSessionId)
      if (!session) continue
      exceptions.push({
        trainingSessionId: session.trainingSessionId,
        teamLabel: session.teamLabel,
        date,
        startTime: session.startTime,
        pitchName: pitchNameById.get(session.pitchId ?? "") ?? "Unknown pitch",
        reason: c.reason,
        severity: c.severity,
      })
    }
  }

  return exceptions.sort((a, b) => (a.date + (a.startTime ?? "")).localeCompare(b.date + (b.startTime ?? "")))
}
