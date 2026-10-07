import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { TOURNAMENT_FORMAT_LABELS, type TournamentFormat } from "@ovalball/contracts/club/tournaments"

import type { TournamentDraft } from "./create-context"
import { ageGroupsLabel, buildCreatePayload, daysLabel, tournamentDayCount, validateDraft } from "./create-payload"
import { teamCountForGrade, totalTeamCount } from "./teams-selection"

/**
 * CREATE TOURNAMENT -- STEP 4, REVIEW & CREATE.
 *
 * What Review claims and what actually gets sent have to be the same thing, and both have to be built
 * from the draft rather than typed in. The pins below are the ones a screenshot cannot prove: the
 * payload's shape, the order of the grades, what stops creation, and that the draft is cleared only
 * after the row exists.
 */

const SRC = new URL(".", import.meta.url).pathname
const REVIEW = `${SRC}../../app/(tabs)/admin/tournaments/new/review.tsx`
const CREATED = `${SRC}../../app/(tabs)/admin/tournaments/new/created.tsx`

function side(over: Partial<{ key: string; directoryId: string; clubName: string; clubId: string | null; crestUrl: string | null; teamId: string | null; label: string }> = {}) {
  return {
    key: "team:t1",
    directoryId: "dir-burnley",
    clubName: "Burnley RUFC",
    clubId: "dir-burnley",
    crestUrl: null,
    teamId: "t1",
    label: "Under 9 A",
    ...over,
  }
}

function draft(over: Partial<TournamentDraft> = {}): TournamentDraft {
  return {
    name: "Ribble Valley Minis Festival",
    startsOn: "2026-09-30",
    endsOn: null,
    startTime: "09:00",
    multiDay: false,
    format: "round_robin",
    swissRounds: null,
    visibility: "private",
    venueId: "venue-1",
    venueName: "Ovalball UAT Ground",
    venueAddress: "Belvedere Road, Burnley",
    notes: "",
    ageGroups: [
      { ageGroup: "U9", ourTeamIds: ["our-a", "our-b"], sides: [side()] },
      { ageGroup: "U12", ourTeamIds: ["our-c"], sides: [] },
    ],
    ...over,
  }
}

// ---------------------------------------------------------------------------
// COUNTS ARE COUNTED, NEVER TYPED.
// ---------------------------------------------------------------------------

test("per-grade and total team counts come from the draft", () => {
  const d = draft()
  assert.equal(teamCountForGrade(d.ageGroups[0]), 3, "two of ours plus one of Burnley's")
  assert.equal(teamCountForGrade(d.ageGroups[1]), 1)
  assert.equal(totalTeamCount(d.ageGroups), 4)
})

test("a club bringing three sides counts as three teams, not one club", () => {
  const d = draft({
    ageGroups: [
      {
        ageGroup: "U9",
        ourTeamIds: [],
        sides: [
          side({ key: "team:t1", teamId: "t1", label: "Under 9 A" }),
          side({ key: "team:t2", teamId: "t2", label: "Under 9 B" }),
          side({ key: "team:t3", teamId: "t3", label: "Under 9 C" }),
        ],
      },
    ],
  })
  assert.equal(totalTeamCount(d.ageGroups), 3)
})

test("days are inclusive, and one day is one day", () => {
  assert.equal(tournamentDayCount("2026-09-30", null), 1)
  assert.equal(tournamentDayCount("2026-09-30", "2026-09-30"), 1)
  assert.equal(tournamentDayCount("2026-09-30", "2026-10-02"), 3)
  assert.equal(daysLabel(1), "1 day")
  assert.equal(daysLabel(3), "3 days")
  assert.equal(ageGroupsLabel(1), "1 age group")
  assert.equal(ageGroupsLabel(4), "4 age groups")
})

// ---------------------------------------------------------------------------
// THE PAYLOAD.
// ---------------------------------------------------------------------------

test("grades go in canonical numeric order, so U9 precedes U10", () => {
  const d = draft({
    ageGroups: [
      { ageGroup: "U10", ourTeamIds: ["x"], sides: [] },
      { ageGroup: "U9", ourTeamIds: ["y"], sides: [] },
    ],
  })
  assert.deepEqual(buildCreatePayload(d, "club-1").p_age_groups, ["U9", "U10"])
})

test("every side carries the grade it is entered at", () => {
  const p = buildCreatePayload(draft(), "club-1")
  assert.deepEqual(p.p_participants, [
    { directory_id: "dir-burnley", club_name: "Burnley RUFC", team_id: "t1", age_group: "U9", squad_label: null },
  ])
  assert.deepEqual(p.p_our_team_ids, ["our-a", "our-b", "our-c"])
})

test("an Ovalball side sends its team and NO squad label; an external side the reverse", () => {
  const d = draft({
    ageGroups: [
      {
        ageGroup: "U12",
        ourTeamIds: [],
        sides: [
          side({ key: "team:t9", teamId: "t9", label: "Under 12 Boys" }),
          side({ key: "ext:pending:clitheroe juniors:under 12", directoryId: "pending:clitheroe juniors", clubName: "Clitheroe Juniors", clubId: null, teamId: null, label: "Under 12" }),
        ],
      },
    ],
  })
  const p = buildCreatePayload(d, "club-1")
  assert.deepEqual(p.p_participants[0], { directory_id: "dir-burnley", club_name: "Burnley RUFC", team_id: "t9", age_group: "U12", squad_label: null })
  // THE INVENTED KEY IS NOT SENT AS A DIRECTORY ID. It exists only to keep the screen's list unique;
  // sending it would point the participant row at a directory row that does not exist.
  assert.deepEqual(p.p_participants[1], { directory_id: null, club_name: "Clitheroe Juniors", team_id: null, age_group: "U12", squad_label: "Under 12" })
})

test("a one-day tournament sends no end date, and a multi-day one sends its own", () => {
  assert.equal(buildCreatePayload(draft(), "c").p_ends_on, null)
  assert.equal(buildCreatePayload(draft({ multiDay: true, endsOn: "2026-10-02" }), "c").p_ends_on, "2026-10-02")
  // A stale end date left behind by switching multi-day off must not travel.
  assert.equal(buildCreatePayload(draft({ multiDay: false, endsOn: "2026-10-02" }), "c").p_ends_on, null)
})

test("the payload carries the visibility and format the organiser chose", () => {
  const p = buildCreatePayload(draft({ visibility: "public", format: "hybrid" }), "c")
  assert.equal(p.p_visibility, "public")
  assert.equal(p.p_format, "hybrid")
})

// ---------------------------------------------------------------------------
// WHAT STOPS CREATION, AND WHERE IT SENDS YOU.
// ---------------------------------------------------------------------------

test("a complete draft has nothing wrong with it", () => {
  assert.deepEqual(validateDraft(draft()), [])
})

test("each problem names the step that fixes it", () => {
  assert.deepEqual(validateDraft(draft({ name: " " }))[0], { step: "basics", message: "The tournament needs a name." })
  assert.deepEqual(validateDraft(draft({ venueId: null }))[0], { step: "basics", message: "The tournament needs a venue." })
  assert.deepEqual(validateDraft(draft({ multiDay: true, endsOn: null }))[0], { step: "basics", message: "A multi-day tournament needs an end date." })
  assert.deepEqual(validateDraft(draft({ ageGroups: [] })), [
    { step: "ageGroups", message: "Select at least one age group." },
  ])
})

test("an end date before the start is refused", () => {
  const p = validateDraft(draft({ multiDay: true, startsOn: "2026-09-30", endsOn: "2026-09-28" }))
  assert.ok(p.some((x) => x.message === "The end date is before the start date."))
})

test("a competition with nobody in it is named", () => {
  const one = validateDraft(draft({ ageGroups: [{ ageGroup: "U9", ourTeamIds: [], sides: [] }] }))
  assert.deepEqual(one, [{ step: "teams", message: "U9 has no teams." }])
  const two = validateDraft(draft({ ageGroups: [{ ageGroup: "U9", ourTeamIds: [], sides: [] }, { ageGroup: "U12", ourTeamIds: [], sides: [] }] }))
  assert.deepEqual(two, [{ step: "teams", message: "U9 and U12 have no teams." }])
})

test("a duplicate side is caught before it reaches the database", () => {
  const dup = side()
  const p = validateDraft(draft({ ageGroups: [{ ageGroup: "U9", ourTeamIds: [], sides: [dup, { ...dup }] }] }))
  assert.ok(p.some((x) => x.step === "teams" && x.message.includes("twice")))
})

test("problems come back earliest-step-first", () => {
  const p = validateDraft(draft({ name: "", ageGroups: [{ ageGroup: "U9", ourTeamIds: [], sides: [] }] }))
  assert.equal(p[0].step, "basics")
  assert.equal(p[p.length - 1].step, "teams")
})

// ---------------------------------------------------------------------------
// CREATION IS ONE CALL, AND SUCCESS IS NOT A PROMISE.
// ---------------------------------------------------------------------------

test("Review creates through ONE transactional RPC, never a sequence of writes", () => {
  const src = readFileSync(REVIEW, "utf8")
  assert.match(src, /supabase\.rpc\("create_tournament_with_teams"/)
  const calls = src.match(/supabase\.rpc\(/g) ?? []
  assert.equal(calls.length, 1, "a second write call here is a half-created tournament waiting to happen")
  assert.ok(!/\.insert\(|\.upsert\(|\.delete\(/.test(src), "Review must not write tables directly")
  assert.ok(!/save_tournament|set_tournament_age_groups|add_tournament_/.test(src), "the step-by-step path must not be used")
})

test("a failure keeps the organiser on Review with the draft intact", () => {
  const src = readFileSync(REVIEW, "utf8")
  const create = src.slice(src.indexOf("const create ="), src.indexOf("const FORMAT_ICON"))
  // The error branch returns before reset() and before any navigation.
  const errIdx = create.indexOf("if (error || !data)")
  const resetIdx = create.indexOf("reset()")
  assert.ok(errIdx > -1 && resetIdx > errIdx, "the draft must only be cleared after success")
  assert.match(create, /setFailure\(/)
  assert.ok(!create.slice(errIdx, resetIdx).includes("router."), "a failed create must not navigate")
})

test("the draft is reset on success, so Create Another starts empty", () => {
  const review = readFileSync(REVIEW, "utf8")
  assert.match(review, /reset\(\)/)
  const created = readFileSync(CREATED, "utf8")
  assert.match(created, /reset\(\)/, "Create Another Tournament clears the draft too")
})

test("the success screen reads the tournament back rather than trusting the draft", () => {
  const src = readFileSync(CREATED, "utf8")
  assert.match(src, /\.from\("tournaments"\)/)
  assert.match(src, /useLocalSearchParams/)
  // Counting rows that exist, not the draft that asked for them.
  assert.match(src, /tournament_team_entries/)
  assert.match(src, /tournament_participants/)
})

test("neither screen shows an invitation, an acceptance or a pending state", () => {
  for (const file of [REVIEW, CREATED]) {
    const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    for (const word of ["Pending", "Accept", "Decline", "invite_tournament_participant"]) {
      assert.ok(!code.includes(word), `${file} must not contain "${word}"`)
    }
  }
})

test("Review states the participation rule in the organiser's own words", () => {
  const src = readFileSync(REVIEW, "utf8")
  assert.match(src, /Ovalball clubs are added directly to the tournament\./)
  assert.match(src, /No invitations are required\./)
})

test("nothing here schedules anything -- planning is a later decision", () => {
  for (const file of [REVIEW, CREATED]) {
    const src = readFileSync(file, "utf8")
    assert.ok(!/tournament_games|reserve_tournament_pitch|save_tournament_game/.test(src), `${file} must not create fixtures or pitch reservations`)
  }
})

// ---------------------------------------------------------------------------------------------------
// SWISS CARRIES A ROUND COUNT, AND ONLY SWISS DOES.
//
// The database enforces this with a paired check constraint, so a draft that breaks it fails at the
// last moment with a constraint name. These assert the client says it first, in a sentence.
// ---------------------------------------------------------------------------------------------------

test("a swiss tournament without a round count is refused before it is sent", () => {
  const problems = validateDraft(draft({ format: "swiss", swissRounds: null }))
  assert.ok(problems.some((p) => p.step === "basics" && /Swiss/.test(p.message)), JSON.stringify(problems))
})

test("a swiss round count outside the allowed range is refused", () => {
  for (const n of [1, 13]) {
    const problems = validateDraft(draft({ format: "swiss", swissRounds: n }))
    assert.ok(problems.some((p) => p.step === "basics" && /Swiss/.test(p.message)), `rounds=${n}`)
  }
  assert.equal(validateDraft(draft({ format: "swiss", swissRounds: 5 })).length, 0)
})

test("the round count is sent for swiss and withheld from every other shape", () => {
  assert.equal(buildCreatePayload(draft({ format: "swiss", swissRounds: 6 }), "c").p_swiss_rounds, 6)
  // A draft that was swiss and is no longer must not smuggle the number through: the column is
  // forbidden to be set on any other shape.
  assert.equal(buildCreatePayload(draft({ format: "knockout", swissRounds: 6 }), "c").p_swiss_rounds, null)
})

test("every format the contract offers is accepted by the draft validator", () => {
  for (const f of Object.keys(TOURNAMENT_FORMAT_LABELS) as TournamentFormat[]) {
    const problems = validateDraft(draft({ format: f, swissRounds: f === "swiss" ? 4 : null }))
    assert.deepStrictEqual(problems, [], `${f} should be a valid shape`)
  }
})
