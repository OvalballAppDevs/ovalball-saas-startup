import { test } from "node:test"
import assert from "node:assert/strict"

import { draftToSavePlanArgs, repeatWeekdaysLabel } from "./review-logic.ts"
import type { TrainingPlanDraft } from "./draft-context.ts"
import type { OrderedTeamOption, CanonicalSeason } from "../data.ts"
import type { ClubPitch, ClubVenue } from "@ovalball/contracts/club/venues"

/** PINS the Review & Create draft -> save_training_plan payload mapping (Step 6). */

const team: OrderedTeamOption = {
  teamId: "team-1",
  displayName: "Under 12 Boys",
  teamLabel: "Under 12 Boys",
  category: "youth",
  ageGroup: "u12",
  gender: "male",
  coverImagePath: null,
  coverStockKey: null,
}

const season: CanonicalSeason = { id: "season-1", name: "Rugby Union 26/27", startsOn: "2026-09-01", endsOn: "2027-05-31", preSeasonStartsOn: "2026-06-01" }

const venue = { id: "venue-1", name: "Ovalball UAT Ground" } as ClubVenue
const pitch = { id: "pitch-1", displayName: "Pitch 1", venueId: "venue-1" } as ClubPitch

function fullDraft(overrides: Partial<TrainingPlanDraft> = {}): TrainingPlanDraft {
  return {
    team,
    planType: "SEASON",
    season,
    startDate: "2026-09-01",
    endDate: "2027-05-31",
    repeatWeekdays: [1, 3],
    venue,
    pitch,
    startTime: "18:00",
    durationMinutes: 60,
    warmUpMinutes: 15,
    coolDownMinutes: 10,
    notes: "Bring water.",
    ...overrides,
  }
}

test("draftToSavePlanArgs: weekdays map correctly, sorted", () => {
  const args = draftToSavePlanArgs("club-1", fullDraft({ repeatWeekdays: [3, 1] }))
  assert.deepEqual(
    args?.p_rules.map((r) => r.weekday),
    [1, 3]
  )
})

test("draftToSavePlanArgs: time and duration map onto every rule", () => {
  const args = draftToSavePlanArgs("club-1", fullDraft())
  assert.deepEqual(args?.p_rules, [
    { weekday: 1, start_time: "18:00", duration_minutes: 60 },
    { weekday: 3, start_time: "18:00", duration_minutes: 60 },
  ])
})

test("draftToSavePlanArgs: venue and pitch ids map correctly", () => {
  const args = draftToSavePlanArgs("club-1", fullDraft())
  assert.equal(args?.p_preferred_venue_id, "venue-1")
  assert.equal(args?.p_preferred_pitch_id, "pitch-1")
})

test("draftToSavePlanArgs: selected team maps correctly", () => {
  const args = draftToSavePlanArgs("club-1", fullDraft())
  assert.equal(args?.p_team_id, "team-1")
})

test("draftToSavePlanArgs: season and schedule mode map correctly", () => {
  const args = draftToSavePlanArgs("club-1", fullDraft())
  assert.equal(args?.p_season_id, "season-1")
  assert.equal(args?.p_schedule_mode, "SEASON")
})

test("draftToSavePlanArgs: warm-up/pack-up map correctly", () => {
  const args = draftToSavePlanArgs("club-1", fullDraft({ warmUpMinutes: 20, coolDownMinutes: 5 }))
  assert.equal(args?.p_warm_up_minutes, 20)
  assert.equal(args?.p_pack_up_minutes, 5)
})

test("draftToSavePlanArgs: blank notes map to null, never an empty string", () => {
  const args = draftToSavePlanArgs("club-1", fullDraft({ notes: "   " }))
  assert.equal(args?.p_default_session_notes, null)
})

test("draftToSavePlanArgs: real notes map through trimmed", () => {
  const args = draftToSavePlanArgs("club-1", fullDraft({ notes: "  Bring water.  " }))
  assert.equal(args?.p_default_session_notes, "Bring water.")
})

test("draftToSavePlanArgs: an incomplete draft cannot submit -- returns null", () => {
  assert.equal(draftToSavePlanArgs("club-1", fullDraft({ team: null })), null)
  assert.equal(draftToSavePlanArgs("club-1", fullDraft({ venue: null })), null)
  assert.equal(draftToSavePlanArgs("club-1", fullDraft({ pitch: null })), null)
  assert.equal(draftToSavePlanArgs("club-1", fullDraft({ startTime: null })), null)
  assert.equal(draftToSavePlanArgs("club-1", fullDraft({ durationMinutes: null })), null)
  assert.equal(draftToSavePlanArgs("club-1", fullDraft({ repeatWeekdays: [] })), null)
})

test("repeatWeekdaysLabel: Monday-first human-readable order", () => {
  assert.equal(repeatWeekdaysLabel([3, 1]), "Monday, Wednesday")
  assert.equal(repeatWeekdaysLabel([0, 6]), "Saturday, Sunday")
})
