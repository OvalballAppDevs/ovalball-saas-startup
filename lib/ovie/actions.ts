"use server"

import { createClient } from "@/lib/supabase/server"
import { getSessionContext } from "@/lib/app-context/session-context"

import { buildOvieActorContext } from "./actor-context"
import { runOvieTurn } from "./orchestrator"
import { EMPTY_OVIE_STATE, type OvieConversationState, type OvieTurnResult } from "./types"

/**
 * The single entry point the "Ask Ovie" widget calls. Builds the real
 * actor context server-side from the authenticated session (never trusts
 * anything the browser claims about who the user is or what they can
 * manage), then hands off to runOvieTurn(). Conversation state is passed
 * in and returned by the caller -- see lib/ovie/orchestrator.ts's module
 * comment for why there is no server-side conversation store.
 */
export async function sendOvieMessage(state: OvieConversationState | null, message: string): Promise<OvieTurnResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return {
      state: state ?? EMPTY_OVIE_STATE,
      reply: "You need to be signed in to talk to Ovie.",
      candidates: null,
      confirmationCard: null,
      sentSummary: null,
      error: "not_signed_in",
    }
  }

  const ctx = await getSessionContext(supabase, user)
  const actor = buildOvieActorContext(ctx)
  return runOvieTurn(actor, state ?? EMPTY_OVIE_STATE, message)
}
