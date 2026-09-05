import { detectResourceConflicts, trainingNeedsAllocationReview, trainingCardTitle } from "./training-conflicts"
import type { TrainingOccupancy } from "./training-conflicts"
import type { AllocationFixture, PitchOption } from "./types"

/** Run with `npx tsx lib/pitch-allocation/training-conflicts.verify.ts`. Permanent regression coverage for the Training/Fixture shared resource-conflict layer (Sections 35, 67, 70). */

let pass = 0
let fail = 0
function checkTrue(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${name}${detail && !cond ? ` -- ${detail}` : ""}`)
  if (cond) pass++
  else fail++
}

const pitchA: PitchOption = { id: "pitch-a", displayName: "Pitch A", active: true, venueId: "venue-1", sizeCategory: "full", laneCount: 1 }
const pitchB: PitchOption = { id: "pitch-b", displayName: "Pitch B", active: true, venueId: "venue-1", sizeCategory: "full", laneCount: 1 }
const pitchWideCapacity2: PitchOption = { id: "pitch-c", displayName: "Pitch C", active: true, venueId: "venue-1", sizeCategory: "full", laneCount: 2 }
const pitches = [pitchA, pitchB, pitchWideCapacity2]

function training(overrides: Partial<TrainingOccupancy> & Pick<TrainingOccupancy, "trainingSessionId">): TrainingOccupancy {
  return {
    teamLabel: "U12",
    venueId: "venue-1",
    pitchId: "pitch-a",
    sessionDate: "2026-10-12",
    startTime: "18:00",
    durationMinutes: 90,
    status: "PLANNED",
    source: "AUTOMATIC_PLAN",
    ...overrides,
  }
}

function fixture(overrides: Partial<AllocationFixture> & Pick<AllocationFixture, "fixtureId">): AllocationFixture {
  return {
    homeTeamId: "team-1",
    homeTeamLabel: "1st XV",
    opponentLabel: "Opponent",
    category: "senior",
    ageGroup: null,
    gender: "mens",
    status: "Booked",
    kickoffDate: "2026-10-12",
    kickoffTime: "18:30",
    venueId: "venue-1",
    pitchId: "pitch-a",
    durationMinutes: 80,
    durationConfidence: "confirmed",
    requiredPitchSize: "full",
    requiresOpponentAgreement: false,
    isSharedGroup: false,
    schedulingGroupId: null,
    awaySchedulingGroupId: null,
    effectiveHomeTeamIds: ["team-1"],
    effectiveAwayTeamIds: [],
    ...overrides,
  }
}

// 1. Training vs Training, same pitch, overlapping -> conflict.
{
  const t1 = training({ trainingSessionId: "t1", pitchId: "pitch-a", startTime: "18:00", durationMinutes: 90 })
  const t2 = training({ trainingSessionId: "t2", pitchId: "pitch-a", startTime: "18:30", durationMinutes: 60 })
  const { trainingConflicts } = detectResourceConflicts([], [t1, t2], pitches)
  // Matches this codebase's own established one-sided sweep-line
  // convention (auto-allocate.verify.ts test 13: only the later-starting
  // item in an overlapping pair is flagged, not both) -- t2 starts later.
  checkTrue("1: overlapping training-vs-training on the same pitch is a hard conflict", trainingConflicts.some((c) => c.trainingSessionId === "t2" && c.severity === "hard"), JSON.stringify(trainingConflicts))
}

// 2. Training vs Training, same pitch, non-overlapping -> no conflict.
{
  const t1 = training({ trainingSessionId: "t1", pitchId: "pitch-a", startTime: "18:00", durationMinutes: 60 })
  const t2 = training({ trainingSessionId: "t2", pitchId: "pitch-a", startTime: "19:00", durationMinutes: 60 })
  const { trainingConflicts } = detectResourceConflicts([], [t1, t2], pitches)
  checkTrue("2: back-to-back training with no gap (18:00-19:00 then 19:00-20:00) is NOT a conflict -- training has no pack-up padding", trainingConflicts.length === 0, JSON.stringify(trainingConflicts))
}

// 3. Training vs Fixture occupancy overlap -> conflict. Fixture (18:30)
// starts after training (18:00) -- the later-starting item is the one
// flagged, same established one-sided sweep-line convention as test 1.
{
  const f = fixture({ fixtureId: "f1", pitchId: "pitch-a", kickoffTime: "18:30", durationMinutes: 80 })
  const t = training({ trainingSessionId: "t1", pitchId: "pitch-a", startTime: "18:00", durationMinutes: 90 })
  const { fixtureConflicts } = detectResourceConflicts([f], [t], pitches)
  checkTrue("3: a fixture starting after a training session already occupying the pitch is flagged as a conflict", fixtureConflicts.some((c) => c.fixtureId === "f1" && c.severity === "hard"), JSON.stringify(fixtureConflicts))
}
// 3b. Reverse start order so TRAINING is the later-starting item -- proves the cross-domain overlap is genuinely detected in both directions, not just fixture-starts-first.
{
  const f = fixture({ fixtureId: "f1", pitchId: "pitch-a", kickoffTime: "18:00", durationMinutes: 80 })
  const t = training({ trainingSessionId: "t1", pitchId: "pitch-a", startTime: "18:30", durationMinutes: 90 })
  const { trainingConflicts } = detectResourceConflicts([f], [t], pitches)
  checkTrue("3b: a training session starting after a fixture already occupying the pitch is flagged as a conflict", trainingConflicts.some((c) => c.trainingSessionId === "t1" && c.severity === "hard"), JSON.stringify(trainingConflicts))
}

// 4. Training vs Fixture SETUP window overlap -> conflict (fixture's warm-up padding still occupies the pitch).
{
  const f = fixture({ fixtureId: "f1", pitchId: "pitch-a", kickoffTime: "19:00", durationMinutes: 80 })
  const t = training({ trainingSessionId: "t1", pitchId: "pitch-a", startTime: "18:00", durationMinutes: 90 }) // ends 19:30, fixture kicks off 19:00
  const { fixtureConflicts } = detectResourceConflicts([f], [t], pitches, { warmUpMinutes: 30, packUpMinutes: 15 })
  checkTrue("4: a fixture whose warm-up window (kickoff minus 30min = 18:30) starts while training (18:00-19:30) is still on the pitch is flagged as a conflict -- the fixture physically owns the pitch from warm-up, training gets no equivalent padding", fixtureConflicts.some((c) => c.fixtureId === "f1" && c.severity === "hard"), JSON.stringify(fixtureConflicts))
}

// 5. Training itself has no setup/pack-up: two trainings back-to-back with zero gap must NOT conflict (already proven in #2), and training ending exactly when a fixture's UN-padded kickoff begins must not conflict.
{
  const f = fixture({ fixtureId: "f1", pitchId: "pitch-a", kickoffTime: "19:00", durationMinutes: 80 })
  const t = training({ trainingSessionId: "t1", pitchId: "pitch-a", startTime: "17:30", durationMinutes: 90 }) // ends exactly 19:00
  const { fixtureConflicts, trainingConflicts } = detectResourceConflicts([f], [t], pitches, { warmUpMinutes: 0, packUpMinutes: 0 })
  checkTrue("5: training ending exactly when a fixture (with zero buffers) begins does not conflict -- no phantom padding on either side", fixtureConflicts.length === 0 && trainingConflicts.length === 0)
}

// 6. Different pitch at the same venue is valid.
{
  const t1 = training({ trainingSessionId: "t1", pitchId: "pitch-a", startTime: "18:00", durationMinutes: 90 })
  const t2 = training({ trainingSessionId: "t2", pitchId: "pitch-b", startTime: "18:00", durationMinutes: 90 })
  const { trainingConflicts } = detectResourceConflicts([], [t1, t2], pitches)
  checkTrue("6: identical time on two different pitches is not a conflict", trainingConflicts.length === 0)
}

// 6b. Multi-lane pitch (capacity 2) genuinely hosts two overlapping trainings without conflict, but a third overlapping one does conflict.
{
  const t1 = training({ trainingSessionId: "t1", pitchId: "pitch-c", startTime: "18:00", durationMinutes: 60 })
  const t2 = training({ trainingSessionId: "t2", pitchId: "pitch-c", startTime: "18:00", durationMinutes: 60 })
  const t3 = training({ trainingSessionId: "t3", pitchId: "pitch-c", startTime: "18:00", durationMinutes: 60 })
  const { trainingConflicts } = detectResourceConflicts([], [t1, t2, t3], pitches)
  checkTrue("6b: a lane_count=2 pitch hosts 2 simultaneous training sessions with zero conflicts", !trainingConflicts.some((c) => c.trainingSessionId === "t1") && !trainingConflicts.some((c) => c.trainingSessionId === "t2"))
  checkTrue("6b: the 3rd simultaneous session on the same capacity-2 pitch is flagged", trainingConflicts.some((c) => c.trainingSessionId === "t3"))
}

// 7. Unallocated training (no pitch/time) remains visible as needing review.
{
  const t = training({ trainingSessionId: "t1", pitchId: null, startTime: null, durationMinutes: null })
  checkTrue("7: a training session with no pitch/time needs allocation review", trainingNeedsAllocationReview(t, []))
}

// 8. Preferred pitch != guaranteed allocation: a conflicted preferred-pitch session still needs review even though it "has" a pitch.
{
  const t1 = training({ trainingSessionId: "t1", pitchId: "pitch-a", startTime: "18:00", durationMinutes: 90 })
  const t2 = training({ trainingSessionId: "t2", pitchId: "pitch-a", startTime: "18:30", durationMinutes: 60 })
  const { trainingConflicts } = detectResourceConflicts([], [t1, t2], pitches)
  checkTrue("8: a session with a preferred pitch assigned but a genuine conflict still needs allocation review, not silently treated as booked", trainingNeedsAllocationReview(t2, trainingConflicts))
}

// 9. Cancelled training never occupies a pitch.
{
  const t1 = training({ trainingSessionId: "t1", pitchId: "pitch-a", startTime: "18:00", durationMinutes: 90, status: "CANCELLED" })
  const t2 = training({ trainingSessionId: "t2", pitchId: "pitch-a", startTime: "18:30", durationMinutes: 60 })
  const { trainingConflicts } = detectResourceConflicts([], [t1, t2], pitches)
  checkTrue("9: a cancelled training session does not generate or receive a conflict", trainingConflicts.length === 0, JSON.stringify(trainingConflicts))
}

// 10. Card title: no opponent, no home/away wording (Section 28/33).
checkTrue('10: training card title format is "<Team> — Planned Training"', trainingCardTitle("Burnley U12") === "Burnley U12 — Planned Training")

console.log(`\n${pass} PASS, ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
