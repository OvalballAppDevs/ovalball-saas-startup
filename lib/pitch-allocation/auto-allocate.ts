import type { AllocationConflict, AllocationFixture, ClubSchedulingPolicy, PitchOption, ProposedPlacement } from "./types"

/**
 * Deterministic Auto-Allocate proposal algorithm (Section 41). Pure and
 * side-effect free -- no DB access, no AI/LLM inference (Section 41: "Use
 * deterministic allocation... The result should be deterministic and
 * testable") -- see auto-allocate.verify.ts for the permanent regression
 * suite this pass added. Never mutates a canonical fixture itself; the
 * caller (createPitchAllocationProposal in actions.ts) persists the
 * result as a pitch_allocation_proposal_items row, and only
 * applyPitchAllocationProposal() later turns an accepted proposal into
 * real update_fixture_pitch()/update_fixture_kickoff() calls.
 */

const ACTIVE_STATUSES = new Set(["Planned", "Booked", "To Be Determined"])

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number)
  return h * 60 + m
}
function minutesToTime(m: number): string {
  const h = Math.floor(m / 60)
    .toString()
    .padStart(2, "0")
  const mm = (m % 60).toString().padStart(2, "0")
  return `${h}:${mm}`
}

/** U6-U16 by real numeric age where known; falls back to category="youth" only when ageGroup can't be parsed (e.g. a group-owned fixture's opponent-side label) -- never inferred from anything else. */
function isMiniJuniorAge(fixture: Pick<AllocationFixture, "category" | "ageGroup">): boolean {
  const match = fixture.ageGroup?.match(/^U(\d+)/i)
  if (match) return Number(match[1]) <= 16
  return fixture.category === "youth"
}

interface PreferenceBand {
  start: number
  end: number
}

/**
 * Section 32-36 (Auto-Allocation age preference bug fix): a deterministic,
 * TESTABLE, ordered list of preference bands -- never scattered "if U12
 * then 10am" logic. The allocator tries band 0 across every suitable
 * pitch first; only once band 0 is genuinely exhausted does it fall
 * through to band 1, and so on. A club SCHEDULING PREFERENCE, never
 * presented as governing-body law (fixture_scheduling_rules, not this
 * function, is where a real regulatory constraint would live).
 *
 * Weekend U6-U16 ("mini/junior"): morning preferred, an early-afternoon
 * band as the first fallback, and -- only as a genuine last resort, never
 * silently -- a late band extending toward evening. Using that last band
 * is exactly the "U12 auto-allocated to 6pm" bug this fixes: it can still
 * happen if literally nothing earlier is free, but the caller is told
 * why via a warning conflict on the placement (Section 35), never left to
 * look like an ordinary, unremarkable allocation.
 *
 * Weekend Colts/Senior/Girls/Women: afternoon preferred, unchanged from
 * the previous single-window behaviour -- no bug was reported here, so no
 * new fallback band was invented for it.
 */
function preferenceBands(fixture: Pick<AllocationFixture, "category" | "ageGroup">, policy: ClubSchedulingPolicy, isWeekend: boolean): PreferenceBand[] {
  if (!isWeekend) {
    return [{ start: timeToMinutes(policy.weekdayEarliestKickoff), end: timeToMinutes("22:00") }]
  }
  if (isMiniJuniorAge(fixture)) {
    const earliest = timeToMinutes(policy.weekendYouthEarliest)
    const latest = timeToMinutes(policy.weekendYouthLatest)
    const morningCutoff = Math.min(latest, timeToMinutes("12:00"))
    const bands: PreferenceBand[] = []
    if (morningCutoff > earliest) bands.push({ start: earliest, end: morningCutoff })
    if (latest > morningCutoff) bands.push({ start: morningCutoff, end: latest })
    // Last-resort band -- deliberately wide (through to a normal club
    // "day ends by" bound) so the algorithm can still place the fixture
    // somewhere rather than leaving it unallocated, but ANY slot found
    // here gets a warning conflict attached (see the caller below).
    bands.push({ start: latest, end: timeToMinutes("20:00") })
    return bands
  }
  return [{ start: timeToMinutes(policy.weekendSeniorEarliest), end: timeToMinutes(policy.weekendSeniorLatest) }]
}

/** mini fits only mini pitches; reduced fits reduced or full; full fits only full -- a smaller pitch is never substituted for a fixture that needs more room (Section 45: HARD BLOCK, safety-adjacent). */
export function pitchSuitable(pitch: PitchOption, required: AllocationFixture["requiredPitchSize"]): boolean {
  if (!pitch.active) return false
  if (!required || !pitch.sizeCategory) return true // unclassified either side -- permissive, never a fabricated block
  if (required === "mini") return pitch.sizeCategory === "mini"
  if (required === "reduced") return pitch.sizeCategory === "reduced" || pitch.sizeCategory === "full"
  return pitch.sizeCategory === "full"
}

/**
 * Section 3: a fixture in the Unallocated tray must ALWAYS show an
 * explicit reason it isn't on the board yet -- never just a blank
 * "--:--" card the user has to infer. Pure and reused by both the board
 * UI and (if needed later) any accounting/summary surface, so the
 * wording never has to be kept in sync by hand across call sites.
 */
export function unallocatedReason(fixture: AllocationFixture, pitches: PitchOption[]): string {
  const hasSuitablePitch = pitches.some((p) => pitchSuitable(p, fixture.requiredPitchSize))
  if (!hasSuitablePitch) {
    return `No active pitch matches this fixture's required size (${fixture.requiredPitchSize ?? "unknown"}) yet.`
  }
  if (!fixture.pitchId && !fixture.kickoffTime) return "No pitch or kick-off time assigned yet -- run Auto Allocate or set both manually."
  if (!fixture.pitchId) return "Kick-off time is set but no pitch is assigned yet."
  return "Pitch is assigned but no kick-off time is set yet."
}

interface Booking {
  pitchId: string
  start: number
  end: number
}

export interface AutoAllocateResult {
  placements: ProposedPlacement[]
  conflicts: AllocationConflict[]
}

export function autoAllocate(
  fixtures: AllocationFixture[],
  pitches: PitchOption[],
  policy: ClubSchedulingPolicy,
  proposalDateIso: string,
  existingBookings: Booking[] = []
): AutoAllocateResult {
  const isWeekend = [0, 6].includes(new Date(`${proposalDateIso}T00:00:00`).getDay())
  const activePitches = pitches.filter((p) => p.active)
  const bookings = [...existingBookings]
  const placements: ProposedPlacement[] = []
  const conflicts: AllocationConflict[] = []

  // Cancelled fixtures never occupy pitch time (Section 46).
  const eligible = fixtures.filter((f) => ACTIVE_STATUSES.has(f.status))

  // Harder-to-place first: fewest suitable pitches, then longest duration.
  const suitableCount = (f: AllocationFixture) => activePitches.filter((p) => pitchSuitable(p, f.requiredPitchSize)).length
  const sorted = [...eligible].sort((a, b) => {
    const countDiff = suitableCount(a) - suitableCount(b)
    if (countDiff !== 0) return countDiff
    return (b.durationMinutes ?? 60) - (a.durationMinutes ?? 60)
  })

  for (const fixture of sorted) {
    const duration = fixture.durationMinutes ?? 60 // Section 34: flagged, never silently invented -- durationConfidence carries the flag through to the UI.
    const bands = preferenceBands(fixture, policy, isWeekend)
    const candidatePitches = activePitches.filter((p) => pitchSuitable(p, fixture.requiredPitchSize))

    if (candidatePitches.length === 0) {
      const reason = `No active pitch matches this fixture's required size (${fixture.requiredPitchSize ?? "unknown"}).`
      conflicts.push({ fixtureId: fixture.fixtureId, severity: "hard", reason })
      placements.push({ fixtureId: fixture.fixtureId, pitchId: null, kickoffTime: null, conflict: { fixtureId: fixture.fixtureId, severity: "hard", reason } })
      continue
    }

    let placed = false
    // Section 35/36: try each preference band in order -- band 0
    // (morning, for a mini/junior weekend fixture) across every suitable
    // pitch before EVER considering band 1 (early afternoon), and band 1
    // fully before band 2 (the late last-resort band). A slot found in
    // any band after the first is real, but the placement carries an
    // explicit warning explaining why -- never a silent, unremarkable
    // late kickoff for a young age group.
    for (let bandIndex = 0; bandIndex < bands.length && !placed; bandIndex++) {
      const band = bands[bandIndex]
      for (const pitch of candidatePitches) {
        for (let slotStart = band.start; slotStart + duration <= band.end; slotStart += 15) {
          // Section 31-40: the pitch is occupied from warm-up before kickoff
          // through pack-up after the final whistle -- that whole window,
          // not just the play duration, is what must clear against every
          // other booking on this pitch. turnaroundMinutes is a SEPARATE,
          // additional gap required between two different fixtures (kept
          // exactly as before), stacked on top of this fixture's own
          // pack-up rather than replacing it, so the two settings are never
          // double-counted into one one number.
          const occupiedStart = slotStart - policy.warmUpMinutes
          const occupiedEnd = slotStart + duration + policy.packUpMinutes + policy.turnaroundMinutes
          // Section 41-47: a pitch with lane_count > 1 can genuinely host
          // more than one fixture in the same overlapping window (e.g. a
          // full pitch marked out for simultaneous mini games) -- so a slot
          // is only rejected once the number of ALREADY-overlapping
          // bookings on this pitch would meet or exceed its real capacity,
          // not on the first overlap.
          const overlapCount = bookings.filter((b) => b.pitchId === pitch.id && occupiedStart < b.end && occupiedEnd > b.start).length
          if (overlapCount >= pitch.laneCount) continue
          bookings.push({ pitchId: pitch.id, start: occupiedStart, end: occupiedEnd })
          // Only the FINAL band (the late last-resort one) is ever flagged
          // -- the early-afternoon fallback (band 1, still a genuinely
          // acceptable weekend slot per Section 33) is a normal,
          // unremarkable placement, never a warning.
          const lateSlotConflict: AllocationConflict | null =
            bandIndex === bands.length - 1 && bands.length > 1 && isMiniJuniorAge(fixture)
              ? {
                  fixtureId: fixture.fixtureId,
                  severity: "warning",
                  reason: `Allocated at ${minutesToTime(slotStart)} because no valid morning slot was available for this age group.`,
                }
              : null
          if (lateSlotConflict) conflicts.push(lateSlotConflict)
          placements.push({ fixtureId: fixture.fixtureId, pitchId: pitch.id, kickoffTime: minutesToTime(slotStart), conflict: lateSlotConflict })
          placed = true
          break
        }
        if (placed) break
      }
    }

    if (!placed) {
      const reason = "No suitable pitch/time gap available within the club's preferred window for this fixture's age group."
      conflicts.push({ fixtureId: fixture.fixtureId, severity: "warning", reason })
      placements.push({ fixtureId: fixture.fixtureId, pitchId: null, kickoffTime: null, conflict: { fixtureId: fixture.fixtureId, severity: "warning", reason } })
    }
  }

  return { placements, conflicts }
}

/**
 * Section 71-73: the ONE place that decides whether an eligible home
 * fixture counts as "allocated" (real pitch + real kick-off time) or
 * "unallocated" -- a plain filter on the same predicate and its negation,
 * so every input fixture lands in EXACTLY one output array by
 * construction. Extracted out of data.ts so the invariant this guarantees
 * (allocated ∪ unallocated = the input, with no fixture missing or
 * duplicated) is enforced by the type system and covered by a permanent
 * regression test, rather than re-typed inline where a future edit could
 * silently drift the two branches apart.
 */
export function partitionAllocation(fixtures: AllocationFixture[]): { allocated: AllocationFixture[]; unallocated: AllocationFixture[] } {
  const allocated = fixtures.filter((f) => f.pitchId && f.kickoffTime)
  const unallocated = fixtures.filter((f) => !f.pitchId || !f.kickoffTime)
  return { allocated, unallocated }
}

/**
 * Section 44: detect overlap/suitability conflicts in an ALREADY-PLACED
 * board (used both to flag the live board's existing state and to
 * re-check a manual drag before it's applied). `buffers` is optional
 * (defaults to no buffer) so existing callers/tests that don't care about
 * warm-up/pack-up keep working unchanged; the board's own callers always
 * pass the club's real policy.
 */
export function detectConflicts(
  fixtures: AllocationFixture[],
  pitches: PitchOption[],
  buffers: { warmUpMinutes: number; packUpMinutes: number } = { warmUpMinutes: 0, packUpMinutes: 0 }
): AllocationConflict[] {
  const conflicts: AllocationConflict[] = []
  const byPitch = new Map<string, AllocationFixture[]>()
  for (const f of fixtures) {
    if (!f.pitchId || !f.kickoffTime) continue
    const list = byPitch.get(f.pitchId) ?? []
    list.push(f)
    byPitch.set(f.pitchId, list)
  }
  for (const [pitchId, list] of byPitch) {
    const pitch = pitches.find((p) => p.id === pitchId)
    for (const f of list) {
      if (pitch && !pitchSuitable(pitch, f.requiredPitchSize)) {
        conflicts.push({ fixtureId: f.fixtureId, severity: "hard", reason: `${pitch.displayName} does not meet this fixture's required pitch size (${f.requiredPitchSize ?? "unknown"}).` })
      }
      if (pitch && !pitch.active) {
        conflicts.push({ fixtureId: f.fixtureId, severity: "hard", reason: `${pitch.displayName} is no longer active.` })
      }
    }
    // Section 41-47: a capacity>1 pitch can genuinely host that many
    // fixtures at once (e.g. a full pitch marked out for simultaneous
    // mini games), so a bare 2nd overlapping fixture is no longer
    // automatically a conflict -- a classic sweep-line "how many
    // meetings are active right now" walk, generalizing the old adjacent-
    // pair check (which is exactly this sweep with laneCount fixed at 1).
    const laneCount = pitch?.laneCount ?? 1
    const windows = list.map((f) => ({
      fixture: f,
      // Section 31-40: warm-up before, pack-up after -- the real occupied window, not just the play duration.
      start: timeToMinutes(f.kickoffTime!) - buffers.warmUpMinutes,
      end: timeToMinutes(f.kickoffTime!) + (f.durationMinutes ?? 60) + buffers.packUpMinutes,
    }))
    const sorted = [...windows].sort((a, b) => a.start - b.start)
    const active: (typeof sorted)[number][] = []
    for (const w of sorted) {
      // Drop anything that's already finished by the time this one starts.
      for (let i = active.length - 1; i >= 0; i--) {
        if (active[i].end <= w.start) active.splice(i, 1)
      }
      active.push(w)
      if (active.length > laneCount) {
        const others = active.filter((a) => a !== w).map((a) => `${a.fixture.homeTeamLabel} v ${a.fixture.opponentLabel}`)
        const capacityNote = laneCount > 1 ? ` (this pitch's capacity is ${laneCount} at once)` : ""
        conflicts.push({
          fixtureId: w.fixture.fixtureId,
          severity: "hard",
          reason: `Overlaps with ${others.join(", ")} on the same pitch${capacityNote}, including warm-up/pack-up buffers.`,
        })
      }
    }
  }
  return conflicts
}
