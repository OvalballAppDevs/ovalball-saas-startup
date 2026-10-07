"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { confirmChildTeamRequest, declineChildTeamRequest } from "@ovalball/contracts/team/team-code"

export type TeamRequestAnswer = { ok: true } | { ok: false; error: string }

/**
 * A parent's answer to their child's own team request (team codes place players, 20270741000000). The
 * server re-checks that the caller is an ACTIVE guardian of that child and that the request still waits
 * on them; a refusal is its own sentence, passed through.
 */
export async function answerTeamRequest(membershipId: string, answer: "CONFIRM" | "DECLINE", reason?: string): Promise<TeamRequestAnswer> {
  const supabase = await createClient()
  try {
    if (answer === "CONFIRM") await confirmChildTeamRequest(supabase, membershipId)
    else await declineChildTeamRequest(supabase, membershipId, reason ?? null)
  } catch (cause) {
    const message = (cause as { message?: string }).message
    return { ok: false, error: message || "That didn't work. Try again." }
  }
  revalidatePath("/parent/team-requests")
  revalidatePath("/dashboard")
  return { ok: true }
}
