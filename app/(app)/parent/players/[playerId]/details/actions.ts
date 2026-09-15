"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { requireMayRecordPlayerGender } from "@/lib/auth/require-capability"

export type PlayingPathwayResult =
  | { ok: true; reviewState: string | null; reason: string | null; resolved: boolean }
  | { ok: false; error: string }

/**
 * Records the player's gender, which Ovalball stores as their playing pathway.
 *
 * The server decides who may do this -- an active guardian or the adult player
 * themselves (player.profile.edit_protected), and a correction by Ovalball
 * (site.users.identity.correct) -- and deliberately not club or team staff.
 * It also recalculates anything that was waiting on the answer and hands back
 * the result, so the person who supplied it is told what it settled rather
 * than being sent somewhere else to find out.
 */
export async function setPlayerGender(playerId: string, pathway: "MALE" | "FEMALE"): Promise<PlayingPathwayResult> {
  const supabase = await createClient()
  const allowed = await requireMayRecordPlayerGender(supabase, playerId)
  if (!allowed.ok) return allowed
  const { data, error } = await supabase.rpc("set_player_playing_pathway", {
    p_player_id: playerId,
    p_playing_pathway: pathway,
  })
  if (error) return { ok: false, error: error.message }
  const row = (data ?? [])[0]
  revalidatePath(`/parent/players/${playerId}/details`)
  revalidatePath("/parent/children")
  revalidatePath("/club/rollover")
  return { ok: true, reviewState: row?.review_state ?? null, reason: row?.reason ?? null, resolved: row?.resolved ?? false }
}
