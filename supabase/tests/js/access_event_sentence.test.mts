import { test } from "node:test"
import assert from "node:assert/strict"

import { accessEventSentence, accessReasonText } from "@ovalball/contracts/club/access-history"

/**
 * THE CLUB TIMELINE'S WORDS.
 *
 * The rule that matters most here is the last test: an event type this file
 * does not recognise falls back to the raw key. A timeline that invented a
 * plausible sentence for an event it did not understand would be worse than one
 * that showed `something.happened` -- it would be confidently wrong about a
 * change to somebody's access, which is the one subject where that is least
 * acceptable.
 */

test("a role grant reads as giving somebody a role", () => {
  assert.equal(accessEventSentence("role.granted", null, "Coach", null), "Given the Coach role")
})

test("a team-scoped decision says which team, once", () => {
  assert.equal(
    accessEventSentence("role.granted", null, "Coach", "Under 12 Boys"),
    "Given the Coach role — Under 12 Boys"
  )
  // Already named in the sentence: not repeated.
  assert.equal(accessEventSentence("player_team.added", null, null, "Under 12 Boys"), "Added to Under 12 Boys")
})

test("an explicit allow and an explicit withhold read as what they are", () => {
  assert.equal(accessEventSentence("override.granted", "Cancel Fixtures", null, null), "Allowed Cancel Fixtures")
  assert.equal(
    accessEventSentence("override.revoked", "Cancel Fixtures", null, null),
    "Cancel Fixtures reset to their role's answer"
  )
})

test("a preset reads as handing out a job, which is the intent the individual grants cannot carry", () => {
  assert.equal(
    accessEventSentence("override.preset_applied", "Volunteer — Pitch Allocation", null, null),
    "Given the Volunteer — Pitch Allocation job"
  )
})

test("membership transitions read in plain words", () => {
  // People & Invitations: the membership's reversible pause is called Deactivate on both clients.
  assert.equal(accessEventSentence("membership.suspended", null, null, null), "Membership deactivated")
  assert.equal(accessEventSentence("membership.restored", null, null, null), "Membership reactivated")
  assert.equal(accessEventSentence("membership.revoked", null, null, null), "Removed from the club")
  assert.equal(accessEventSentence("invitation.revoked", null, null, null), "Invitation withdrawn")
})

test("an event with nothing to name still reads as a sentence rather than a gap", () => {
  assert.equal(accessEventSentence("role.granted", null, null, null), "Given the it role")
  assert.equal(accessEventSentence("membership.granted", null, null, null), "Joined the club")
})

test("AN UNKNOWN EVENT FALLS BACK TO ITS KEY, never to a guess", () => {
  assert.equal(accessEventSentence("something.brand.new", "x", "y", "z"), "something.brand.new")
  assert.equal(accessEventSentence("", null, null, null), "")
})

test("a recorded reason names the role, never its internal key, and is otherwise left as written", () => {
  // Written by an earlier app version; the record is kept, the display reads as words.
  assert.equal(accessReasonText("Set from Team Profile Staff (FIRST_AIDER)"), "Set from Team Profile Staff (First Aider)")
  assert.equal(accessReasonText("Added from Team Profile Staff (TEAM_SAFEGUARDING_LEAD)"), "Added from Team Profile Staff (Team Safeguarding Lead)")
  // Brackets that are not a role's key, and an ordinary reason, are untouched.
  assert.equal(accessReasonText("Moved to the (U12) squad"), "Moved to the (U12) squad")
  assert.equal(accessReasonText("Stepped down as coach"), "Stepped down as coach")
  assert.equal(accessReasonText(null), null)
})
