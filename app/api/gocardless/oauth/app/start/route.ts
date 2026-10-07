import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js"
import { NextResponse, type NextRequest } from "next/server"

import { assertGoCardlessEnvironmentSafe, assertGoCardlessRedirectOriginSafe, getGoCardlessClientId } from "@/lib/payments/gocardless/env"
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/supabase/env"
import type { Database } from "@/types/database.types"

export const dynamic = "force-dynamic"

/**
 * THE APP STARTS A GOCARDLESS CONNECTION (20270750000000).
 *
 * The phone used to open the website's own start route in the system browser, which needs a WEBSITE
 * session the browser on a phone rarely has, and finished on the website's settings page, so nothing came
 * back to the app. Here the app asks with its own bearer token instead, and is given a one-time link to
 * open in an authentication session.
 *
 * AUTHORITY IS THE DATABASE'S. The client is built from the caller's own token, so
 * `start_gocardless_connect_intent` runs as them: it asks for a live session and for
 * `finance.gocardless.connect` at the club, refuses a club that has not agreed Ovalball's Club Memberships
 * terms and a return address outside the Ovalball app, and fixes the club on the intent there and then --
 * nothing later in the journey may name a different one.
 *
 * WHAT THE LINK IS. `begin?t=` carries a 256-bit token the database keeps only as a hash. It works once and
 * for three minutes. It is built on the origin GoCardless sends people back to, because the state cookie
 * the begin step sets has to reach that callback. The request's address is passed along and recorded for
 * diagnosis only: a link forwarded to somebody else -- the way a stranger's GoCardless account could be
 * attached to the sender's club -- is stopped at the other end, because only the device that finishes
 * GoCardless is handed the return handoff the app must present to claim the result.
 */
export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization")
  if (!authorization?.startsWith("Bearer ")) {
    return answer({ ok: false, message: "Sign in to connect GoCardless." }, { status: 401 })
  }

  // The CALLER'S token: every database call below is theirs, and can do no more than they can.
  const supabase = createSupabaseClient<Database>(getSupabaseUrl(), getSupabasePublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  })
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return answer({ ok: false, message: "Sign in to connect GoCardless." }, { status: 401 })

  const body = await readBody(request)
  const clubId = typeof body?.clubId === "string" ? body.clubId : ""
  const returnUrl = typeof body?.returnUrl === "string" ? body.returnUrl : ""
  if (!UUID.test(clubId) || !returnUrl || returnUrl.length > 512) {
    return answer({ ok: false, message: "That request could not be read." }, { status: 400 })
  }

  // Refused before an intent exists rather than after the person has been sent to a dead link: the
  // environment gate, the partner app's client id and the production-only HTTPS origin rule.
  let site: string
  try {
    assertGoCardlessEnvironmentSafe()
    getGoCardlessClientId()
    site = assertGoCardlessRedirectOriginSafe()
  } catch (cause) {
    console.error("[gocardless app connect] start unavailable:", cause instanceof Error ? cause.message : cause)
    return answer({ ok: false, message: "GoCardless cannot be reached from Ovalball right now. Please try again later." }, { status: 503 })
  }

  const { data, error } = await untyped(supabase)
    .rpc("start_gocardless_connect_intent", { p_club_id: clubId, p_return_url: returnUrl, p_requester_ip: requestIp(request) })
    .single<{ intent_id: string; begin_token: string }>()

  if (error) {
    // The RPC's own refusals for a dead session or a missing permission are sentences written for the
    // person (code === "42501"); the two 22023 refusals are told apart by their hint and answered with this
    // route's own sentences; everything else is logged and said plainly.
    if (error.code === "42501") return answer({ ok: false, message: error.message }, { status: 403 })
    if (error.code === "22023" && error.hint === "membership_terms") {
      return answer({ ok: false, reason: "membership_terms", message: TERMS_FIRST }, { status: 409 })
    }
    if (error.code === "22023") return answer({ ok: false, message: "That return address is not one the Ovalball app uses." }, { status: 400 })
    console.error("[gocardless app connect] start refused:", error.code)
    return answer({ ok: false, message: "Could not start the GoCardless connection. Please try again." }, { status: 500 })
  }
  if (!data?.intent_id || !data.begin_token) {
    return answer({ ok: false, message: "Could not start the GoCardless connection. Please try again." }, { status: 500 })
  }

  return answer({
    ok: true,
    intentId: data.intent_id,
    beginUrl: `${site}/api/gocardless/oauth/app/begin?t=${encodeURIComponent(data.begin_token)}`,
  })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** The same sentence the website's own start route uses (app/api/gocardless/oauth/start). */
const TERMS_FIRST = "Agree to Ovalball's terms for Club Memberships before connecting GoCardless."

/** The connect-intent functions are newer than the generated database types; same client, untyped view. */
function untyped(client: SupabaseClient<Database>): SupabaseClient {
  return client as unknown as SupabaseClient
}

/**
 * The caller's address: the first hop of x-forwarded-for, else x-real-ip. Passed as given; the database
 * (`internal.gocardless_connect_ip`) is the one place that normalises and compares addresses, the begin
 * route reads the same two headers the same way, and the comparison is a diagnostic, never a refusal.
 */
function requestIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  const real = request.headers.get("x-real-ip")?.trim()
  const ip = forwarded || real
  return ip ? ip.slice(0, 100) : null
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
