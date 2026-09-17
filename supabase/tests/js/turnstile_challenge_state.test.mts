import { test } from "node:test"
import assert from "node:assert/strict"

import {
  challengeIdle,
  challengeVerified,
  challengeSpent,
  canSubmitProtected,
  tokenForSubmission,
} from "@/lib/auth/challenge-state"

/**
 * THE TURNSTILE CHALLENGE STATE MACHINE (Slice 6b hotfix).
 *
 * This suite exists because of a production incident: the established Full Site Admin could not sign
 * in, and the login page answered every attempt with "We couldn't complete the security check."
 *
 * The cause was not Turnstile, not the password and not Supabase -- the request never reached
 * Supabase at all. The login form held TWO pieces of state for one fact:
 *
 *     humanToken   the single-use token Cloudflare issued
 *     humanPassed  whether the visitor had cleared the challenge
 *
 * and the password failure branch cleared only the first:
 *
 *     if (securityCheckActive) setHumanToken(null)     // token gone
 *                                                       // humanPassed still true
 *
 * The submit button is gated on humanPassed alone, so it stayed enabled, and every retry posted
 * `null` as the token. The server verified fail-closed, correctly, and returned the one generic
 * message it has. The visitor was locked out of their own account by a boolean that outlived the
 * token it described.
 *
 * The invariant these tests hold still is the one the incident violated:
 *
 *     NO VALID TOKEN  =>  NOT SUBMITTABLE
 *
 * A boolean may never authorise a protected request once the token it stood for has been spent.
 *
 * Deterministic and pure: no browser, no network, no Cloudflare. Whether the real widget issues a
 * token is a different question, tested elsewhere; this is about what the page is allowed to do with
 * the answer.
 */

const REQUIRED = true // Turnstile configured (production)
const NOT_REQUIRED = false // Turnstile not configured (local dev): fail-open by design

// ---------------------------------------------------------------------------
// A. a successful challenge
// ---------------------------------------------------------------------------

test("A1 a fresh page with the challenge required cannot submit", () => {
  const s = challengeIdle(REQUIRED)
  assert.equal(s.passed, false)
  assert.equal(s.token, null)
  assert.equal(canSubmitProtected(s, REQUIRED), false)
})

test("A2 a verified challenge yields both the token and the passed flag", () => {
  const s = challengeVerified("token-1")
  assert.equal(s.token, "token-1")
  assert.equal(s.passed, true)
  assert.equal(canSubmitProtected(s, REQUIRED), true)
  assert.equal(tokenForSubmission(s, REQUIRED), "token-1")
})

// ---------------------------------------------------------------------------
// B + C. spending the challenge invalidates BOTH halves
// ---------------------------------------------------------------------------

test("B1 spending a challenge clears the token", () => {
  assert.equal(challengeSpent(REQUIRED).token, null)
})

test("C1 THE INCIDENT: spending a challenge must also clear `passed`", () => {
  const spent = challengeSpent(REQUIRED)
  assert.equal(
    spent.passed,
    false,
    "a token was consumed while `passed` stayed true -- this is exactly the production lockout",
  )
})

test("C2 and a spent challenge cannot authorise another protected request", () => {
  assert.equal(canSubmitProtected(challengeSpent(REQUIRED), REQUIRED), false)
})

// ---------------------------------------------------------------------------
// D. retry stays blocked until a genuinely fresh challenge
// ---------------------------------------------------------------------------

test("D1 retry is blocked after a failure, and only a FRESH challenge unblocks it", () => {
  let s = challengeVerified("token-1")
  assert.equal(canSubmitProtected(s, REQUIRED), true)

  s = challengeSpent(REQUIRED) // the attempt failed
  assert.equal(canSubmitProtected(s, REQUIRED), false, "the page let a second attempt through")

  s = challengeVerified("token-2") // Cloudflare issued a new one
  assert.equal(canSubmitProtected(s, REQUIRED), true)
  assert.equal(tokenForSubmission(s, REQUIRED), "token-2")
})

// ---------------------------------------------------------------------------
// E + F. the consumed token is never reused
// ---------------------------------------------------------------------------

test("E1 the token sent on the second attempt is the new one, never the old", () => {
  const first = challengeVerified("token-1")
  const spent = challengeSpent(REQUIRED)
  const second = challengeVerified("token-2")
  assert.equal(tokenForSubmission(first, REQUIRED), "token-1")
  assert.equal(tokenForSubmission(spent, REQUIRED), null)
  assert.equal(tokenForSubmission(second, REQUIRED), "token-2")
  assert.notEqual(tokenForSubmission(second, REQUIRED), tokenForSubmission(first, REQUIRED))
})

test("F1 a spent challenge offers no token to submit -- there is nothing to replay", () => {
  assert.equal(tokenForSubmission(challengeSpent(REQUIRED), REQUIRED), null)
})

test("F2 `passed` alone can never stand in for a token", () => {
  // The precise shape of the bug: the flag says yes, the token is gone.
  const forged = { token: null, passed: true }
  assert.equal(
    canSubmitProtected(forged, REQUIRED),
    false,
    "a boolean authorised a protected request with no token behind it",
  )
})

// ---------------------------------------------------------------------------
// Every login method shares this machine. Each sequence is the incident.
// ---------------------------------------------------------------------------

for (const method of ["email+password", "google oauth", "magic link"] as const) {
  test(`G ${method}: verify → attempt fails → retry blocked → fresh challenge → allowed`, () => {
    let s = challengeVerified(`${method}-token-1`)
    assert.equal(canSubmitProtected(s, REQUIRED), true, "first attempt should be allowed")

    s = challengeSpent(REQUIRED)
    assert.equal(canSubmitProtected(s, REQUIRED), false, `${method} allowed a retry on a spent challenge`)
    assert.equal(tokenForSubmission(s, REQUIRED), null)

    s = challengeVerified(`${method}-token-2`)
    assert.equal(canSubmitProtected(s, REQUIRED), true)
    assert.equal(tokenForSubmission(s, REQUIRED), `${method}-token-2`)
  })
}

// ---------------------------------------------------------------------------
// The unconfigured case must keep working, or local development stops.
// ---------------------------------------------------------------------------

test("H1 with no challenge configured the page submits freely (fail-open by design, local only)", () => {
  const s = challengeIdle(NOT_REQUIRED)
  assert.equal(s.passed, true)
  assert.equal(canSubmitProtected(s, NOT_REQUIRED), true)
  assert.equal(tokenForSubmission(s, NOT_REQUIRED), null)
})

test("H2 and spending it there does not lock the page", () => {
  assert.equal(canSubmitProtected(challengeSpent(NOT_REQUIRED), NOT_REQUIRED), true)
})

test("H3 but the server, not this flag, is what actually enforces it", () => {
  // Client state cannot grant anything: lib/auth/turnstile.ts verifies every token server-side and
  // fails closed once configured. This assertion is a signpost, not a substitute for that.
  assert.equal(canSubmitProtected({ token: null, passed: true }, REQUIRED), false)
})

// ---------------------------------------------------------------------------
// SLICE 6b.2 / SO-7 -- THE SAME DEFECT, ON THE SURFACES THE HOTFIX DID NOT REACH.
//
// The hotfix was deliberately scoped to /login. Two other public authentication surfaces carried the
// identical shape and were left for this unit: the signup wizard kept two useStates for one fact and
// cleared neither when a submission failed, and the signup account step handed the provider buttons a
// hardcoded `turnstileToken={null}` while leaving them enabled.
//
// These are SOURCE-SHAPE invariants, which is what a structural guard is for: they prove the defect
// cannot be reintroduced by a future edit. They are NOT a substitute for proving enforcement runs --
// that is what scripts/browser-verification/65-signup-challenge-lifecycle.mjs does against a real
// server and a real Cloudflare round-trip.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Comments are prose, not code. The first draft of this guard failed on the very comment explaining
 * the defect it guards against, which would have taught the next author to describe it vaguely --
 * exactly the wrong lesson. Strip comments, then look at what actually executes.
 */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, acc)
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full)
  }
  return acc
}

const SOURCES = [...sourceFiles("app"), ...sourceFiles("components")]

test("SO-7 no surface hands the provider buttons a hardcoded null challenge token", () => {
  const offenders = SOURCES.filter((f) => /turnstileToken=\{null\}/.test(code(f)))
  assert.deepEqual(
    offenders,
    [],
    "A literal turnstileToken={null} means the button renders enabled and the server refuses every " +
      "click. Pass the live challenge token, or challengeRequired={false} on a surface that genuinely " +
      "has no challenge.",
  )
})

test("SO-7 every SocialAuthButtons caller that requires a challenge also reports the spend", () => {
  const problems: string[] = []
  for (const f of SOURCES) {
    const src = code(f)
    if (!/<SocialAuthButtons/.test(src)) continue
    for (const m of src.match(/<SocialAuthButtons[\s\S]*?\/>/g) ?? []) {
      if (/challengeRequired/.test(m) && !/onChallengeSpent/.test(m)) {
        problems.push(`${f}: gates on a challenge but never reports it spent`)
      }
    }
  }
  assert.deepEqual(problems, [])
})

test("SO-7 the signup wizard holds ONE fact, from the shared module, not a private pair", () => {
  const shell = code("app/signup/signup-shell.tsx")
  assert.match(shell, /from "@\/lib\/auth\/challenge-state"/, "must use the one shared rule")
  assert.doesNotMatch(
    shell,
    /useState<string \| null>\(null\)[\s\S]{0,200}useState\(!humanCheckRequired\)/,
    "the token and the permission to submit are one fact and must not be two useStates again",
  )
  assert.match(shell, /spendChallenge\(\)/, "an attempt must spend the challenge")
})

test("SO-7 the signup submission spends the challenge before branching on the result", () => {
  const shell = code("app/signup/signup-shell.tsx")
  const spend = shell.indexOf("spendChallenge()\n\n    if (result.ok)")
  assert.notEqual(spend, -1, "spendChallenge must run unconditionally, not only on the success branch")
})
