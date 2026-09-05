"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type StartClubConversationResult =
  | { ok: true; conversationId: string; status: "pending" | "accepted" }
  | { ok: false; error: string }

/**
 * start_or_get_club_conversation (SECURITY DEFINER) does all the real
 * work -- reusing an existing pending/accepted conversation, skipping the
 * request stage for an active partnership, the 48h decline cooldown, and
 * the pending-outgoing cap. This action only forwards the call.
 */
export async function startClubConversation(myClubId: string, targetClubId: string, firstMessage: string): Promise<StartClubConversationResult> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc("start_or_get_club_conversation", { p_my_club_id: myClubId, p_target_club_id: targetClubId, p_first_message: firstMessage })
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? "Could not start this conversation." }
  revalidatePath("/messages")
  return { ok: true, conversationId: data.conversation_id, status: data.status as "pending" | "accepted" }
}

export type RespondToClubMessageRequestResult = { ok: true } | { ok: false; error: string }

export async function respondToClubMessageRequest(conversationId: string, approve: boolean): Promise<RespondToClubMessageRequestResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("respond_to_club_conversation", { p_conversation_id: conversationId, p_approve: approve })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/messages")
  return { ok: true }
}
