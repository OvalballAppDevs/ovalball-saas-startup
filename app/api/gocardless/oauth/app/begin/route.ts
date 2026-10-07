import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import { NextResponse, type NextRequest } from "next/server"

import { buildGoCardlessAuthorizeUrl } from "@/lib/payments/gocardless/oauth"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

export const dynamic = "force-dynamic"

const APP_STATE_COOKIE = "gc_oauth_app_state"

/**
 * THE APP'S LINK, OPENED IN THE PHONE'S BROWSER (20270750000000).
 *
 * This request carries NO Ovalball session -- it comes from an authentication session in the system
 * browser, which shares nothing with the app -- so it is authorised by the begin token alone, and the
 * database decides whether that token is good: unused and under three minutes old
 * (`consume_gocardless_connect_begin`). The token is spent by the first presentation whatever the answer.
 *
 * THE ADDRESS IS RECORDED, NEVER REFUSED. The authentication session is Safari, and iCloud Private Relay
 * relays Safari's traffic but not the app's own, so this request routinely arrives from a different address
 * than the app's start did; an IPv4/IPv6 split does the same. Whether the two matched is kept as a
 * diagnostic. What stops a forwarded link is the return handoff (callback route): only the device whose
 * browser finishes GoCardless is handed it, and the app cannot claim without it.
 *
 * What it hands out is narrow. The browser receives the intent's STATE in an httpOnly cookie scoped to the
 * OAuth routes, and is sent to GoCardless with the same state. Nothing here names a club, a person or a
 * token, and the club the connection will belong to was fixed when the intent was created.
 *
 * Every refusal is a small plain page rather than a redirect: there is nothing a person in that browser
 * can do except go back to the app and start again, and a page that says so leaks nothing.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t") ?? ""
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return page(400, LINK_SPENT)

  const service = untyped(createServiceRoleClient())
  const { data, error } = await service
    .rpc("consume_gocardless_connect_begin", { p_token: token, p_requester_ip: requestIp(request) })
    .maybeSingle<{ outcome: string; state: string | null; club_id: string | null }>()

  if (error) {
    console.error("[gocardless app connect] begin failed:", error.code)
    return page(500, UNAVAILABLE)
  }
  if (!data || data.outcome !== "ok" || !data.state || !data.club_id) return page(400, LINK_SPENT)

  let authorizeUrl: string
  try {
    authorizeUrl = buildGoCardlessAuthorizeUrl({ state: data.state, clubId: data.club_id }).url
  } catch (cause) {
    console.error("[gocardless app connect] authorize URL unavailable:", cause instanceof Error ? cause.message : cause)
    // The token is spent; close the intent too, so the app is told it ended rather than left waiting.
    await service.rpc("fail_gocardless_connect_intent", { p_state: data.state, p_reason: "environment_unavailable" })
    return page(503, UNAVAILABLE)
  }

  const response = NextResponse.redirect(authorizeUrl)
  response.cookies.set(APP_STATE_COOKIE, data.state, {
    httpOnly: true,
    // A phone on the developer's network reaches the website over plain http; a Secure cookie would be
    // dropped there and the callback could never match it. Everywhere real, the request is https.
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    maxAge: 600,
    path: "/api/gocardless/oauth",
  })
  response.headers.set("Cache-Control", "no-store")
  // The token is in this URL; nothing downstream needs to be told where the browser came from.
  response.headers.set("Referrer-Policy", "no-referrer")
  return response
}

const LINK_SPENT = "This link to connect GoCardless has expired or has already been used. Go back to the Ovalball app and start again."
const UNAVAILABLE = "GoCardless cannot be reached from Ovalball right now. Go back to the Ovalball app and try again later."

/** The connect-intent functions are newer than the generated database types; same client, untyped view. */
function untyped(client: ReturnType<typeof createServiceRoleClient>): SupabaseClient {
  return client as unknown as SupabaseClient
}

/**
 * The browser's address: the first hop of x-forwarded-for, else x-real-ip -- read exactly as the start
 * route reads the app's. The database normalises both and records whether they matched; it refuses nothing.
 */
function requestIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  const real = request.headers.get("x-real-ip")?.trim()
  const ip = forwarded || real
  return ip ? ip.slice(0, 100) : null
}

/**
 * Ovalball's look, inline and fixed: the system's own typeface (nothing is fetched), the chalk canvas, a forest
 * heading and ink text (app/globals.css: --chalk, --forest-800, --ink), sized to read on a phone.
 */
const PAGE_STYLE =
  ":root{color-scheme:light}" +
  "body{margin:0;background:#f8faf7;color:#101512;" +
  "font:400 1rem/1.55 system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,\"Helvetica Neue\",Arial,sans-serif;" +
  "-webkit-text-size-adjust:100%;text-size-adjust:100%}" +
  "main{box-sizing:border-box;max-width:34rem;margin:0 auto;padding:clamp(2.5rem,12vh,6rem) 1.25rem 3rem}" +
  "h1{margin:0 0 .75rem;color:#123d2c;font-size:1.5rem;line-height:1.25;font-weight:600;letter-spacing:-.01em}" +
  "p{margin:0;font-size:1.0625rem}"

/** The policy still allows nothing but that one style block, named by its own hash: no script, image, font or request. */
const PAGE_POLICY = `default-src 'none'; style-src 'sha256-${createHash("sha256").update(PAGE_STYLE).digest("base64")}'`

/** A fixed sentence on a page with nothing else on it: no script, no link, no request detail. */
function page(status: number, sentence: string): NextResponse {
  const html =
    `<!doctype html><html lang="en-GB"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">` +
    `<title>Connect GoCardless</title><style>${PAGE_STYLE}</style></head>` +
    `<body><main><h1>Connect GoCardless</h1><p>${sentence}</p></main></body></html>`
  return new NextResponse(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": PAGE_POLICY,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
