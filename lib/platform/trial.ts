import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

/**
 * A club's trial of Ovalball. Thirty **usable** days: the clock stops while
 * Ovalball is in Beta and while the trial is paused, so a club never loses
 * days to time it could not use.
 *
 * This is Ovalball charging a club. It has nothing to do with a club
 * charging its own members — see docs/COMMERCIAL_PLATFORM_ARCHITECTURE.md.
 */
export type TrialStatus = "active" | "paused" | "completed" | "converted"

/** Why the clock is stopped. `beta` is set and cleared by the platform. */
export type TrialPauseReason = "beta" | "club_request" | "admin"

export interface ClubTrialState {
  status: TrialStatus
  remainingSeconds: number
  entitlementSeconds: number
  consumedSeconds: number
  pauseReason: TrialPauseReason | null
  startedAt: string
  completedAt: string | null
}

const SECONDS_PER_DAY = 86_400

/**
 * Null when the club has no trial, or when the reader is not entitled to
 * see it — the RPC returns no rows in both cases, and the difference is not
 * something a caller should be able to probe.
 */
export async function getClubTrial(
  supabase: SupabaseClient<Database>,
  clubId: string
): Promise<ClubTrialState | null> {
  const { data, error } = await supabase.rpc("club_trial_state", { p_club_id: clubId })

  if (error || !data || data.length === 0) return null

  const row = data[0]
  return {
    status: row.status as TrialStatus,
    remainingSeconds: Number(row.remaining_seconds),
    entitlementSeconds: Number(row.entitlement_seconds),
    consumedSeconds: Number(row.consumed_seconds),
    pauseReason: (row.pause_reason as TrialPauseReason | null) ?? null,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }
}

/**
 * Days remaining, rounded up: a trial with two hours left has one day left,
 * not zero. Showing "0 days left" on a trial that still works reads as a
 * bug to the club, and reads as a broken promise when it does not.
 */
export function trialDaysRemaining(trial: ClubTrialState): number {
  return Math.ceil(trial.remainingSeconds / SECONDS_PER_DAY)
}

export function isTrialRunning(trial: ClubTrialState): boolean {
  return trial.status === "active"
}

/** Paused by Ovalball being in Beta, rather than by the club or an admin. */
export function isPausedByBeta(trial: ClubTrialState): boolean {
  return trial.status === "paused" && trial.pauseReason === "beta"
}
