import { test } from "node:test"
import assert from "node:assert/strict"

import { projectRequest, type RequestRow } from "../../../packages/contracts/src/team/requests"

/**
 * CA-M11.5 UI ASSEMBLY (Section 9): `projectRequest`'s `canNegotiate`/`isMyTurn` fields are the CLIENT
 * mirror of `counter_fixture_request`/`accept_fixture_request`'s own responder logic (see
 * supabase/migrations/20270553000000_a_club_may_suggest_another_time.sql) -- whoever did NOT make the
 * current standing proposal is the only side that may accept/decline/counter next. These tests pin
 * that mirror against the RPC's actual state machine so a future change to one cannot silently drift
 * from the other; the server itself remains the real authority in every case.
 */
const TEAM_A = "11111111-1111-1111-1111-111111111111"
const TEAM_B = "22222222-2222-2222-2222-222222222222"

function row(overrides: Partial<RequestRow>): RequestRow {
  return {
    id: "req-1",
    status: "sent",
    venue_preference: "home",
    preferred_kickoff_time: null,
    note: null,
    created_at: "2026-01-01T00:00:00Z",
    decided_at: null,
    updated_at: "2026-01-01T00:00:00Z",
    requesting_team_id: TEAM_A,
    target_team_id: TEAM_B,
    existing_fixture_id: null,
    countered_date: null,
    countered_kickoff_time: null,
    countered_venue_preference: null,
    counter_note: null,
    last_proposed_by_team_id: null,
    requester: null,
    target: null,
    fixture_request_groups: { proposed_date: "2026-03-01", raw_opponent_text: "Opponent", game_type: "League" },
    ...overrides,
  }
}

test("a freshly sent request: the target team's turn, the requester's is not", () => {
  const r = row({})
  assert.equal(projectRequest(r, TEAM_B).isMyTurn, true)
  assert.equal(projectRequest(r, TEAM_A).isMyTurn, false)
})

test("after the target counters, the turn flips back to the original requester", () => {
  const r = row({ status: "counter_proposed", last_proposed_by_team_id: TEAM_B })
  assert.equal(projectRequest(r, TEAM_A).isMyTurn, true)
  assert.equal(projectRequest(r, TEAM_B).isMyTurn, false)
})

test("after the requester counters back, the turn returns to the target", () => {
  const r = row({ status: "counter_proposed", last_proposed_by_team_id: TEAM_A })
  assert.equal(projectRequest(r, TEAM_A).isMyTurn, false)
  assert.equal(projectRequest(r, TEAM_B).isMyTurn, true)
})

test("neither side's turn once resolved -- accepted, declined and cancelled are not open for negotiation", () => {
  for (const status of ["accepted", "declined", "cancelled", "expired"] as const) {
    const r = row({ status })
    assert.equal(projectRequest(r, TEAM_A).isMyTurn, false)
    assert.equal(projectRequest(r, TEAM_B).isMyTurn, false)
  }
})

test("canNegotiate is false for a scheduling-group target (no real target_team_id)", () => {
  const r = row({ target_team_id: null })
  assert.equal(projectRequest(r, TEAM_A).canNegotiate, false)
})

test("canNegotiate is false for a request confirming an existing fixture -- counter_fixture_request's own scope boundary", () => {
  const r = row({ existing_fixture_id: "fixture-1" })
  assert.equal(projectRequest(r, TEAM_A).canNegotiate, false)
})

test("canNegotiate is true for an ordinary open team-to-team negotiation", () => {
  const r = row({})
  assert.equal(projectRequest(r, TEAM_A).canNegotiate, true)
  assert.equal(projectRequest(r, TEAM_B).canNegotiate, true)
})
