/**
 * CONVERGENCE STEP 19 — where an accepted invitation leaves somebody.
 *
 * These assertions exist because of a specific defect, and each one is the shape of that defect rather
 * than a restatement of the code. Step 16 taught `redeem_invitation` to answer `BODY_ROLE_ACTIVE`;
 * `SUCCESSFUL_REDEMPTION_OUTCOMES` never learned the name, so the chokepoint's fail-closed allowlist
 * treated a completed redemption as unrecognised and the page told the person their invitation could not
 * be used while the database held the granted role. Nothing failed. Two suites passed.
 *
 * The lesson is that an outcome and its landing have to be impossible to add separately, so test 1 is
 * the real guard and the rest describe the product's promises.
 */
import assert from "node:assert/strict"
import { test } from "node:test"

import { entranceLanding } from "@/lib/invitations/entrance-landing"
import { SUCCESSFUL_REDEMPTION_OUTCOMES } from "@/lib/invitations/redeem"

const BODY = "7d01b631-86fb-4c44-9708-e22b83daf744"

/** Outcomes that established a REQUEST rather than access. */
const REQUESTS = ["JOIN_REQUEST_PENDING", "PENDING_CONFIRMATION"] as const

test("1. every successful outcome has a landing -- none falls through to a generic dashboard", () => {
  for (const outcome of SUCCESSFUL_REDEMPTION_OUTCOMES) {
    const landing = entranceLanding(outcome, {})
    assert.ok(landing, `${outcome} has no landing`)
    assert.ok(
      typeof landing.href === "string" && landing.href.startsWith("/"),
      `${outcome} lands somewhere that is not an in-application path: ${landing.href}`,
    )
  }
})

test("2. BODY_ROLE_ACTIVE is one of them -- the outcome the allowlist used to drop", () => {
  assert.ok(
    (SUCCESSFUL_REDEMPTION_OUTCOMES as readonly string[]).includes("BODY_ROLE_ACTIVE"),
    "a granted governing-body role is a SUCCESS, and the allowlist must say so or the page reports a refusal",
  )
})

test("3. a new governing officer lands in the organisation they just joined", () => {
  const landing = entranceLanding("BODY_ROLE_ACTIVE", { constituent_body_id: BODY })
  assert.equal(landing.href, `/governing/${BODY}`)
})

test("4. and the context is ADOPTED, not merely navigated to", () => {
  // Navigating alone leaves the club's navigation wrapped around a county page, because the active
  // context resolves from the cookie and not from the URL.
  const landing = entranceLanding("BODY_ROLE_ACTIVE", { constituent_body_id: BODY })
  assert.equal(landing.contextKey, `governing:${BODY}`)
})

test("5. a governing outcome with no organisation in it fails safe rather than building a broken URL", () => {
  const landing = entranceLanding("BODY_ROLE_ACTIVE", {})
  assert.equal(landing.href, "/dashboard")
  assert.equal(landing.contextKey, null)
  assert.ok(!landing.href.includes("undefined") && !landing.href.includes("null"))
})

test("6. a request never lands inside the application as though it were access", () => {
  for (const outcome of REQUESTS) {
    const landing = entranceLanding(outcome, {})
    assert.equal(
      landing.href,
      "/welcome",
      `${outcome} redirected into the application, which reads as "you are in" -- UX-8 §16`,
    )
    assert.equal(landing.contextKey, null, `${outcome} must not adopt a context it has not been given`)
  }
})

test("7. and it says so in words, because a silent redirect reads as success", () => {
  for (const outcome of REQUESTS) {
    const { note } = entranceLanding(outcome, {})
    assert.ok(note && note.length > 0, `${outcome} lands silently`)
    // The product's own vocabulary, not the database's -- UX-8 §30.
    assert.ok(
      !/redeem|token|membership row|principal|transition/i.test(note),
      `${outcome} explains itself in database words: ${note}`,
    )
  }
})

test("8. following a spent link twice is not an error", () => {
  const landing = entranceLanding("ALREADY_REDEEMED", {})
  assert.ok(landing.note && /already/i.test(landing.note))
  assert.ok(landing.href.startsWith("/"))
})

test("9. no landing sends anybody off Ovalball, whatever the redemption returned", () => {
  // The detail object comes from the database, but a future column could carry anything, and an
  // entrance is the last place to build a URL out of unvalidated input.
  const hostile = {
    constituent_body_id: "https://evil.example/x",
  }
  for (const outcome of SUCCESSFUL_REDEMPTION_OUTCOMES) {
    const { href } = entranceLanding(outcome, hostile)
    assert.ok(href.startsWith("/"), `${outcome} produced ${href}`)
    assert.ok(!href.startsWith("//"), `${outcome} produced a protocol-relative URL: ${href}`)
    assert.ok(!/^\/\\|^\/[a-z]+:/i.test(href), `${outcome} produced something scheme-shaped: ${href}`)
  }
})

test("10. Site Admin acceptance lands in Site Admin, in its own context", () => {
  const landing = entranceLanding("SITE_ADMIN_ACTIVE", {})
  assert.equal(landing.href, "/admin")
  assert.equal(landing.contextKey, "site_admin")
})
