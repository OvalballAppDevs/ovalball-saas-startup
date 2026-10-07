import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { NextResponse, type NextRequest } from "next/server"

import { isRecentAuthRefusal, RECENT_AUTH_SENTENCE } from "@ovalball/contracts/club/permissions"
import { drainGoCardlessTokenRevocations } from "@/lib/payments/gocardless/token-revocation"
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/supabase/env"
import type { Database } from "@/types/database.types"

export const dynamic = "force-dynamic"

/**
 * THE APP DISCONNECTS GOCARDLESS, AND THE TOKEN IS REVOKED (20270750000000).
 *
 * `disconnect_gocardless` takes the club's token out of its connection and queues it for revocation in
 * the same transaction (20270744000000); revoking it at GoCardless is a server job, because it needs the
 * partner app's secret. The website's disconnect does both. The app called only the RPC, so a disconnect
 * made on a phone left a permanent token, able to act on the club's whole GoCardless account, waiting in
 * the queue for whenever a website disconnect or a replay run next happened. This route is the app's
 * disconnect: the RPC as the CALLER, from their own bearer token -- so it is their
 * `finance.gocardless.connect` the database asks about -- and then the same drain the website runs.
 *
 * A failed revocation never undoes the disconnect and is not the person's problem to solve: the token
 * stays queued with its reason for the next run, exactly as on the website.
 */
export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization")
  if (!authorization?.startsWith("Bearer ")) {
    return answer({ ok: false, message: "Sign in to disconnect GoCardless." }, { status: 401 })
  }

  // The CALLER'S token: the disconnect below is theirs, judged by the database as theirs.
  const supabase = createSupabaseClient<Database>(getSupabaseUrl(), getSupabasePublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  })
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return answer({ ok: false, message: "Sign in to disconnect GoCardless." }, { status: 401 })

  const body = await readBody(request)
  const clubId = typeof body?.clubId === "string" ? body.clubId : ""
  const reason = typeof body?.reason === "string" ? body.reason.trim() : ""
  if (!UUID.test(clubId)) return answer({ ok: false, message: "That request could not be read." }, { status: 400 })
  if (!reason) return answer({ ok: false, message: "Give a reason for disconnecting GoCardless." }, { status: 400 })
  if (reason.length > 500) return answer({ ok: false, message: "Keep the reason to 500 characters or fewer." }, { status: 400 })

  const { error } = await supabase.rpc("disconnect_gocardless", { p_club_id: clubId, p_reason: reason })
  if (error) {
    // A refusal keeps its code, so the app can tell "confirm it is you" (a recent authenticator) from
    // "not yours to do" -- the same distinction the website's reason sheet draws.
    if (error.code === "42501") {
      const message = isRecentAuthRefusal(error) ? RECENT_AUTH_SENTENCE : "You are not authorised to disconnect GoCardless for this club."
      return answer({ ok: false, code: "42501", message }, { status: 403 })
    }
    console.error("[gocardless app disconnect] disconnect_gocardless refused:", error.code)
    // With a reason already required above, the one remaining refusal the function raises on its own
    // (P0001) is that there is no live connection to disconnect.
    if (error.code === "P0001") return answer({ ok: false, message: "This club has no GoCardless connection to disconnect." }, { status: 409 })
    return answer({ ok: false, message: "Could not disconnect GoCardless. Please try again." }, { status: 500 })
  }

  // The token left the connection in that transaction and waits to be revoked; revoke it now. A failure
  // leaves it queued for the replay job, and never undoes the disconnect.
  await drainGoCardlessTokenRevocations().catch(() => undefined)

  return answer({ ok: true })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
