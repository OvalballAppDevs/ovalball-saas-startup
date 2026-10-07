import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js"
import { NextResponse, type NextRequest } from "next/server"

import { assertGoCardlessEnvironmentSafe, type GoCardlessEnvironment } from "@/lib/payments/gocardless/env"
import { exchangeGoCardlessOAuthCode, revokeGoCardlessToken } from "@/lib/payments/gocardless/oauth"
import { syncGoCardlessVerificationStatus, type GoCardlessVerificationStatus } from "@/lib/payments/gocardless/verification"
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/supabase/env"
import type { Database } from "@/types/database.types"

export const dynamic = "force-dynamic"

/**
 * THE APP FINISHES ITS GOCARDLESS CONNECTION (20270750000000).
 *
 * The browser has been to GoCardless and back; GoCardless's code is waiting in the intent, on the server,
 * and the app holds the intent's id and the one-time return handoff the browser was sent back with.
 * Everything here runs as the CALLER, from their own bearer token:
 *
 *   claim     `claim_gocardless_connect_code` hands the code over only to the person who started the
 *             intent, only with the handoff, only within GoCardless's five minutes, and only once. Without
 *             the handoff it answers `awaiting_return` and changes nothing; with a wrong one, or for anybody
 *             else, the intent is voided -- so neither a leaked intent id nor a begin link forwarded to
 *             another organisation (whose device, not the sender's, receives the handoff) can be finished.
 *   exchange  the code becomes the club's token over a server-to-GoCardless request; the token is never
 *             returned, logged or put anywhere but the call below.
 *   store     `store_gocardless_connection` asks for `finance.gocardless.connect` again, for the club the
 *             intent was created for -- so authority removed during the journey is refused here too.
 *
 * A token GoCardless issued that could not be stored is revoked at once rather than forgotten. Every
 * answer is a sentence a person can act on; a database or provider error is logged, never returned.
 */
export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization")
  if (!authorization?.startsWith("Bearer ")) {
    return answer({ ok: false, outcome: "failed", message: "Sign in to connect GoCardless." }, { status: 401 })
  }

  // The CALLER'S token: every database call below is theirs, and can do no more than they can.
  const supabase = createSupabaseClient<Database>(getSupabaseUrl(), getSupabasePublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  })
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return answer({ ok: false, outcome: "failed", message: "Sign in to connect GoCardless." }, { status: 401 })

  const body = await readBody(request)
  const intentId = typeof body?.intentId === "string" ? body.intentId : ""
  // The return handoff the app was sent back with: 256 bits, base64url. Absent is allowed (the database then
  // answers "awaiting_return" and changes nothing); present, it must at least have the right shape.
  const handoff = body?.handoff === undefined || body?.handoff === null ? null : typeof body.handoff === "string" ? body.handoff : ""
  if (!UUID.test(intentId) || (handoff !== null && !HANDOFF.test(handoff))) {
    return answer({ ok: false, outcome: "failed", message: "That request could not be read." }, { status: 400 })
  }

  const { data: claim, error: claimError } = await untyped(supabase)
    .rpc("claim_gocardless_connect_code", { p_intent_id: intentId, p_handoff: handoff })
    .single<{ outcome: string; code: string | null; club_id: string | null; reason: string | null }>()
  if (claimError) {
    // A dead session is refused by the RPC with a sentence written for the person (code === "42501").
    if (claimError.code === "42501") return answer({ ok: false, outcome: "failed", message: claimError.message }, { status: 403 })
    console.error("[gocardless app connect] claim failed:", claimError.code)
    return answer({ ok: false, outcome: "failed", message: COULD_NOT_COMPLETE }, { status: 500 })
  }

  if (!claim || claim.outcome !== "claimed" || !claim.code || !claim.club_id) {
    return unclaimed(claim?.outcome ?? "refused", claim?.reason ?? null)
  }

  const finish = async (ok: boolean, reason?: string) => {
    const { error } = await untyped(supabase).rpc("finish_gocardless_connect_intent", { p_intent_id: intentId, p_ok: ok, p_reason: reason ?? null })
    if (error) console.error("[gocardless app connect] recording the ending failed:", error.code)
  }

  let environment: GoCardlessEnvironment
  try {
    environment = assertGoCardlessEnvironmentSafe()
  } catch (cause) {
    console.error("[gocardless app connect] environment refused:", cause instanceof Error ? cause.message : cause)
    await finish(false, "environment_unavailable")
    return answer({ ok: false, outcome: "failed", message: "GoCardless cannot be reached from Ovalball right now. Please try again later." }, { status: 503 })
  }

  let token: { access_token: string; scope: string; organisation_id?: string }
  try {
    token = await exchangeGoCardlessOAuthCode(claim.code)
    if (!token?.access_token) throw new Error("GoCardless answered without an access token.")
  } catch (cause) {
    // GoCardless's own answer, which carries no token. Logged for whoever investigates; never returned.
    console.error("[gocardless app connect] token exchange failed:", cause instanceof Error ? cause.message.slice(0, 300) : cause)
    await finish(false, "exchange_failed")
    return answer({ ok: false, outcome: "failed", message: "GoCardless did not complete the connection. Please try connecting again." }, { status: 502 })
  }

  const { error: storeError } = await supabase.rpc("store_gocardless_connection", {
    p_club_id: claim.club_id,
    p_environment: environment,
    p_gc_organisation_id: token.organisation_id ?? "",
    p_access_token: token.access_token,
    p_scope: token.scope,
  })
  if (storeError) {
    console.error("[gocardless app connect] store_gocardless_connection refused:", storeError.code)
    // GoCardless issued a permanent token that Ovalball will not keep: revoked, not merely dropped.
    await revokeGoCardlessToken({ environment, token: token.access_token }).catch(() => undefined)
    if (storeError.code === "42501") {
      await finish(false, "not_authorised")
      return answer({ ok: false, outcome: "failed", message: "You are no longer authorised to connect GoCardless for this club." }, { status: 403 })
    }
    // 55000 is the function's own refusal to move a club that still has live Direct Debits onto a different
    // GoCardless account or environment (20270749000000). Retrying cannot change it, so the person is told --
    // in the same fixed sentence the website uses, never the database's own words. Every other failure stays
    // generic.
    if (storeError.code === "55000") {
      await finish(false, "organisation_switch_refused")
      return answer({ ok: false, outcome: "failed", message: SWITCH_REFUSED }, { status: 409 })
    }
    await finish(false, "store_failed")
    return answer({ ok: false, outcome: "failed", message: COULD_NOT_COMPLETE }, { status: 500 })
  }

  // Best effort, exactly as the website's callback: the connection is real and stored. Verification is a
  // follow-up read that may fail or throw (and then writes nothing); the app is told "unknown", and the
  // creditor_updated webhook re-runs it.
  let verification: GoCardlessVerificationStatus = "unknown"
  try {
    verification = await syncGoCardlessVerificationStatus({ clubId: claim.club_id, environment, accessToken: token.access_token })
  } catch (cause) {
    console.error("[gocardless app connect] post-connect verification sync failed:", cause instanceof Error ? cause.message : cause)
  }

  await finish(true)
  return answer({ ok: true, verification })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HANDOFF = /^[A-Za-z0-9_-]{43}$/
const COULD_NOT_COMPLETE = "Could not complete the GoCardless connection. Please try connecting again."
/** The same sentence the website's callback uses for this refusal. */
const SWITCH_REFUSED =
  "This club still has live Direct Debits on its current GoCardless account, so it can't switch to a different one. Contact Ovalball support."

/**
 * Why there is no code to exchange, said to the person. `cancelled` is a choice they made -- closing the
 * browser, or declining on GoCardless's own page -- and is not reported as a fault. `awaiting_return` is not
 * an ending at all: GoCardless has sent its answer back, but this request did not carry the return handoff,
 * and nothing has changed -- the app can ask again with it, within GoCardless's five minutes.
 */
function unclaimed(outcome: string, reason: string | null): NextResponse {
  if (outcome === "awaiting_return") {
    return answer({ ok: false, outcome: "awaiting_return", message: "GoCardless has not handed this connection back to this phone yet." }, { status: 409 })
  }
  if (outcome === "not_returned" || reason === "provider_declined") {
    return answer({ ok: false, outcome: "cancelled", message: "GoCardless was not connected." }, { status: 409 })
  }
  if (outcome === "expired") {
    return answer({ ok: false, outcome: "failed", message: "The connection took too long to finish. Please try connecting again." }, { status: 409 })
  }
  if (outcome === "refused") {
    return answer({ ok: false, outcome: "failed", message: "This GoCardless connection was started by a different account." }, { status: 403 })
  }
  const sentence =
    reason === "handoff_mismatch"
      ? "This GoCardless connection could not be confirmed on this phone. Please try connecting again."
      : reason === "begin_expired"
        ? "The GoCardless link expired before it was opened. Please try connecting again."
        : reason === "claimed_by_another_account"
          ? "This GoCardless connection was stopped because a different account tried to finish it. Please try connecting again."
          : reason === "provider_error"
            ? "GoCardless could not complete the connection. Please try connecting again."
            : "This GoCardless connection has already ended. Please try connecting again."
  return answer({ ok: false, outcome: "failed", message: sentence }, { status: 409 })
}

/** The connect-intent functions are newer than the generated database types; same client, untyped view. */
function untyped(client: SupabaseClient<Database>): SupabaseClient {
  return client as unknown as SupabaseClient
}

async function readBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json()
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function answer(body: Record<string, unknown>, init: { status?: number } = {}): NextResponse {
  return NextResponse.json(body, { status: init.status ?? 200, headers: { "Cache-Control": "private, no-store" } })
}
