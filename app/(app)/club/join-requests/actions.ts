"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

/**
 * Resolving a join request.
 *
 * `alreadyResolved` is a distinct outcome rather than a generic failure,
 * because it is not a failure: it means somebody else with the authority to
 * decide has decided. The screen says so and refreshes, instead of showing a
 * manager an error for a race they did nothing wrong in.
 */
export type ResolveResult =
  | { ok: true }
  | { ok: false; alreadyResolved: true; error: string }
  | { ok: false; alreadyResolved: false; error: string }

const ALREADY_RESOLVED = "already been resolved"

function toResult(error: { message: string } | null): ResolveResult {
  if (!error) return { ok: true }
  if (error.message.includes(ALREADY_RESOLVED)) {
    return { ok: false, alreadyResolved: true, error: error.message }
  }
  return { ok: false, alreadyResolved: false, error: error.message }
}

export async function approveJoinRequest(requestId: string, teamId: string): Promise<ResolveResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("approve_player_club_join_request", {
    p_request_id: requestId,
    p_team_id: teamId,
  })
  revalidatePath("/club/join-requests")
  revalidatePath("/dashboard")
  return toResult(error)
}

export async function declineJoinRequest(requestId: string, reason: string): Promise<ResolveResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("decline_player_club_join_request", {
    p_request_id: requestId,
    p_reason: reason.trim() || undefined,
  })
  revalidatePath("/club/join-requests")
  return toResult(error)
}
