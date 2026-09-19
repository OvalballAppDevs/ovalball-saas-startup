import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { contentSecurityPolicy, staticSecurityHeaders } from "@/lib/auth/security-headers"

/**
 * SECURITY HEADERS AND THE CONTENT SECURITY POLICY (Slice 6b.2d, S6-17).
 *
 * The 6b.2 requirement matrix recorded this as **none present at all** -- no
 * `next.config` headers, no CSP anywhere. The risk it also recorded is the one
 * these assertions exist to hold: "a wrong CSP breaks the product silently".
 *
 * So the rules pinned here are the two ways this goes wrong. It must not be
 * weakened into decoration -- `'unsafe-inline'` in `script-src`, a wildcard
 * origin, a missing `object-src` -- and it must not name an origin Ovalball does
 * not use, because an unused allowance is an allowance somebody else can grow
 * into.
 */

const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
const NONCE = "abc123abc123abc123abc123abc12345"
const directive = (policy: string, name: string) =>
  policy.split("; ").find((d) => d === name || d.startsWith(`${name} `)) ?? ""

test("script execution is nonce-bound, never open to inline script", () => {
  const policy = contentSecurityPolicy(NONCE)
  const scriptSrc = directive(policy, "script-src")
  assert.match(scriptSrc, new RegExp(`'nonce-${NONCE}'`), "Next's own inline scripts are allowed by nonce, not by blanket permission")
  assert.doesNotMatch(scriptSrc, /'unsafe-inline'/, "allowing all inline script would make this directive decorative")
  assert.doesNotMatch(scriptSrc, /'unsafe-eval'/)
  assert.match(scriptSrc, /'strict-dynamic'/, "so the chunks Next loads do not each have to be listed")
})

test("inline style is allowed, deliberately and only for style", () => {
  const policy = contentSecurityPolicy(NONCE)
  // Tailwind and Next emit inline style attributes during hydration and there is
  // no nonce path for the attribute form. Inline CSS is not script execution.
  assert.match(directive(policy, "style-src"), /'unsafe-inline'/)
  assert.doesNotMatch(directive(policy, "script-src"), /'unsafe-inline'/)
})

test("the policy has a floor, and the dangerous sinks are shut", () => {
  const policy = contentSecurityPolicy(NONCE)
  assert.match(directive(policy, "default-src"), /'self'/, "anything not named falls back to same-origin, never to open")
  assert.equal(directive(policy, "object-src"), "object-src 'none'", "plugins are the classic bypass")
  assert.equal(directive(policy, "frame-ancestors"), "frame-ancestors 'none'", "Ovalball is never framed")
  assert.equal(directive(policy, "base-uri"), "base-uri 'self'", "a rewritten <base> turns every relative script into an attacker's")
  assert.equal(directive(policy, "form-action"), "form-action 'self'", "the other half of the open-redirect story")
})

test("no wildcard, and no plain-http origin in production", () => {
  const policy = contentSecurityPolicy(NONCE)
  assert.doesNotMatch(policy, /\*/, "a wildcard would make the whole policy advisory")
  // data: and blob: are images and workers only -- never a script source.
  assert.doesNotMatch(directive(policy, "script-src"), /data:|blob:/)

  // The local stack IS http -- NEXT_PUBLIC_SUPABASE_URL is http://127.0.0.1 in
  // development -- so the policy names it there, correctly, and an earlier
  // version of this assertion failed the moment the runner loaded the real
  // environment. What must hold is that production never names one, and
  // `upgrade-insecure-requests` is there to catch anything that slips through.
  const shipped = contentSecurityPolicy(NONCE, true, true)
  const httpOrigins = (shipped.match(/http:\/\/[a-z0-9.:-]+/g) ?? []).filter((o) => !o.startsWith("http://127.") && !o.startsWith("http://localhost"))
  assert.deepEqual(httpOrigins, [], "a production policy must name no plain-http origin")
  assert.match(shipped, /upgrade-insecure-requests/)
})

test("only origins Ovalball actually uses are named", () => {
  const policy = contentSecurityPolicy(NONCE)
  const origins = policy.match(/https:\/\/[a-z0-9.-]+/g) ?? []
  const allowed = new Set(["https://challenges.cloudflare.com"])
  for (const origin of origins) {
    assert.ok(allowed.has(origin), `${origin} is allowed by the policy but is not an origin this product loads`)
  }
  // Turnstile loads a script AND renders in an iframe, so it needs both.
  assert.match(directive(policy, "script-src"), /challenges\.cloudflare\.com/)
  assert.match(directive(policy, "frame-src"), /challenges\.cloudflare\.com/)
})

test("upgrade-insecure-requests and HSTS are production only", () => {
  // On a local http origin either of these takes the developer's stack away:
  // one upgrades the Supabase calls to https, the other pins localhost in the
  // browser long after the experiment is over.
  assert.doesNotMatch(contentSecurityPolicy(NONCE, false, true), /upgrade-insecure-requests/)
  assert.match(contentSecurityPolicy(NONCE, true, true), /upgrade-insecure-requests/)
  // And never in a report-only policy, which cannot upgrade anything and makes
  // the browser say so on every page load.
  assert.doesNotMatch(contentSecurityPolicy(NONCE, true, false), /upgrade-insecure-requests/)
  const names = (production: boolean) => staticSecurityHeaders(production).map(([n]) => n)
  assert.ok(!names(false).includes("Strict-Transport-Security"))
  assert.ok(names(true).includes("Strict-Transport-Security"))
})

test("the headers that are always safe are always sent", () => {
  const headers = new Map(staticSecurityHeaders(false))
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff")
  assert.equal(headers.get("X-Frame-Options"), "DENY")
  assert.equal(headers.get("Referrer-Policy"), "strict-origin-when-cross-origin")
  assert.equal(headers.get("Cross-Origin-Opener-Policy"), "same-origin")
  assert.match(headers.get("Permissions-Policy") ?? "", /camera=\(\)/)
})

test("the nonce reaches Next before the response is built, not after", () => {
  // `NextResponse.next({ request })` forwards the request headers as they are at
  // that moment. Setting x-nonce afterwards leaves it on an object nothing
  // reads, Next renders its scripts unnonced, and the policy blanks the
  // application -- silently, and only in a browser.
  const proxy = code("proxy.ts")
  const nonceLine = proxy.indexOf('request.headers.set("x-nonce"')
  const sessionLine = proxy.indexOf("await updateSession(request)")
  assert.ok(nonceLine > 0 && sessionLine > 0, "the proxy must both mint a nonce and run the session update")
  assert.ok(nonceLine < sessionLine, "the nonce must be set on the request BEFORE the response is built from it")
  assert.match(proxy, /Content-Security-Policy/, "and the policy must actually be sent")
})
