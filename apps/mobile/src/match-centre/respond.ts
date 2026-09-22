import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@ovalball/contracts"
import type { AvailabilityStatus } from "@ovalball/contracts/availability"

import { friendly, logDetail } from "../errors/translate"

/**
 * RECORDING AN ANSWER -- THE CANONICAL MUTATION, AND NOTHING ELSE.
 *
 * `public.respond_to_attendance` and `public.respond_to_training_attendance` are
 * the same two functions the website's server actions call. There is no mobile
 * write path, no local queue that reconciles later, and no second copy of the
 * safeguarding rule: both RPCs resolve authority through
 * `internal.resolve_attendance_response_source` and refuse a cancelled event, so
 * a refusal here is the platform's refusal rather than this client's.
 *
 * THE RESULT IS THE SERVER'S ANSWER. `ok` is true only when the database
 * accepted the write. The control above it does not move until it does, which is
 * the single most important property of this screen: a parent who believes they
 * have said their child is available, and has not, is the failure availability
 * exists to prevent.
 *
 * OFFLINE IS A FAILURE, NOT A DEFERRAL. There is deliberately no outbox. A
 * queued answer would show as recorded on the phone while the club's register
 * still said "awaiting", and the club would plan a match around a number that is
 * not true. The person is told the answer did not reach Ovalball and can tap
 * again when it can.
 */

export interface RespondResult {
  ok: boolean
  message: string | null
}

export async function respondToFixture(
  supabase: SupabaseClient<Database>,
  fixtureId: string,
  playerId: string,
  status: AvailabilityStatus
): Promise<RespondResult> {
  const { error } = await supabase.rpc("respond_to_attendance", {
    p_fixture_id: fixtureId,
    p_player_id: playerId,
    p_status: status,
  })
  return interpret(error, "this answer")
}

export async function respondToTraining(
  supabase: SupabaseClient<Database>,
  trainingSessionId: string,
  playerId: string,
  status: AvailabilityStatus
): Promise<RespondResult> {
  const { error } = await supabase.rpc("respond_to_training_attendance", {
    p_training_session_id: trainingSessionId,
    p_player_id: playerId,
    p_status: status,
  })
  return interpret(error, "this answer")
}

/**
 * A REFUSAL IS AN EXPLANATION, NOT A CODE.
 *
 * The canonical functions raise sentences a person can act on -- "Guardian
 * consent for self-attendance is not currently granted.", "This fixture has been
 * cancelled, so no answer is needed." Those are carried through verbatim,
 * because the database wrote them for exactly this purpose and rewording them
 * here would put a second vocabulary in front of the same rule. Anything that is
 * NOT one of those -- a dropped connection, a dead session -- goes through the
 * shared translator, which is what every other mutation in this app uses.
 */
function interpret(error: { message?: string; code?: string } | null, subject: string): RespondResult {
  if (!error) return { ok: true, message: null }
  const raw = (error.message ?? "").trim()
  // 42501 is the canonical "you may not" from the authority resolver and from
  // the cancelled-event guard, and its message is ALREADY the sentence to show.
  // The shared translator would replace it with "You do not have access to this
  // answer", which is true and useless -- "Guardian consent for self-attendance
  // is not currently granted" tells a sixteen-year-old what to do about it.
  if (error.code === "42501" && raw.length > 0) {
    logDetail("availability refused", { message: raw, detail: raw, retryable: false })
    return { ok: false, message: raw }
  }
  const failure = friendly(error, subject)
  logDetail("availability write", failure)
  // THE FALLBACK IS A WRITE'S FALLBACK. The shared translator's last resort is
  // "Couldn't load …", which is the wrong sentence for an answer that did not
  // arrive -- and the wrong sentence here is the one that leaves somebody
  // believing a refused answer was recorded.
  const message = failure.message.startsWith("Couldn't load")
    ? "That answer didn't reach Ovalball, so nothing has been recorded. Try again."
    : failure.message
  return { ok: false, message }
}
