import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@ovalball/contracts"

import { friendly, logDetail } from "../errors/translate"

/**
 * TELLING THE SQUAD SOMETHING, WHICH IS NOT THE SAME AS POSTING IN THE THREAD.
 *
 * These are deliberately two different things and are not merged into one
 * control, on either client. Posting in the conversation reaches whoever comes
 * and reads it; an ANNOUNCEMENT is a NOTIFICATION delivered through the
 * safeguarding-aware recipient model, so it reaches a guardian who never opens
 * the app. Collapsing the second into the first would quietly stop families
 * being told things.
 *
 * `send_fixture_communication` is the canonical RPC the website's own composer
 * calls. It resolves the audience, the recipients and the rate limit itself, and
 * refuses a caller without fixture-communication authority -- so this module
 * carries no audience rule of its own and could not widen one if it tried.
 */

export type AnnounceAudience = "MESSAGE_TEAM" | "MESSAGE_ATTENDEES"

export interface AudienceCounts {
  /** Null means this viewer is not entitled to the figure. The option is then not offered at all, rather than showing a confident zero. */
  team: number | null
  attending: number | null
  outstanding: number | null
}

export async function loadAudienceCounts(supabase: SupabaseClient<Database>, fixtureId: string): Promise<AudienceCounts> {
  const { data } = await supabase.rpc("fixture_communication_counts", { p_fixture_id: fixtureId }).maybeSingle()
  return {
    team: data?.team_count ?? null,
    attending: data?.attending_count ?? null,
    outstanding: data?.outstanding_count ?? null,
  }
}

export type AnnounceResult = { ok: true; reached: number | null } | { ok: false; message: string }

/**
 * The outcomes the sender can actually act on, in the words the website uses.
 * Anything else is reported as a generic failure rather than echoing a raw
 * database message, which can name the fixture, the capability or a constraint.
 */
const OUTCOME_MESSAGE: Record<string, string> = {
  NO_ELIGIBLE_RECIPIENTS: "There's nobody eligible to receive this message.",
  RATE_LIMITED: "That was just sent. Please wait a few minutes before sending it again.",
  FAILED: "We couldn't send that message. Please try again.",
}

export async function announceToSquad(
  supabase: SupabaseClient<Database>,
  fixtureId: string,
  audience: AnnounceAudience,
  body: string
): Promise<AnnounceResult> {
  const trimmed = body.trim()
  if (trimmed.length === 0) return { ok: false, message: "Write a message before sending it." }
  if (trimmed.length > 2000) return { ok: false, message: "That message is too long. Keep it under 2000 characters." }

  const { data, error } = await supabase
    .rpc("send_fixture_communication", { p_fixture_id: fixtureId, p_action: audience, p_body: trimmed })
    .single()

  if (error) {
    const problem = friendly(error, "this announcement")
    logDetail("fixture announcement", problem)
    return { ok: false, message: problem.message.startsWith("Couldn't load") ? OUTCOME_MESSAGE.FAILED : problem.message }
  }

  const outcome = (data as { outcome?: string; recipients?: number } | null)?.outcome ?? "FAILED"
  if (outcome === "SENT") return { ok: true, reached: (data as { recipients?: number } | null)?.recipients ?? null }
  return { ok: false, message: OUTCOME_MESSAGE[outcome] ?? OUTCOME_MESSAGE.FAILED }
}
