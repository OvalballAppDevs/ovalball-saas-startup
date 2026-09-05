"use server"

import { revalidatePath } from "next/cache"

import { activeClubId, resolveActiveContext, ACTIVE_CONTEXT_COOKIE } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"

export interface ScheduleRuleInput {
  weekday: number
  startTime: string
  durationMinutes: number
  startsOn?: string | null
  endsOn?: string | null
}

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

/** Section 45: re-derives the caller's real club_id/authority server-side on every call -- never trusts a client-supplied clubId alone. */
async function requireTrainingManageAccess(clubId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: "You must be signed in." }

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const realClubId = activeClubId(ctx, activeContext)
  if (!realClubId || realClubId !== clubId) {
    return { ok: false as const, error: "You are not authorized to manage Training for this club." }
  }
  const can = await hasCapability(supabase, "club.training.manage", "club", { clubId })
  if (!can) return { ok: false as const, error: "You are not authorized to manage Training Plans for this club." }
  return { ok: true as const, supabase, user }
}

function toPublicTrainingError(message: string): string {
  const safePrefixes = [
    "A team is required",
    "That is not an active team",
    "Invalid schedule mode",
    "A season is required",
    "A preferred training venue is required",
    "A preferred training pitch is required",
    "That venue is not available",
    "The preferred pitch must belong",
    "At least one schedule rule",
    "Each schedule rule",
    "Each custom schedule row",
    "This schedule row",
    "You are not authorized",
    "Training plan not found",
    "Training session not found",
    "The selected pitch does not belong",
  ]
  if (safePrefixes.some((p) => message.startsWith(p))) return message
  console.error("Training Management RPC raw error (sanitized before returning to browser):", message)
  return "Something went wrong saving this Training Plan. Please try again."
}

export async function savePlan(
  clubId: string,
  planId: string | null,
  teamId: string,
  scheduleMode: "SEASON" | "SEASON_PRE_SEASON" | "CUSTOM",
  seasonId: string | null,
  preferredVenueId: string,
  preferredPitchId: string,
  rules: ScheduleRuleInput[]
): Promise<ActionResult<{ planId: string }>> {
  const auth = await requireTrainingManageAccess(clubId)
  if (!auth.ok) return { ok: false, error: auth.error }

  // p_plan_id/p_season_id are genuinely nullable at the SQL level (create
  // vs. edit; CUSTOM mode has no season) -- the generated Args type just
  // doesn't reflect that (a known `supabase gen types` limitation: it
  // never marks a function parameter's default-null as optional/nullable
  // the way it does for table Insert types). Postgres itself accepts null
  // for both regardless of this cast; the RPC's own server-side validation
  // is the real boundary, not this type.
  const rpcArgs = {
    p_plan_id: planId,
    p_club_id: clubId,
    p_team_id: teamId,
    p_schedule_mode: scheduleMode,
    p_season_id: seasonId,
    p_preferred_venue_id: preferredVenueId,
    p_preferred_pitch_id: preferredPitchId,
    p_rules: rules.map((r) => ({
      weekday: r.weekday,
      start_time: r.startTime,
      duration_minutes: r.durationMinutes,
      starts_on: r.startsOn ?? null,
      ends_on: r.endsOn ?? null,
    })),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above
  const { data, error } = await auth.supabase.rpc("save_training_plan", rpcArgs as any)
  if (error) return { ok: false, error: toPublicTrainingError(error.message) }

  revalidatePath("/club/training")
  revalidatePath("/calendar")
  revalidatePath("/calendar/pitch-allocation")
  return { ok: true, data: { planId: data as string } }
}

export async function deactivatePlan(clubId: string, planId: string, reason: string | null): Promise<ActionResult> {
  const auth = await requireTrainingManageAccess(clubId)
  if (!auth.ok) return { ok: false, error: auth.error }
  // p_reason is nullable at the SQL level -- see the save_training_plan comment above for why this cast is needed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await auth.supabase.rpc("deactivate_training_plan", { p_plan_id: planId, p_reason: reason } as any)
  if (error) return { ok: false, error: toPublicTrainingError(error.message) }
  revalidatePath("/club/training")
  revalidatePath("/calendar")
  revalidatePath("/calendar/pitch-allocation")
  return { ok: true, data: undefined }
}

export async function reactivatePlan(clubId: string, planId: string): Promise<ActionResult> {
  const auth = await requireTrainingManageAccess(clubId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const { error } = await auth.supabase.rpc("reactivate_training_plan", { p_plan_id: planId })
  if (error) return { ok: false, error: toPublicTrainingError(error.message) }
  revalidatePath("/club/training")
  revalidatePath("/calendar")
  revalidatePath("/calendar/pitch-allocation")
  return { ok: true, data: undefined }
}

/** Section 78: server-side count via the SAME canonical resolver save_training_plan will use -- never a client-side reimplementation. */
export async function previewOccurrenceCount(
  clubId: string,
  scheduleMode: "SEASON" | "SEASON_PRE_SEASON" | "CUSTOM",
  seasonId: string | null,
  rules: ScheduleRuleInput[]
): Promise<ActionResult<{ count: number }>> {
  const auth = await requireTrainingManageAccess(clubId)
  if (!auth.ok) return { ok: false, error: auth.error }
  if (rules.length === 0) return { ok: true, data: { count: 0 } }

  // p_season_id is nullable at the SQL level (CUSTOM mode) -- see the save_training_plan comment above.
  const previewArgs = {
    p_club_id: clubId,
    p_schedule_mode: scheduleMode,
    p_season_id: seasonId,
    p_rules: rules.map((r) => ({ weekday: r.weekday, start_time: r.startTime, duration_minutes: r.durationMinutes, starts_on: r.startsOn ?? null, ends_on: r.endsOn ?? null })),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above
  const { data, error } = await auth.supabase.rpc("preview_training_plan_occurrences", previewArgs as any)
  if (error) return { ok: false, error: toPublicTrainingError(error.message) }
  return { ok: true, data: { count: (data as unknown[])?.length ?? 0 } }
}
