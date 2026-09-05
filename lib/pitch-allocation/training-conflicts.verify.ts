import { detectResourceConflicts, trainingNeedsAllocationReview, trainingCardTitle } from "./training-conflicts"
import type { TrainingOccupancy } from "./training-conflicts"
import type { AllocationFixture, PitchOption } from "./types"

/** Run with `npx tsx lib/pitch-allocation/training-conflicts.verify.ts`. Permanent regression coverage for the Training/Fixture shared resource-conflict layer (Sections 35, 67, 70) and the shared-training-pitch rule (Training Management extension, Section 1-4, 55-56, 93). */

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

// =====================================================================
// SHARED TRAINING PITCH RULE (Training Management extension)
// =====================================================================

// 1. Training vs Training, same pitch, overlapping -> ALLOWED, never a conflict.
{
  const t1 = training({ trainingSessionId: "t1", pitchId: "pitch-a", startTime: "18:00", durationMinutes: 90 })
  const t2 = training({ trainingSessionId: "t2", pitchId: "pitch-a", startTime: "18:30", durationMinutes: 60 })
  const { trainingConflicts } = detectResourceConflicts([], [t1, t2], pitches)
  checkTrue("1: overlapping training-vs-training on the same pitch is ALLOWED -- never a conflict, this is normal shared-pitch training", trainingConflicts.length === 0, JSON.stringify(trainingConflicts))
}

// 2. Training vs Training, same pitch, non-overlapping -> also allowed (was already true, still is).
{
  const t1 = training({ trainingSessionId: "t1", pitchId: "pitch-a", startTime: "18:00", durationMinutes: 60 })
  const t2 = training({ trainingSessionId: "t2", pitchId: "pitch-a", startTime: "19:00", durationMinutes: 60 })
  const { trainingConflicts } = detectResourceConflicts([], [t1, t2], pitches)
  checkTrue("2: back-to-back training with no gap (18:00-19:00 then 19:00-20:00) is NOT a conflict -- training has no pack-up padding", trainingConflicts.length === 0, JSON.stringify(trainingConflicts))
}

// 1b. Three age groups sharing one pitch at genuinely different, overlapping times (Section 3's worked example) -- all allowed, none flagged.
{
  const u12 = training({ trainingSessionId: "u12", pitchId: "pitch-a", teamLabel: "U12", startTime: "18:00", durationMinutes: 60 })
  const u13 = training({ trainingSessionId: "u13", pitchId: "pitch-a", teamLabel: "U13", startTime: "18:00", durationMinutes: 90 })
  const u15 = training({ trainingSessionId: "u15", pitchId: "pitch-a", teamLabel: "U15", startTime: "18:30", durationMinutes: 90 })
  const { trainingConflicts } = detectResourceConflicts([], [u12, u13, u15], pitches)
  checkTrue("1b: U12/U13/U15 sharing Pitch 1 at overlapping times (Section 3's exact worked example) are all allowed", trainingConflicts.length === 0, JSON.stringify(trainingConflicts))
}

// 1c. Section 55: ten simultaneous training sessions on one pitch -- no invented maximum.
{
  const sessions = Array.from({ length: 10 }, (_, i) => training({ trainingSessionId: `t${i}`, pitchId: "pitch-a", startTime: "18:00", durationMinutes: 60 }))
  const { trainingConflicts } = detectResourceConflicts([], sessions, pitches)
  checkTrue("1c: 10 simultaneous training sessions on the same pitch are all allowed -- no invented per-pitch training capacity", trainingConflicts.length === 0, JSON.stringify(trainingConflicts))
}

// 3. Training vs Fixture occupancy overlap -> still a genuine conflict (fixture exclusivity unchanged). Fixture (18:30) starts after training (18:00) -- the later-starting item is the one flagged, established one-sided sweep-line convention.
{
  const f = fixture({ fixtureId: "f1", pitchId: "pitch-a", kickoffTime: "18:30", durationMinutes: 80 })
  const t = training({ trainingSessionId: "t1", pitchId: "pitch-a", startTime: "18:00", durationMinutes: 90 })
  const { fixtureConflicts } = detectResourceConflicts([f], [t], pitches)
  checkTrue("3: a fixture starting after a training session already occupying the pitch is flagged as a conflict -- fixture exclusivity is not weakened by the shared-training-pitch rule", fixtureConflicts.some((c) => c.fixtureId === "f1" && c.severity === "hard"), JSON.stringify(fixtureConflicts))
}
// 3b. Reverse start order so TRAINING is the later-starting item -- proves the cross-domain overlap is genuinely detected in both directions, not just fixture-starts-first.
{
  const f = fixture({ fixtureId: "f1", pitchId: "pitch-a", kickoffTime: "18:00", durationMinutes: 80 })
  const t = training({ trainingSessionId: "t1", pitchId: "pitch-a", startTime: "18:30", durationMinutes: 90 })
  const { trainingConflicts } = detectResourceConflicts([f], [t], pitches)
  checkTrue("3b: a training session starting after a fixture already occupying the pitch is flagged as a conflict", trainingConflicts.some((c) => c.trainingSessionId === "t1" && c.severity === "hard"), JSON.stringify(trainingConflicts))
}

// 3c. Section 56: a fixture's full occupancy window (with setup/pack-up) conflicts with an overlapping training session, but training starting exactly when that window ends is allowed.
{
  const f = fixture({ fixtureId: "f1", pitchId: "pitch-a", kickoffTime: "19:00", durationMinutes: 80 })
  const tOverlap = training({ trainingSessionId: "t-overlap", pitchId: "pitch-a", startTime: "18:30", durationMinutes: 60 }) // 18:30-19:30, fixture occupancy 18:00-21:00 with buffers below
  const tAfter = training({ trainingSessionId: "t-after", pitchId: "pitch-a", startTime: "21:00", durationMinutes: 60 }) // starts exactly when fixture occupancy ends
  const { trainingConflicts } = detectResourceConflicts([f], [tOverlap, tAfter], pitches, { warmUpMinutes: 60, packUpMinutes: 40 }) // occupancy 18:00-21:00
  checkTrue("3c: training overlapping a fixture's full setup/play/pack-up window is a genuine conflict", trainingConflicts.some((c) => c.trainingSessionId === "t-overlap" && c.severity === "hard"), JSON.stringify(trainingConflicts))
  checkTrue("3c: training starting exactly when the fixture's occupancy window ends (21:00) is allowed -- precise interval semantics, no phantom overlap", !trainingConflicts.some((c) => c.trainingSessionId === "t-after"), JSON.stringify(trainingConflicts))
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

// 6b. lane_count is a FIXTURE-vs-FIXTURE capacity concept only -- it must never limit how many training sessions can share a pitch (superseding the old "lane_count=2 training" test, since training now has no capacity limit at all regardless of lane_count).
{
  const sessions = Array.from({ length: 5 }, (_, i) => training({ trainingSessionId: `t${i}`, pitchId: "pitch-c", startTime: "18:00", durationMinutes: 60 })) // pitch-c has laneCount=2
  const { trainingConflicts } = detectResourceConflicts([], sessions, pitches)
  checkTrue("6b: a pitch's lane_count (a fixture-capacity concept) does not limit training sharing -- 5 overlapping trainings on a lane_count=2 pitch are all still allowed", trainingConflicts.length === 0, JSON.stringify(trainingConflicts))
}
// 6c. lane_count STILL genuinely caps fixture-vs-fixture capacity (unchanged, pre-existing behaviour) -- proves the fix didn't accidentally weaken fixture capacity semantics.
{
  const f1 = fixture({ fixtureId: "f1", pitchId: "pitch-c", kickoffTime: "14:00", durationMinutes: 40 })
  const f2 = fixture({ fixtureId: "f2", pitchId: "pitch-c", kickoffTime: "14:00", durationMinutes: 40 })
  const f3 = fixture({ fixtureId: "f3", pitchId: "pitch-c", kickoffTime: "14:00", durationMinutes: 40 })
  const { fixtureConflicts } = detectResourceConflicts([f1, f2, f3], [], pitches, { warmUpMinutes: 0, packUpMinutes: 0 })
  checkTrue("6c: a lane_count=2 pitch still allows exactly 2 simultaneous fixtures with zero conflicts", !fixtureConflicts.some((c) => c.fixtureId === "f1") && !fixtureConflicts.some((c) => c.fixtureId === "f2"))
  checkTrue("6c: the 3rd simultaneous fixture beyond lane_count=2 is still flagged (fixture capacity unchanged by this fix)", fixtureConflicts.some((c) => c.fixtureId === "f3"), JSON.stringify(fixtureConflicts))
}

// 7. Unallocated training (no pitch/time) remains visible as needing review.
{
  const t = training({ trainingSessionId: "t1", pitchId: null, startTime: null, durationMinutes: null })
  checkTrue("7: a training session with no pitch/time needs allocation review", trainingNeedsAllocationReview(t, []))
}

// 8. A training session overlapping a real fixture still needs allocation review (the shared-pitch rule only removes training-vs-training conflicts, not genuine fixture-vs-training ones).
{
  const f = fixture({ fixtureId: "f1", pitchId: "pitch-a", kickoffTime: "18:00", durationMinutes: 80 })
  const t = training({ trainingSessionId: "t1", pitchId: "pitch-a", startTime: "18:15", durationMinutes: 60 })
  const { trainingConflicts } = detectResourceConflicts([f], [t], pitches)
  checkTrue("8: a training session with a preferred pitch assigned but a genuine fixture conflict still needs allocation review, not silently treated as booked", trainingNeedsAllocationReview(t, trainingConflicts))
}

// 9. Cancelled training never occupies a pitch (and, per the shared-pitch rule, wouldn't conflict with other training anyway -- this proves it's excluded from fixture-side checks too).
{
  const f = fixture({ fixtureId: "f1", pitchId: "pitch-a", kickoffTime: "18:30", durationMinutes: 80 })
  const t1 = training({ trainingSessionId: "t1", pitchId: "pitch-a", startTime: "18:00", durationMinutes: 90, status: "CANCELLED" })
  const { fixtureConflicts } = detectResourceConflicts([f], [t1], pitches)
  checkTrue("9: a cancelled training session does not generate or receive a conflict, and does not cause a fixture to be flagged either", fixtureConflicts.length === 0, JSON.stringify(fixtureConflicts))
}

// 10. Card title: no opponent, no home/away wording (Section 28/33).
checkTrue('10: training card title format is "<Team> — Planned Training"', trainingCardTitle("Burnley U12") === "Burnley U12 — Planned Training")

console.log(`\n${pass} PASS, ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
