import assert from "node:assert/strict"
import { test } from "node:test"

import { trainingSummaryBlock } from "@/lib/email/design/components"

import type { TrainingEmailContext } from "@/lib/email/context/resolve-training-email-context"

/**
 * TRAINING SUMMARY -- LIVE PROOF AT THE RENDERER LAYER.
 *
 * Not wired to a live email event yet (see docs/EMAIL_DYNAMIC_DATA_CATALOGUE
 * .md), so there is no send path to exercise end to end. These tests instead
 * prove the renderer itself is correct against the resolver's own real
 * output shape -- the same null-safe, never-"undefined" standard
 * matchSummaryBlock's own tests hold it to.
 *
 * There is no Event Summary counterpart here: resolveEventEmailContext and
 * eventSummaryBlock were removed. They were built against
 * public.club_events, which is Main's in-progress Event Centre work and is
 * not yet part of the committed platform -- see
 * docs/EMAIL_DYNAMIC_DATA_CATALOGUE.md for Event's PLANNED / NOT AVAILABLE
 * status, the same treatment as Tournament.
 */

function baseTraining(overrides: Partial<TrainingEmailContext> = {}): TrainingEmailContext {
  return {
    trainingSessionId: "training-1",
    status: "PLANNED",
    teamName: "U12 Boys",
    clubName: "Solihull Rugby Club",
    sessionDateDisplay: "Wednesday 9 September 2026",
    sessionDateIso: "2026-09-09",
    timeRangeDisplay: "18:00–19:30",
    venue: { name: "Sample Training Ground", addressLines: ["Sample Road"], postcode: "SA1 1PL" },
    pitchName: "Pitch 2",
    cancellationReason: null,
    ...overrides,
  }
}

test("training: full data renders team, date, time range, venue and pitch", () => {
  const html = trainingSummaryBlock(baseTraining())
  assert.ok(html.includes("U12 Boys"))
  assert.ok(html.includes("Wednesday 9 September 2026"))
  assert.ok(html.includes("18:00–19:30"))
  assert.ok(html.includes("Sample Training Ground"))
  assert.ok(html.includes("Pitch 2"))
  assert.ok(!html.includes("undefined"))
  assert.ok(!html.includes("null"))
})

test("training: no team, no venue, no pitch collapses cleanly -- still just a date", () => {
  const html = trainingSummaryBlock(baseTraining({ teamName: null, venue: null, pitchName: null, timeRangeDisplay: null }))
  assert.ok(html.includes("Wednesday 9 September 2026"))
  assert.ok(!html.includes("undefined"))
  assert.ok(!html.includes("null"))
})

test("training: no home/away, no opposition, no attendance count -- training has none of those concepts", () => {
  const html = trainingSummaryBlock(baseTraining())
  assert.ok(!/\bhome\b/i.test(html))
  assert.ok(!/\baway\b/i.test(html))
  assert.ok(!html.toLowerCase().includes("opposition"))
})
