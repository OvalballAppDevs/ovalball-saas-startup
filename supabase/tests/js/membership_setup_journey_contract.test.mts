// THE SETUP JOURNEY'S SHARED WORDS AND STATUSES (Club Memberships Part 1, correction pass).
//
// packages/contracts/src/membership/setup.ts tells both clients what a club sets up, why GoCardless, what Ovalball
// receives, how the money works, and where Review stands. These are its rules: every status reads the server's own
// readiness (never a screen's guess); a step the club has passed but not finished is never "done"; Ovalball's fee
// is the server's basis points said once; the merchant disclosure claims nothing GoCardless has not stated and is
// marked as proposed; and the connection is described without a token or an id.

import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
  activationStatus,
  CLUB_MEMBERSHIP_TERMS_STATUS,
  connectionFacts,
  GOCARDLESS_CONNECT_POINTS,
  membershipDisclosure,
  setupOverviewSteps,
  setupProgress,
  type MembershipSetupState,
} from "@/packages/contracts/src/membership/setup"

type Setup = Pick<MembershipSetupState, "terms" | "connection" | "programme" | "readiness" | "feeBps" | "canConfigure">

const connection = (state: MembershipSetupState["connection"]["state"]): MembershipSetupState["connection"] => ({
  state,
  verification: state === "READY" ? "successful" : null,
  environment: state === "NOT_CONNECTED" ? null : "sandbox",
  connectedAt: state === "NOT_CONNECTED" ? null : "2026-10-04T10:00:00Z",
  disconnectedAt: null,
  checkedAt: state === "NOT_CONNECTED" ? null : "2026-10-06T21:00:00Z",
})

function setup(over: Partial<Setup> = {}): Setup {
  return {
    terms: { version: "v1", accepted: false, acceptedAt: null, acceptedByName: null },
    connection: connection("NOT_CONNECTED"),
    programme: { id: "p", enabled: false, activatedAt: null, collectionDay: 1, firstPaymentPolicy: "NEXT_COLLECTION_DAY", feeBearer: "PAYER", currency: "GBP" },
    readiness: { canActivate: false, missing: ["TERMS", "CONNECT"], readyMemberships: 2 },
    feeBps: 250,
    canConfigure: true,
    ...over,
  }
}

describe("the setup journey's shared words and statuses", () => {
  it("SJ1 what a club sets up: four steps in order, Ovalball's fee from the server's basis points", () => {
    const steps = setupOverviewSteps(250)
    assert.deepEqual(steps.map((s) => s.key), ["connect", "settings", "memberships", "review"])
    assert.match(steps[1]!.body, /who pays Ovalball's 2\.5%/)
    assert.match(setupOverviewSteps(300)[1]!.body, /3%/, "the rate is never a constant in the words")
    assert.match(steps[0]!.body, /Bank details stay with GoCardless/)
  })

  it("SJ2 progress: a passed but unfinished step is never done; settings and memberships read the server's own state", () => {
    const fresh = setupProgress(setup())
    assert.deepEqual(fresh.map((s) => [s.key, s.done]), [["connect", false], ["settings", true], ["memberships", true], ["review", false]])
    assert.equal(fresh[0]!.detail, "Not connected")
    assert.equal(fresh[1]!.detail, "1st of each month · members pay Ovalball's fee")
    assert.equal(fresh[2]!.detail, "2 memberships ready")
    // Connected without agreeing to Ovalball's terms is not a finished Connect step.
    assert.equal(setupProgress(setup({ connection: connection("READY") }))[0]!.done, false)
    const ready = setupProgress(setup({ terms: { version: "v1", accepted: true, acceptedAt: "2026-10-06", acceptedByName: "Rhian" }, connection: connection("READY"), readiness: { canActivate: true, missing: [], readyMemberships: 1 } }))
    assert.deepEqual(ready.map((s) => s.done), [true, true, true, false], "Review is done only by activating")
    assert.equal(ready[3]!.detail, "Ready to activate")
    assert.equal(ready[2]!.detail, "1 membership ready")
    assert.equal(setupProgress(setup({ programme: null }))[1]!.detail, "Not chosen yet")
  })

  it("SJ3 Review's status is the server's readiness: ready, waiting only for GoCardless, action required, or not yours to activate", () => {
    assert.equal(activationStatus(setup(), "Hollins Vale RFC").kind, "ACTION_REQUIRED")
    assert.equal(activationStatus(setup(), null).body, "2 things to finish before memberships can be switched on.")
    assert.equal(activationStatus(setup({ readiness: { canActivate: false, missing: ["FEE"], readyMemberships: 1 } }), null).body, "1 thing to finish before memberships can be switched on.")
    const waiting = activationStatus(setup({ connection: connection("VERIFYING"), readiness: { canActivate: false, missing: ["VERIFY"], readyMemberships: 1 } }), "Hollins Vale RFC")
    assert.equal(waiting.kind, "WAITING")
    assert.match(waiting.body, /Hollins Vale RFC's account/)
    // GoCardless asking the club for information is the club's to do, so it is action required, not waiting.
    assert.equal(activationStatus(setup({ connection: connection("ACTION_REQUIRED"), readiness: { canActivate: false, missing: ["VERIFY"], readyMemberships: 1 } }), null).kind, "ACTION_REQUIRED")
    assert.equal(activationStatus(setup({ readiness: { canActivate: true, missing: [], readyMemberships: 1 } }), null).kind, "READY")
    assert.equal(activationStatus(setup({ canConfigure: false, readiness: { canActivate: true, missing: [], readyMemberships: 1 } }), null).kind, "NOT_ALLOWED")
  })

  it("SJ4 why GoCardless, and the money's roles: bank details never with Ovalball; the disclosure is the server's rate and marked proposed", () => {
    assert.deepEqual(GOCARDLESS_CONNECT_POINTS.map((p) => p.key), ["secure", "bank", "data", "return"])
    assert.match(GOCARDLESS_CONNECT_POINTS[1]!.body, /never sees or stores anyone's bank details/)
    const disclosure = membershipDisclosure(250)
    assert.match(disclosure, /GoCardless provides the Direct Debit service/)
    assert.match(disclosure, /charges 2\.5% of each membership payment collected/)
    assert.match(disclosure, /GoCardless's own fees are separate/)
    assert.ok(!/approved|partner revenue share/i.test(disclosure), "never claims an approval it does not have, never the partner's jargon")
    assert.match(CLUB_MEMBERSHIP_TERMS_STATUS, /^Proposed wording, pending/)
  })

  it("SJ5 the connection as facts: which account, since when, verification -- never a token or an organisation id", () => {
    const facts = connectionFacts({ ...connection("READY"), environment: "production" })
    assert.deepEqual(facts.map((f) => f.label), ["Account", "Connected", "Verification", "Last Checked"])
    assert.equal(facts[0]!.value, "Live GoCardless account")
    assert.equal(facts[2]!.value, "Verified by GoCardless")
    assert.ok(!facts.some((f) => /OR_|token|access/i.test(f.value)))
    assert.equal(connectionFacts(connection("VERIFYING"))[0]!.value, "GoCardless test account, no real money")
    assert.deepEqual(connectionFacts(connection("NOT_CONNECTED")).map((f) => f.label), ["Verification"])
  })
})
