"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

/**
 * Staff communications from the Match Centre.
 *
 * Note what these actions DO NOT accept: no recipient list, no email address,
 * no user id, no player id, no team id, no CC. The signature is the security
 * boundary -- there is no parameter an attacker could aim, because the
 * recipients are derived inside send_fixture_communication from canonical
 * relationships under an authority check this action does not perform and
 * cannot weaken.
 *
 * The outcome vocabulary comes from the database, not from here.
 */

export type CommunicationAction = "ATTENDANCE_REMINDER" | "MESSAGE_ATTENDEES" | "MESSAGE_TEAM"

export type CommunicationResult =
  | { ok: true; outcome: "SENT" | "PARTIALLY_DELIVERED"; playerCount: number }
  | { ok: false; outcome: "NO_ELIGIBLE_RECIPIENTS" | "RATE_LIMITED" | "FAILED" | "ERROR"; error: string }

/**
 * Failure copy is deliberately plain. A sender learns what happened and what
 * to do; they never learn who was on the list, and no provider response,
 * database message or configuration value reaches them.
 */
const OUTCOME_MESSAGE: Record<string, string> = {
  NO_ELIGIBLE_RECIPIENTS: "There's nobody eligible to receive this message.",
  RATE_LIMITED: "That was just sent. Please wait a few minutes before sending it again.",
  FAILED: "We couldn't send that message. Please try again.",
}

export async function sendFixtureCommunication(
  fixtureId: string,
  action: CommunicationAction,
  body?: string
): Promise<CommunicationResult> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .rpc("send_fixture_communication", {
      p_fixture_id: fixtureId,
      p_action: action,
      p_body: body && body.trim().length > 0 ? body.trim() : undefined,
    })
    .single()

  if (error || !data) {
    // The raw message can name the fixture, the capability or the constraint;
    // only the two the sender can act on are echoed.
    const message = error?.message ?? ""
    if (message.startsWith("Write a message") || message.startsWith("That message is too long")) {
      return { ok: false, outcome: "ERROR", error: message }
    }
    if (message.startsWith("You are not authorized") || message.startsWith("This fixture is not available")) {
      return { ok: false, outcome: "ERROR", error: "You don't have permission to send this." }
    }
    console.error("send_fixture_communication failed:", message)
    return { ok: false, outcome: "FAILED", error: OUTCOME_MESSAGE.FAILED }
  }

  const outcome = data.outcome as string
  if (outcome === "SENT" || outcome === "PARTIALLY_DELIVERED") {
    return { ok: true, outcome, playerCount: data.player_count ?? 0 }
  }
  return {
    ok: false,
    outcome: (outcome as "NO_ELIGIBLE_RECIPIENTS" | "RATE_LIMITED" | "FAILED") ?? "FAILED",
    error: OUTCOME_MESSAGE[outcome] ?? OUTCOME_MESSAGE.FAILED,
  }
}

export async function revalidateFixture(fixtureId: string): Promise<void> {
  revalidatePath(`/fixtures/${fixtureId}`)
}
