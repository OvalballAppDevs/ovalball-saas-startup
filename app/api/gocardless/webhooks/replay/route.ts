import { timingSafeEqual } from "node:crypto"

import { NextResponse, type NextRequest } from "next/server"

import type { GoCardlessEnvironment } from "@/lib/payments/gocardless/env"
import { GoCardlessEventDeferred, processGoCardlessEvent, type GoCardlessEvent } from "@/lib/payments/gocardless/process-event"
import { drainGoCardlessTokenRevocations } from "@/lib/payments/gocardless/token-revocation"
import { syncGoCardlessVerificationStatus } from "@/lib/payments/gocardless/verification"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

export const dynamic = "force-dynamic"

/** Events are claimed a few at a time, so each one is processed well inside its two-minute claim. */
const CLAIM_BATCH = 5
const MAX_EVENTS_PER_RUN = 50
/** Stop claiming after this long; the schedule comes back in ten minutes. */
const CLAIM_TIME_BUDGET_MS = 100_000
const VERIFICATION_CHECKS_PER_RUN = 5

/** What a run did -- counts only. This exact shape is the route's answer and its one log line. */
interface ReplaySummary {
  ok: boolean
  claimed: number
  replayed: number
  deferred: number
  failed: number
  tokensRevoked: number
  tokensFailed: number
  verificationChecked: number
  verificationFailed: number
}

/**
 * THE EVENTS GOCARDLESS HAS STOPPED REDELIVERING (20270744000000), RUN ON A SCHEDULE (20270749000000).
 *
 * The webhook answers 500 when an event fails, so GoCardless redelivers -- for a while. Anything still unprocessed
 * after that is claimed here (claim_stale_gocardless_events: skip-locked, a back-off that doubles with each attempt,
 * a dead-letter state once the budget is spent) and processed by the SAME code the webhook uses. An event whose club
 * has no live connection to its GoCardless account is DEFERRED rather than failed, and comes back here once the club
 * reconnects. Then the queue of tokens waiting to be revoked is drained -- the only revocation a disconnect made from
 * the phone gets -- and a few live connections whose verification is still unknown (a reconnect whose own check
 * failed) are checked again.
 *
 * Called by pg_cron through pg_net every ten minutes (internal.request_gocardless_replay), never by a browser: it
 * answers only to the bearer secret GOCARDLESS_REPLAY_SECRET, does not exist (503) where that secret is not
 * configured, and takes no input. It logs ONE line per run -- counts only, never a payload, a token or a header.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.GOCARDLESS_REPLAY_SECRET
  if (!secret) {
    console.error("[gocardless replay] Answered 503: GOCARDLESS_REPLAY_SECRET is not configured here.")
    return NextResponse.json({ error: "Replay is not configured." }, { status: 503 })
  }
  const presented = Buffer.from(request.headers.get("Authorization") ?? "")
  const expected = Buffer.from(`Bearer ${secret}`)
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    console.error("[gocardless replay] Answered 401: the request did not carry the replay bearer secret.")
    return NextResponse.json({ error: "Not authorised." }, { status: 401 })
  }

  const supabase = createServiceRoleClient()
  const summary: ReplaySummary = { ok: true, claimed: 0, replayed: 0, deferred: 0, failed: 0, tokensRevoked: 0, tokensFailed: 0, verificationChecked: 0, verificationFailed: 0 }
  const started = Date.now()
  let claimFailed = false

  while (summary.claimed < MAX_EVENTS_PER_RUN && Date.now() - started < CLAIM_TIME_BUDGET_MS) {
    const { data: batch, error } = await supabase.rpc("claim_stale_gocardless_events", { p_limit: Math.min(CLAIM_BATCH, MAX_EVENTS_PER_RUN - summary.claimed) })
    if (error) {
      claimFailed = true
      break
    }
    if (!batch || batch.length === 0) break

    for (const row of batch) {
      summary.claimed += 1
      try {
        await processGoCardlessEvent(supabase, row.payload as unknown as GoCardlessEvent)
        const { error: markError } = await supabase.rpc("mark_gocardless_event_processed", { p_event_id: row.id, p_error: undefined })
        if (markError) throw new Error(markError.message)
        summary.replayed += 1
      } catch (cause) {
        let failure = cause
        if (cause instanceof GoCardlessEventDeferred) {
          const { error: deferError } = await supabase.rpc("defer_gocardless_event", { p_event_id: row.id, p_club_id: cause.clubId, p_reason: cause.reason })
          if (!deferError) {
            summary.deferred += 1
            continue
          }
          failure = new Error(`Could not defer the event: ${deferError.message}`)
        }
        summary.failed += 1
        // Kept on the event (processing_error, with its first error), never logged here: the summary is counts only.
        await supabase.rpc("mark_gocardless_event_processed", { p_event_id: row.id, p_error: failure instanceof Error ? failure.message : "Unknown error." })
      }
    }
  }

  if (claimFailed && summary.claimed === 0) {
    console.error("[gocardless replay] Answered 500: the inbox could not be claimed.")
    return NextResponse.json({ error: "Could not claim events." }, { status: 500 })
  }

  let drainFailed = false
  try {
    const revocations = await drainGoCardlessTokenRevocations()
    summary.tokensRevoked = revocations.revoked
    summary.tokensFailed = revocations.failed
  } catch {
    drainFailed = true
  }

  const verification = await recheckUnknownVerification(supabase)
  summary.verificationChecked = verification.checked
  summary.verificationFailed = verification.failed

  summary.ok = summary.failed === 0 && summary.tokensFailed === 0 && !claimFailed && !drainFailed
  const line =
    `[gocardless replay] ok=${summary.ok} claimed=${summary.claimed} replayed=${summary.replayed} deferred=${summary.deferred} ` +
    `failed=${summary.failed} tokensRevoked=${summary.tokensRevoked} tokensFailed=${summary.tokensFailed} ` +
    `verificationChecked=${summary.verificationChecked} verificationFailed=${summary.verificationFailed}` +
    (claimFailed ? " claim=failed" : "") +
    (drainFailed ? " drain=failed" : "")
  if (summary.ok) console.info(line)
  else console.error(line)

  return NextResponse.json(summary)
}

/** A scheduler's door: nothing to read here. */
export async function GET() {
  return NextResponse.json({ error: "Use POST." }, { status: 405, headers: { Allow: "POST" } })
}

/**
 * A reconnect starts from an unknown verification status (store_gocardless_connection), and the callback's own
 * check can fail. Nothing else would ask again until GoCardless happened to send a creditor event, so enrolment
 * stayed blocked (the 6 October 2026 audit, B5/G8). A few such live connections are checked each run; a check that
 * fails writes nothing (syncGoCardlessVerificationStatus) and is counted.
 */
async function recheckUnknownVerification(supabase: ReturnType<typeof createServiceRoleClient>): Promise<{ checked: number; failed: number }> {
  const { data, error } = await supabase
    .from("gocardless_merchant_connections")
    .select("club_id, environment, access_token")
    .is("disconnected_at", null)
    .eq("verification_status", "unknown")
    .not("access_token", "is", null)
    .order("connected_at", { ascending: true })
    .limit(VERIFICATION_CHECKS_PER_RUN)
  if (error) return { checked: 0, failed: 1 }
  let checked = 0
  let failed = 0
  for (const connection of data ?? []) {
    try {
      await syncGoCardlessVerificationStatus({
        clubId: connection.club_id,
        environment: connection.environment as GoCardlessEnvironment,
        accessToken: connection.access_token as string,
      })
      checked += 1
    } catch {
      failed += 1
    }
  }
  return { checked, failed }
}
