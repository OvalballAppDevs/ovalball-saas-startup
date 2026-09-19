import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { AUTHENTICATED_HOME, DEFAULT_NEXT_PATH, safeNextPath } from "@/lib/auth/safe-next"

/**
 * WHERE A SUCCESSFULLY AUTHENTICATED PERSON ENDS UP (Slice 6, §10A).
 *
 * A reported production defect: signing in could finish on the public marketing
 * homepage. The cause was one line -- `DEFAULT_NEXT_PATH = "/"` -- reached by
 * every path that had no destination to preserve. The reported symptom was
 * Google sign-in, because `/login` rendered its social buttons with no `next` at
 * all, so the OAuth start encoded that default into its own callback URL and the
 * callback delivered a freshly authenticated person to the front page.
 *
 * Two rules, and both matter:
 *
 *   NO VALID CONTINUATION  -> the authenticated Dashboard, never the homepage,
 *                             never an authentication surface, never a stale page.
 *   VALID CONTINUATION     -> that workflow, preserved.
 *
 * Refusing an attack has the same ending as having nothing to preserve: the
 * application. An open redirect that was correctly blocked and then dropped on
 * the marketing site reads to the person as a broken login rather than a safe
 * one.
 */

const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const NUL = String.fromCharCode(0)
const CR = String.fromCharCode(13)
const LF = String.fromCharCode(10)
const DEL = String.fromCharCode(127)

test("the default destination is the authenticated application, not the public homepage", () => {
  assert.equal(AUTHENTICATED_HOME, "/dashboard")
  assert.equal(DEFAULT_NEXT_PATH, AUTHENTICATED_HOME)
  assert.notEqual(DEFAULT_NEXT_PATH, "/", "this exact value was the production defect")
})

test("no continuation at all lands on the Dashboard", () => {
  for (const nothing of [null, undefined, "", "   "]) {
    assert.equal(
      safeNextPath(nothing as string | null),
      "/dashboard",
      `${JSON.stringify(nothing)} must fall back to the application`
    )
  }
})

test("an attempted open redirect is refused, and refusal lands on the Dashboard", () => {
  for (const attack of [
    "https://evil.example/steal",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "https://user@evil.example",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "http://localhost:3000@evil.example",
  ]) {
    assert.equal(safeNextPath(attack), "/dashboard", `"${attack}" must neither be followed nor end on the homepage`)
  }
})

test("a control character cannot smuggle a destination", () => {
  for (const attack of [`/dashboard${NUL}@evil.example`, `/club${CR}${LF}Location: https://evil.example`, `/${DEL}`]) {
    assert.equal(safeNextPath(attack), "/dashboard")
  }
})

test("a malformed value lands on the Dashboard rather than throwing", () => {
  for (const malformed of ["/%%%", "/%E0%A4%A", "/%"]) {
    assert.equal(safeNextPath(malformed), "/dashboard", `"${malformed}" must fail safely`)
  }
})

test("the homepage and the authentication surfaces are never a destination", () => {
  // Same-origin and perfectly well formed, which is exactly how somebody lands
  // back on /login after signing in, or on the page they started from.
  for (const stale of ["/", "/login", "/login?error=link", "/signup", "/auth/callback", "/logout"]) {
    assert.equal(safeNextPath(stale), "/dashboard", `"${stale}" is not somewhere to send a person who has just signed in`)
  }
})

test("a legitimate internal continuation is preserved exactly, query and all", () => {
  assert.equal(safeNextPath("/join?t=abc123"), "/join?t=abc123", "an invitation continuation must survive authentication")
  assert.equal(safeNextPath("/join?c=ABCDE-FGHIJ"), "/join?c=ABCDE-FGHIJ", "and so must a human-code one")
  assert.equal(safeNextPath("/claims/7"), "/claims/7")
  assert.equal(safeNextPath("/people?tab=invitations#waiting"), "/people?tab=invitations#waiting")
  assert.equal(safeNextPath("/teams/abc"), "/teams/abc")
})

test("every authentication surface takes its destination through the one guard", () => {
  const form = code("app/login/login-form.tsx")
  assert.match(
    form,
    /safeNextPath\(searchParams\.get\("next"\)\)/,
    "the password path read `next` straight off the query string and assigned it -- an open redirect beside a guard that already existed"
  )
  assert.doesNotMatch(form, /assign\([^)]*searchParams\.get\("next"\)\s*\?\?/, "an unvalidated fallback must not come back")
  assert.match(form, /next=\{safeNextPath\(/, "the social buttons had no `next` at all, which is how Google sign-in reached the homepage")

  assert.match(code("app/auth/callback/route.ts"), /safeNextPath\(searchParams\.get\("next"\)\)/)
  assert.match(code("app/auth/oauth-actions.ts"), /safeNextPath\(next\)/, "the provider round trip carries a validated destination or the default")
})

test("there is one destination decision, not one per surface", () => {
  // The whole defect was two copies of this decision drifting apart. Nothing
  // outside the guard may name the authenticated home as an auth destination.
  for (const file of ["app/login/login-form.tsx", "app/auth/callback/route.ts", "app/auth/oauth-actions.ts"]) {
    assert.doesNotMatch(
      code(file),
      /["'`]\/dashboard["'`]/,
      `${file} must take the destination from lib/auth/safe-next.ts rather than repeating it`
    )
  }
})
