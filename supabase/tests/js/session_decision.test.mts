import { test } from "node:test"
import assert from "node:assert/strict"

import { decideSession, type SessionAssurance } from "@/lib/auth/session-decision"

/**
 * THE SESSION DECISION TABLE (Slice 6b.2a, Phase 2 D.2 layer 2).
 *
 * This suite exists because a mutation campaign found a hole. `allowAalElevation` stands the
 * assurance gate down, and it is correct on exactly two surfaces -- /security/enrol and
 * /security/verify -- because enforcing it there would refuse people at the only page that could
 * fix their problem. A structural guard already asserts no other FILE passes the option. It did not
 * notice when the option was made globally true inside the decision itself, because "who may pass
 * it" and "is it honoured" are different questions. This answers the second one.
 *
 * Everything here is pure: the database answer goes in, a decision comes out, no IO.
 */

const LIVE_ACTIVE: SessionAssurance = {
  account_usable: true,
  session_live: true,
  aal: "aal1",
  enforcement_required: false,
  recent_aal2: false,
  enforcement_group: "NONE",
}

const at = (over: Partial<SessionAssurance>): SessionAssurance => ({ ...LIVE_ACTIVE, ...over })

// ---------------------------------------------------------------------------
// T0. The property the whole slice rests on.
// ---------------------------------------------------------------------------

test("D1 T0: a live AAL1 session on an active account is allowed through", () => {
  const d = decideSession(LIVE_ACTIVE)
  assert.equal(d.ok, true)
  assert.equal(d.ok && d.aal, "aal1")
})

test("D2 and asking for AAL2 explicitly still refuses that same session", () => {
  const d = decideSession(LIVE_ACTIVE, { aal: "aal2" })
  assert.equal(d.ok, false)
  assert.equal(d.ok === false && d.reason, "MFA_REQUIRED")
})

// ---------------------------------------------------------------------------
// The refusal order matters: a dead session is not told to go and enrol.
// ---------------------------------------------------------------------------

test("D3 a session that is not live is refused as SIGN_IN_REQUIRED, whatever else is true", () => {
  const d = decideSession(at({ session_live: false, enforcement_required: true, account_usable: false }))
  assert.equal(d.ok === false && d.reason, "SIGN_IN_REQUIRED")
})

test("D4 an unusable account is ACCOUNT_UNAVAILABLE, not MFA_REQUIRED", () => {
  const d = decideSession(at({ account_usable: false, enforcement_required: true }))
  assert.equal(d.ok === false && d.reason, "ACCOUNT_UNAVAILABLE")
})

test("D5 an enforced group at AAL1 is MFA_REQUIRED", () => {
  assert.equal(decideSession(at({ enforcement_required: true })).ok, false)
  const d = decideSession(at({ enforcement_required: true }))
  assert.equal(d.ok === false && d.reason, "MFA_REQUIRED")
})

test("D6 an enforced group that has reached AAL2 is allowed", () => {
  const d = decideSession(at({ enforcement_required: true, aal: "aal2" }))
  assert.equal(d.ok, true)
  assert.equal(d.ok && d.aal, "aal2")
})

test("D7 recentMinutes refuses VERIFY_AGAIN when the factor is stale, even at AAL2", () => {
  const d = decideSession(at({ aal: "aal2", recent_aal2: false }), { recentMinutes: 10 })
  assert.equal(d.ok === false && d.reason, "VERIFY_AGAIN")
})

test("D8 and permits it when the factor is recent", () => {
  assert.equal(decideSession(at({ aal: "aal2", recent_aal2: true }), { recentMinutes: 10 }).ok, true)
})

// ---------------------------------------------------------------------------
// THE ELEVATION EXEMPTION -- narrow, and only the assurance gate.
// This is the group of assertions that kills the mutant.
// ---------------------------------------------------------------------------

test("D9 allowAalElevation lets an unenrolled person reach the page that would enrol them", () => {
  const enforced = at({ enforcement_required: true })
  assert.equal(decideSession(enforced).ok, false, "without it they are refused")
  assert.equal(
    decideSession(enforced, { allowAalElevation: true }).ok,
    true,
    "with it they get in, which is the only reason it exists",
  )
})

test("D10 but it does NOT rescue a session that is not live", () => {
  const d = decideSession(at({ session_live: false }), { allowAalElevation: true })
  assert.equal(d.ok === false && d.reason, "SIGN_IN_REQUIRED")
})

test("D11 and does NOT rescue a suspended or disabled account", () => {
  const d = decideSession(at({ account_usable: false }), { allowAalElevation: true })
  assert.equal(
    d.ok === false && d.reason,
    "ACCOUNT_UNAVAILABLE",
    "the enrolment pages are not a way back in for an account that may not be used",
  )
})

test("D12 and does NOT satisfy a recent-AAL2 requirement", () => {
  const d = decideSession(at({ recent_aal2: false }), { allowAalElevation: true, recentMinutes: 10 })
  assert.equal(
    d.ok === false && d.reason,
    "VERIFY_AGAIN",
    "standing down the standing requirement must not stand down a specific one",
  )
})

test("D13 MUTANT KILLER: the exemption must be opt-in, never the default", () => {
  // If the flag is ever made globally true -- by an accidental `||`, an inverted condition, or a
  // default -- this is the assertion that goes red. An enforced group at AAL1 must be refused when
  // nobody asked for the exemption.
  const enforced = at({ enforcement_required: true })
  assert.equal(decideSession(enforced, {}).ok, false, "no option passed")
  assert.equal(decideSession(enforced, { allowAalElevation: false }).ok, false, "explicitly off")
  assert.equal(decideSession(enforced, { aal: "aal2" }).ok, false, "explicit demand still refused")
})
