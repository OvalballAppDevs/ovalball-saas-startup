import { test } from "node:test"
import assert from "node:assert/strict"

import { accessEventSentence } from "@/lib/permissions/access-event-sentence"

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
  assert.equal(accessEventSentence("membership.suspended", null, null, null), "Membership suspended")
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
