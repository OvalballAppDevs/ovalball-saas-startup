import { test } from "node:test"
import assert from "node:assert/strict"

import { isAnswerable } from "@/components/fixtures/agenda/answerable"
import type { AgendaItem } from "@/lib/agenda/load"

/**
 * WHEN THE AGENDA ASKS A FAMILY TO ANSWER.
 *
 * Deliberately not an authority test -- the server owns that, and
 * `supabase/tests/step9_family_and_availability.sql` section A proves it. This
 * covers the narrower question of whether ASKING makes sense on a row, which is
 * the part a component can get wrong without anybody noticing: offering three
 * buttons on a match that was cancelled, or on one that was played in March,
 * asks a parent to commit to something that is not happening.
 */

const TODAY = "2026-09-20"

function item(overrides: Partial<AgendaItem> = {}): AgendaItem {
  return {
    key: "k",
    kind: "fixture",
    eventId: "fixture-1",
    date: "2026-10-04",
    time: "11:00",
    meetTime: null,
    us: { directoryId: null, clubName: "Ours", teamName: "Under 12 Boys", compactName: null, crestUrl: null, kit: null },
    them: { directoryId: null, clubName: "Theirs", teamName: null, compactName: null, crestUrl: null, kit: null },
    homeAway: "Home",
    venue: null,
    pitch: null,
    status: "Booked",
    result: null,
    playerId: "player-1",
    childFirstName: "Ava",
    childAvatarUrl: null,
    attendance: null,
    teamId: "team-1",
    clubId: "club-1",
    href: "/fixtures/fixture-1",
    ...overrides,
  }
}

test("an upcoming fixture for a named player is answerable", () => {
  assert.equal(isAnswerable(item(), TODAY), true)
})

test("today's rugby is still answerable -- a match this afternoon is exactly when a parent changes their mind", () => {
  assert.equal(isAnswerable(item({ date: TODAY }), TODAY), true)
})

test("a row about no particular player is never answerable", () => {
  // A coach reading their squad's agenda is not being asked whether they can attend.
  assert.equal(isAnswerable(item({ playerId: null }), TODAY), false)
})

test("rugby that has already happened is not answerable", () => {
  assert.equal(isAnswerable(item({ date: "2026-09-19" }), TODAY), false)
})

test("a cancelled fixture is not answerable, whatever its date", () => {
  for (const status of ["Cancelled", "cancelled", "POSTPONED", "Abandoned"]) {
    assert.equal(isAnswerable(item({ status }), TODAY), false, `status ${status} was offered as answerable`)
  }
})

test("a booked or unknown status is answerable -- absence of a cancellation is not a reason to refuse", () => {
  for (const status of ["Booked", "Scheduled", null, "To Be Determined"]) {
    assert.equal(isAnswerable(item({ status }), TODAY), true, `status ${status} was refused`)
  }
})

test("training is answerable on the same terms as a fixture", () => {
  assert.equal(isAnswerable(item({ kind: "training", them: null, href: null }), TODAY), true)
  assert.equal(isAnswerable(item({ kind: "training", them: null, date: "2026-09-01" }), TODAY), false)
})

test("an answer that already exists is still answerable -- a family changes its mind", () => {
  assert.equal(isAnswerable(item({ attendance: "ATTENDING" }), TODAY), true)
  assert.equal(isAnswerable(item({ attendance: "CANNOT_ATTEND" }), TODAY), true)
})
