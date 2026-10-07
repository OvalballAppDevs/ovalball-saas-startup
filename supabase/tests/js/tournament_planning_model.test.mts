import { test } from "node:test"
import assert from "node:assert/strict"

import {
  agendaDays,
  agendaTables,
  type ParticipantGame,
} from "@ovalball/contracts/tournaments/participant-centre"

import {
  defaultTableName,
  distribute,
  maxTables,
  planStatus,
  roundRobinGameCount,
  shuffled,
  suggestedTableSizes,
  tableGuidance,
  tableProblem,
  draftCompleteness,
  draftDayLabel,
  draftDays,
  gameWhen,
  gameWhere,
  regenerationWarning,
  type DraftGame,
  type TournamentPlan,
  type TournamentPlanDraft,
} from "@ovalball/contracts/tournaments/planning"

/**
 * THE ARITHMETIC AN ORGANISER IS SHOWN BEFORE ANYTHING IS GENERATED.
 *
 * The pairings themselves are produced in the database, by one function that both generating and
 * previewing call, and `tournament_planning.sql` proves those. What is checked here is the model the
 * four Planning steps reason with: how many games a configuration will produce, which configurations
 * are possible at all, and that moving teams around never loses one.
 */

test("a round robin table of n produces n(n-1)/2 games", () => {
  // The invariant, stated as the table it is: 3 sides 3 games, 4 sides 6, 5 sides 10, 6 sides 15.
  assert.equal(roundRobinGameCount([2]), 1)
  assert.equal(roundRobinGameCount([3]), 3)
  assert.equal(roundRobinGameCount([4]), 6)
  assert.equal(roundRobinGameCount([5]), 10)
  assert.equal(roundRobinGameCount([6]), 15)
  assert.equal(roundRobinGameCount([7]), 21)
  assert.equal(roundRobinGameCount([8]), 28)
  for (let n = 2; n <= 24; n++) {
    assert.equal(roundRobinGameCount([n]), (n * (n - 1)) / 2, `a table of ${n}`)
  }
})

test("a table with nobody to play produces no games, which is an answer rather than an error", () => {
  assert.equal(roundRobinGameCount([1]), 0)
  assert.equal(roundRobinGameCount([0]), 0)
})

test("games add up across tables", () => {
  // The owner's own worked examples: 8 teams in two tables of four is 12 games, not 28.
  assert.equal(roundRobinGameCount([4, 4]), 12)
  // Seven teams as 4 + 3 is 6 + 3.
  assert.equal(roundRobinGameCount([4, 3]), 9)
  // Eleven as 4 / 4 / 3.
  assert.equal(roundRobinGameCount([4, 4, 3]), 6 + 6 + 3)
})

test("splitting into more tables than the teams can fill is not offered", () => {
  // A table needs two sides to produce a game, so four teams make at most two tables -- never six.
  assert.equal(maxTables(4), 2)
  assert.equal(maxTables(8), 4)
  assert.equal(maxTables(11), 5)
  // One table is always possible, even for a competition with a single side.
  assert.equal(maxTables(1), 1)
  assert.equal(maxTables(0), 1)
})

test("the suggested split is as even as the arithmetic allows", () => {
  assert.deepEqual(suggestedTableSizes(8, 2), [4, 4])
  // The owner's worked example: eleven across three is 4 / 4 / 3, not 5 / 3 / 3.
  assert.deepEqual(suggestedTableSizes(11, 3), [4, 4, 3])
  assert.deepEqual(suggestedTableSizes(7, 2), [4, 3])
  assert.deepEqual(suggestedTableSizes(4, 1), [4])
  for (const [teams, tables] of [
    [8, 2],
    [11, 3],
    [7, 2],
    [13, 4],
  ] as const) {
    const sizes = suggestedTableSizes(teams, tables)
    assert.equal(sizes.length, tables)
    assert.equal(
      sizes.reduce((a, b) => a + b, 0),
      teams,
      `every team is in a table for ${teams}/${tables}`
    )
  }
})

test("the guidance says what will happen in the organiser's own numbers", () => {
  assert.match(tableGuidance(8, 2), /With 8 teams and 2 tables, each table will contain 4 teams/)
  assert.match(tableGuidance(11, 3), /Ovalball suggests 4, 4, 3/)
  // Singular and plural are not the same sentence.
  assert.match(tableGuidance(4, 1), /1 table/)
})

test("tables are named A, B, C by default and the name is never identity", () => {
  assert.equal(defaultTableName(0), "Table A")
  assert.equal(defaultTableName(1), "Table B")
  assert.equal(defaultTableName(2), "Table C")
})

test("distributing teams across tables keeps every one of them, exactly once", () => {
  const sides = ["a", "b", "c", "d", "e", "f", "g"]
  const tables = distribute(sides, suggestedTableSizes(sides.length, 2))
  assert.deepEqual(
    tables.flat().slice().sort(),
    sides.slice().sort(),
    "a team was lost or duplicated by the split"
  )
  assert.deepEqual(tables.map((t) => t.length), [4, 3])
})

test("randomising keeps every team -- it rearranges, it does not select", () => {
  const sides = Array.from({ length: 11 }, (_, i) => `side-${i}`)
  // A deterministic generator, so the assertion is about the permutation rather than about luck.
  let seed = 42
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  for (let run = 0; run < 50; run++) {
    const out = shuffled(sides, random)
    assert.equal(out.length, sides.length)
    assert.deepEqual(out.slice().sort(), sides.slice().sort(), "the shuffle lost or duplicated a team")
  }
})

test("an impossible arrangement is refused with the reason, before Review", () => {
  const sides = ["a", "b", "c", "d"]
  assert.equal(tableProblem([{ name: "Table A", sides }], sides.length), null)

  assert.match(
    tableProblem([{ name: "Table A", sides: ["a", "b"] }], 4) ?? "",
    /All 4 teams must be in a table. 2 are placed/
  )
  assert.match(
    tableProblem(
      [
        { name: "Table A", sides: ["a", "b", "c"] },
        { name: "Table B", sides: ["c", "d"] },
      ],
      4
    ) ?? "",
    /only be in one table/
  )
  assert.match(
    tableProblem(
      [
        { name: "Table A", sides: ["a", "b", "c"] },
        { name: "Table B", sides: ["d"] },
      ],
      4
    ) ?? "",
    /Table B needs at least 2 teams/
  )
})

test("the Planning tab's own state decides the control, so Start Planning is never the permanent CTA", () => {
  const base: TournamentPlan = {
    id: "p", publicationState: "DRAFT", version: 1, publishedAt: null,
    gameDurationMinutes: 20, changeoverMinutes: 15, dayStartTime: "09:00", dayEndTime: "13:00",
    pointsWin: 4, pointsDraw: 2, pointsLoss: 0, pointsTryBonus: 1, pointsLosingBonus: 1,
    days: ["2026-11-07"], tables: [], gameCount: 0,
    drawMethod: null, tieResolution: null, extraTimeMinutes: null, thirdPlacePlayoff: null, roundDays: [],
    // The fields the plan read has gained since this fixture was written; none of them bears on the status.
    standingsEnabled: true, standingsChoice: null, fieldSize: null, readiness: null,
  }

  const none = planStatus(null)
  assert.equal(none.kind, "none")
  assert.equal(none.title, "No plan created yet")
  assert.equal(none.cta, "Start Planning")

  const draft = planStatus({ ...base, gameCount: 12 })
  assert.equal(draft.kind, "draft")
  assert.equal(draft.cta, "Continue Planning")
  assert.match(draft.body, /Only you can see them until you publish/)

  // A draft with nothing generated says so rather than claiming games exist.
  assert.match(planStatus(base).body, /Nothing has been generated yet/)

  const published = planStatus({ ...base, publicationState: "PUBLISHED", gameCount: 12, publishedAt: "2026-10-01" })
  assert.equal(published.kind, "published")
  assert.equal(published.title, "Plan published")
  assert.equal(published.cta, "View Plan")
  assert.match(published.body, /12 games are published/)
})

/* ------------------------------------------------------------------ reading the generated draft */

const SIDE = { participantId: "p1", clubName: "Burnley RUFC", crestPath: null, label: "U12" }
const OTHER = { participantId: "p2", clubName: "Wigan Rugby Union FC", crestPath: null, label: "U12" }

function game(over: Partial<DraftGame> = {}): DraftGame {
  return {
    id: "g1", round: 1, date: "2026-11-07", startTime: "10:25:00", durationMinutes: 20,
    pitchName: "Pitch 2", sideA: SIDE, sideB: OTHER, ...over,
  }
}

test("a game with no time says so, rather than borrowing the first kick-off", () => {
  assert.equal(gameWhen(game()), "10:25")
  assert.equal(gameWhen(game({ startTime: null })), "Time not assigned")
  assert.equal(gameWhere(game()), "Pitch 2")
  assert.equal(gameWhere(game({ pitchName: null })), "Pitch not assigned")

  // THE SECONDS ARE NOT SHOWN. Postgres hands back "10:25:00"; nobody says a kick-off that way.
  assert.equal(gameWhen(game({ startTime: "09:00:00" })), "09:00")
})

test("the draft's completeness names what is missing, not what is present", () => {
  const base = {
    id: "plan", publicationState: "DRAFT" as const, version: 1, publishedAt: null,
    gameDurationMinutes: 20, days: ["2026-11-07"], gameCount: 12, scheduledCount: 12, pitchedCount: 12,
    // The sentence is the fallback for a plan the server returned no readiness for (20270720).
    readiness: null,
  }
  assert.match(draftCompleteness(base), /All 12 games have a time and a pitch/)

  // Nothing placed at all is the "no pitches reserved" case, and it says what to do about it.
  const none = draftCompleteness({ ...base, scheduledCount: 0, pitchedCount: 0 })
  assert.match(none, /12 games drawn/)
  assert.match(none, /reserve pitches/i)

  // Partly placed counts both sides of it, so the organiser knows how much is left.
  const some = draftCompleteness({ ...base, scheduledCount: 9, pitchedCount: 9 })
  assert.match(some, /9 of 12/)
  assert.match(some, /3 still need one/)

  assert.match(draftCompleteness({ ...base, gameCount: 0, scheduledCount: 0, pitchedCount: 0 }), /No games have been generated yet/)
})

test("the regeneration warning names the cost, and is only alarming when there is one", () => {
  const base = { publicationState: "DRAFT" as const, gameCount: 12, placedCount: 0, recordedResultCount: 0 }

  // Nothing to lose: this is the first generation, and it reads like one.
  assert.equal(regenerationWarning({ ...base, gameCount: 0 }), "This will draw the fixtures for every table.")

  // Machine-made pairings alone are worth one sentence and no drama.
  const plain = regenerationWarning(base)
  assert.match(plain, /replaces all 12 generated games/)
  assert.doesNotMatch(plain, /result/)

  // Games already placed are named, without claiming the organiser placed them: until manual
  // adjustment exists the generator did, and a warning about losing work nobody did is noise.
  assert.match(regenerationWarning({ ...base, placedCount: 4 }), /4 of their times and pitches will be drawn again/)
  assert.doesNotMatch(regenerationWarning({ ...base, placedCount: 4 }), /you set/)
  assert.match(regenerationWarning({ ...base, placedCount: 12 }), /Their times and pitches will be drawn again/)

  // And a recorded result outranks a placement: losing a score is the worse loss, and only one
  // sentence is shown, so it has to be that one.
  const scored = regenerationWarning({ ...base, placedCount: 4, recordedResultCount: 2 })
  assert.match(scored, /2 games have a recorded result/)
  assert.doesNotMatch(scored, /drawn again/)
})

/* ------------------------------------------------------------------ a draft that spans days */

function side(id: string, club: string, label: string) {
  return { participantId: id, clubName: club, crestPath: null, label }
}
function g(id: string, round: number, date: string | null, a: string, b: string): DraftGame {
  return {
    id, round, date, startTime: date ? "10:00:00" : null, durationMinutes: 20,
    pitchName: date ? "Pitch 1" : null, sideA: side(a, `${a} RUFC`, "U12"), sideB: side(b, `${b} RUFC`, "U12"),
  }
}
function draftOf(rounds: { round: number; games: DraftGame[] }[]): TournamentPlanDraft {
  return {
    tournamentId: "t", tournamentName: "Festival", ageGroup: "U12", venueName: null, format: "round_robin", preview: false,
    plan: {
      id: "p", publicationState: "DRAFT", version: 1, publishedAt: null, gameDurationMinutes: 20,
      days: ["2026-11-07", "2026-11-08"], gameCount: rounds.flatMap((r) => r.games).length,
      scheduledCount: 0, pitchedCount: 0, readiness: null,
    },
    tables: [{ id: "ta", name: "Table A", sides: [{ ...side("a", "A RUFC", "U12"), isHost: true }], rounds }],
  }
}

test("a single-day draft gets no day level at all", () => {
  const one = draftOf([{ round: 1, games: [g("1", 1, "2026-11-07", "a", "b")] }])
  const days = draftDays(one)
  assert.equal(days.length, 1)
  // The one group carries the tables untouched, so a one-day plan renders exactly as it did before.
  assert.equal(days[0]!.tables, one.tables)
})

test("a weekend draft splits by day, and a table appears under each day it plays", () => {
  const weekend = draftOf([
    { round: 1, games: [g("1", 1, "2026-11-07", "a", "b")] },
    { round: 2, games: [g("2", 2, "2026-11-07", "c", "d")] },
    { round: 3, games: [g("3", 3, "2026-11-08", "a", "c")] },
  ])
  const days = draftDays(weekend)
  assert.deepEqual(days.map((d) => d.date), ["2026-11-07", "2026-11-08"])

  // Saturday holds Rounds 1 and 2; Sunday holds Round 3 -- and a round with no games that day is
  // dropped rather than drawn empty.
  assert.deepEqual(days[0]!.tables[0]!.rounds.map((r) => r.round), [1, 2])
  assert.deepEqual(days[1]!.tables[0]!.rounds.map((r) => r.round), [3])

  // THE TABLE'S MEMBERSHIP TRAVELS WITH IT. Sunday's page is unreadable without it.
  assert.equal(days[1]!.tables[0]!.sides.length, 1)
  assert.equal(days[1]!.tables[0]!.name, "Table A")

  // Nothing is lost or duplicated by the regrouping.
  const all = days.flatMap((d) => d.tables.flatMap((t) => t.rounds.flatMap((r) => r.games.map((x) => x.id))))
  assert.deepEqual(all.sort(), ["1", "2", "3"])
})

test("games with no day are kept, after the days that are decided", () => {
  const mixed = draftOf([
    { round: 1, games: [g("1", 1, "2026-11-08", "a", "b"), g("2", 1, null, "c", "d")] },
  ])
  const days = draftDays(mixed)
  assert.deepEqual(days.map((d) => d.date), ["2026-11-08", null])
  // And the undated group is named for what it is rather than guessing at a date.
  assert.equal(draftDayLabel(null), "Day not assigned")
  assert.equal(draftDayLabel("2026-11-07"), "Saturday 7 November")
})

/* ------------------------------------------------------------------ what a participant reads back */

function pg(over: Partial<ParticipantGame> = {}): ParticipantGame {
  const side = (id: string) => ({ participantId: id, clubName: `${id} RUFC`, label: "U12", crestPath: null, score: null, isMine: false })
  return {
    id: "g", gameDate: "2026-11-06", startTime: "18:00:00", durationMinutes: 40, pitchName: "Pitch 1",
    status: "SCHEDULED", tableName: "Table A", round: 1, roundName: null, sideA: side("a"), sideB: side("b"), ...over,
  }
}

test("the Agenda groups a day the way the organiser built it -- table, then round", () => {
  const groups = agendaTables([
    pg({ id: "1", tableName: "Table A", round: 1 }),
    pg({ id: "2", tableName: "Table B", round: 1 }),
    pg({ id: "3", tableName: "Table A", round: 2 }),
    pg({ id: "4", tableName: "Table A", round: 1 }),
  ])
  assert.deepEqual(groups.map((g) => g.tableName), ["Table A", "Table B"])
  assert.deepEqual(groups[0]!.rounds.map((r) => r.round), [1, 2])
  // Two games in Table A's Round 1, and nothing has been duplicated into another round.
  assert.deepEqual(groups[0]!.rounds[0]!.games.map((g) => g.id), ["1", "4"])
  assert.deepEqual(groups[0]!.rounds[1]!.games.map((g) => g.id), ["3"])
})

test("a hand-made game belongs to no table and is not filed under somebody else's", () => {
  const groups = agendaTables([
    pg({ id: "1", tableName: "Table A", round: 1 }),
    pg({ id: "loose", tableName: null, round: null }),
  ])
  assert.equal(groups.length, 2)
  // It sorts last, and keeps a null table and a null round rather than being given a plausible place.
  assert.equal(groups[1]!.tableName, null)
  assert.equal(groups[1]!.rounds[0]!.round, null)
})

test("the Agenda counts the competition's own days, not the tournament's span", () => {
  // A Friday-to-Sunday festival whose U12 competition plays Friday and Sunday: the Sunday is its
  // SECOND day, which is what the Calendar already calls it.
  const published = agendaDays(["2026-11-08", "2026-11-06"], "2026-11-06", "2026-11-08")
  assert.deepEqual(published, ["2026-11-06", "2026-11-08"])
  assert.equal(published.indexOf("2026-11-08") + 1, 2)

  // Until a plan is published there is nothing better than the tournament's own span, and the whole
  // span is used rather than guessing which days will be played.
  const unpublished = agendaDays([], "2026-11-06", "2026-11-08")
  assert.deepEqual(unpublished, ["2026-11-06", "2026-11-07", "2026-11-08"])
})
