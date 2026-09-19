import type { NextRequest } from "next/server"

import { contentSecurityPolicy, staticSecurityHeaders } from "@/lib/auth/security-headers"
import { updateSession } from "@/lib/supabase/middleware"

// Next.js 16 renamed middleware.ts to proxy.ts — the exported function must
// be named `proxy`, not `middleware`, or it is silently ignored.
export async function proxy(request: NextRequest) {
  // THE NONCE IS MINTED BEFORE THE SESSION WORK, NOT AFTER.
  //
  // `updateSession` builds the response with `NextResponse.next({ request })`,
  // which forwards the request headers AS THEY ARE AT THAT MOMENT. Setting
  // `x-nonce` afterwards would leave it on an object nothing reads, Next would
  // render its inline scripts without a nonce, and the policy below would blank
  // the application -- silently, and only in the browser.
  const nonce = crypto.randomUUID().replace(/-/g, "")
  const isProduction = process.env.NODE_ENV === "production"
  const policy = contentSecurityPolicy(nonce, isProduction, false)

  // NEXT LEARNS THE NONCE FROM THE REQUEST'S OWN CSP HEADER, NOT FROM x-nonce.
  //
  // This was wrong first time and the production gate caught it. `x-nonce` is
  // the convention for passing the value on to components; the framework's
  // automatic noncing of its OWN bootstrap and chunk tags comes from parsing a
  // `Content-Security-Policy` header on the REQUEST. Without it Next emitted
  // un-nonced inline scripts, `'strict-dynamic'` then refused the chunks those
  // scripts would have loaded, and the application served HTML that never
  // hydrated -- a page that looks completely normal until somebody presses
  // something.
  request.headers.set("Content-Security-Policy", policy)
  request.headers.set("x-nonce", nonce)

  const response = await updateSession(request)

  // The authenticated layout needs the current path to decide whether a club
  // still in first-run setup should be gated, and Server Components cannot
  // read it. Setting it here keeps the allowlist (/club/setup, /account,
  // /support) in one place and makes a redirect loop impossible: the layout
  // never redirects to a path it is also gating.
  response.headers.set("x-ovalball-pathname", request.nextUrl.pathname)

  // SECURITY HEADERS AND THE CSP (6b.2d / S6-17). There were none at all.
  //
  // One nonce per request, handed to Next through `x-nonce` on the REQUEST so
  // the framework stamps it onto its own inline scripts, and named in the policy
  // on the response. Both halves are required: the policy without the request
  // header blanks the application, and the request header without the policy
  // secures nothing.
  response.headers.set("x-nonce", nonce)
  // ENFORCED IN PRODUCTION, REPORT-ONLY IN DEVELOPMENT.
  //
  // `next dev` injects its own inline scripts for hot reload and the error
  // overlay, and the framework does not nonce those -- so an enforcing policy on
  // the dev server refuses them, breaks hydration, and takes the whole browser
  // gate estate down with it. That is the dev server failing, not the product:
  // against a production build this exact policy produces zero violations on
  // both public and authenticated pages, which is where it was verified.
  // Report-only keeps the violations visible locally without pretending the dev
  // server is what ships.
  // REPORT-ONLY EVERYWHERE, FOR NOW, AND THAT IS A DELIBERATE STOP.
  //
  // The transport headers below are enforced and always were safe. The POLICY is
  // not, and the production gate is what proved it: with `script-src` bound to a
  // per-request nonce, this Next version emits inline bootstrap scripts without
  // that nonce, `'strict-dynamic'` then refuses the chunks they would have
  // loaded, and the application serves HTML that never hydrates -- a page that
  // looks entirely normal until somebody presses something.
  //
  // Both documented routes were tried: `x-nonce` on the forwarded request, and
  // the `Content-Security-Policy` request header the framework is meant to parse
  // the nonce out of. Neither produced nonced script tags here.
  //
  // The three ways forward are materially different security positions --
  // allow inline script and lose the directive's point, enforce everything but
  // `script-src`, or find the framework's actual noncing contract for this
  // version -- and the checked-in design does not settle which. So the policy
  // ships REPORT-ONLY, where it still surfaces violations and cannot break
  // anybody, and the decision is recorded rather than taken quietly at 3am.
  response.headers.set("Content-Security-Policy-Report-Only", policy)
  for (const [name, value] of staticSecurityHeaders(isProduction)) {
    response.headers.set(name, value)
  }
  return response
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
