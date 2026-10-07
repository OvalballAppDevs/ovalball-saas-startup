import { test } from "node:test"
import assert from "node:assert/strict"

import { formatHasBracket } from "@ovalball/contracts/tournaments/knockout"
import { formatHasStandings } from "@ovalball/contracts/tournaments/standings"
import {
  agendaIsKnockout,
  agendaRoundGroups,
  agendaTables,
  type ParticipantGame,
  type ParticipantPairing,
} from "@ovalball/contracts/tournaments/participant-centre"
import { resultStatusExplanation, type TournamentGameResult } from "@ovalball/contracts/tournaments/results"
import { projectParticipantTournament, type AgendaItem, type FamilyProjection } from "@ovalball/contracts"

/**
 * THE SAME TOURNAMENT PRODUCT, WHICHEVER FORMAT IT IS.
 *
 * The server side of that promise is pinned in `tournament_knockout_parity.sql`. What lives here is the
 * part a database cannot see: the handful of places where a CLIENT chooses what to draw from the
 * format, and where getting it wrong produces a second product rather than an error.
 *
 * Three of those choices, and the failure each one prevents:
 *
 *   THE TABS. A league has a Table and a cup has a Draw. A Centre that offered both would give every
 *   knockout an empty Tables tab -- a structure the organiser did not choose, drawn as though they had
 *   -- and a round robin a Draw tab that can only ever say "no draw yet".
 *
 *   THE AGENDA'S GROUPING. A round robin's games are placed by table and round, which is what its
 *   Agenda groups by; a knockout has neither, and a parent at a cup reading "Round 1" has been told the
 *   one thing nobody at the ground will say. The day above and the game row below are shared.
 *
 *   WHAT A SETTLED SCORE DOES. In a league it moves a table. In a cup it sends one side home. Telling
 *   a cup's parents their score "counts towards the table" describes a table that does not exist.
 *
 * Everything else about these surfaces is deliberately NOT format-aware, and the absence is asserted
 * where it is cheap to assert, because a format flag that spreads is how one product becomes two.
 */

/* ------------------------------------------------------------------ tabs: Draw replaces Tables */

test("a knockout has a Draw and no Table; a round robin has a Table and no Draw", () => {
  assert.equal(formatHasBracket("knockout"), true)
  assert.equal(formatHasStandings("knockout"), false)

  assert.equal(formatHasBracket("round_robin"), false)
  assert.equal(formatHasStandings("round_robin"), true)

  // NEVER BOTH, for any format the product supports. A competition has one shape, and a tab offering
  // the other is a tab that can only ever be empty.
  for (const format of ["round_robin", "knockout", "swiss"]) {
    assert.equal(
      formatHasBracket(format) && formatHasStandings(format),
      false,
      `${format} offered both a Draw and a Table`
    )
  }
})

test("an unknown or missing format is not treated as a knockout", () => {
  // A tournament whose format has not been recorded must not acquire a bracket by default: drawing a
  // Draw tab for it would invite an organiser to arrange a competition they never chose.
  for (const format of [null, undefined, "", "something_new"]) {
    assert.equal(formatHasBracket(format), false, `${String(format)} was treated as a knockout`)
  }
})

/* ------------------------------------------------------------------ the Agenda's grouping */

function pg(over: Partial<ParticipantGame> = {}): ParticipantGame {
  const side = (id: string) => ({
    participantId: id,
    clubName: `${id} RUFC`,
    label: "U12",
    crestPath: null,
    score: null,
    isMine: false,
  })
  return {
    id: "g",
    gameDate: "2026-11-07",
    startTime: "10:00:00",
    durationMinutes: 20,
    pitchName: "Pitch 1",
    status: "SCHEDULED",
    tableName: null,
    round: 1,
    roundName: null,
    sideA: side("a"),
    sideB: side("b"),
    ...over,
  }
}

function pair(over: Partial<ParticipantPairing> = {}): ParticipantPairing {
  return {
    pairingId: "p",
    gameDate: "2026-11-08",
    startTime: "15:00:00",
    pitchName: "Pitch 1",
    roundName: "Semi Final",
    sideALabel: "Winner QF1",
    sideBLabel: "Winner QF2",
    ...over,
  }
}

test("a knockout's day is grouped by what the sport calls the round, not by its number", () => {
  const groups = agendaRoundGroups([
    pg({ id: "1", roundName: "Quarter Final", round: 1 }),
    pg({ id: "2", roundName: "Quarter Final", round: 1 }),
    pg({ id: "3", roundName: "Semi Final", round: 2 }),
  ])
  assert.deepEqual(
    groups.map((g) => g.roundName),
    ["Quarter Final", "Semi Final"]
  )
  assert.deepEqual(groups[0]!.games.map((g) => g.id), ["1", "2"])
  // The order is the server's, which is the order the rounds are played in -- never re-sorted here.
  assert.deepEqual(groups[1]!.games.map((g) => g.id), ["3"])
})

test("a round robin is still grouped by table and round -- the shared path is untouched", () => {
  const tables = agendaTables([
    pg({ id: "1", tableName: "Table A", round: 1 }),
    pg({ id: "2", tableName: "Table B", round: 1 }),
    pg({ id: "3", tableName: "Table A", round: 2 }),
  ])
  assert.deepEqual(tables.map((t) => t.tableName), ["Table A", "Table B"])
  assert.deepEqual(tables[0]!.rounds.map((r) => r.round), [1, 2])
})

test("a competition is read as a knockout from its games OR from its scheduled places", () => {
  // THE SECOND CASE IS THE ONE THAT MATTERS. A published cup whose opening ties are all still to be
  // played has every round scheduled and not one game yet; an Agenda that decided the format from the
  // game list alone would draw that competition as an empty round robin.
  assert.equal(agendaIsKnockout([pg({ roundName: "Final" })], []), true)
  assert.equal(agendaIsKnockout([], [pair()]), true)
  assert.equal(agendaIsKnockout([pg({ tableName: "Table A" })], []), false)
  assert.equal(agendaIsKnockout([], []), false)
})

/* ------------------------------------------------------------------ what a settled score does */

function result(over: Partial<TournamentGameResult> = {}): TournamentGameResult {
  return {
    resultStatus: "final",
    roundName: null,
    kickedOff: true,
    resolvedAt: null,
    submittedBySideId: null,
    viewerSideId: null,
    ...over,
  } as unknown as TournamentGameResult
}

test("a knockout's result decides who goes through; a round robin's counts towards the table", () => {
  const cup = resultStatusExplanation(result({ roundName: "Quarter Final" }))
  const league = resultStatusExplanation(result({ roundName: null }))

  assert.match(cup, /decides who goes through/)
  assert.doesNotMatch(cup, /table/, "a cup has no table to count towards")

  assert.match(league, /counts towards the table/)
  assert.doesNotMatch(league, /goes through/)
})

test("every state of a knockout result describes the draw rather than a table", () => {
  const states: TournamentGameResult["resultStatus"][] = [
    "awaiting_confirmation",
    "final",
    "disputed",
    "external_recorded",
  ]
  for (const resultStatus of states) {
    const text = resultStatusExplanation(
      result({ resultStatus, roundName: "Semi Final", submittedBySideId: "me", viewerSideId: "me" })
    )
    assert.doesNotMatch(text, /table/, `"${resultStatus}" still mentions a table on a knockout`)
  }
})

test("a result's own wording is unchanged for a round robin", () => {
  // The knockout branch must not have moved the league's sentences. These are the ones that shipped.
  assert.equal(
    resultStatusExplanation(result({ resultStatus: "awaiting_confirmation", submittedBySideId: "me", viewerSideId: "me" })),
    "Your score is with the other side. It counts towards the table once they agree."
  )
  assert.equal(
    resultStatusExplanation(result({ resultStatus: "final" })),
    "Both sides agree this score, so it counts towards the table."
  )
  assert.equal(
    resultStatusExplanation(result({ resultStatus: "disputed" })),
    "The two sides gave different scores. The organiser will settle it, and nothing counts towards the table until they do."
  )
})

/* ------------------------------------------------------------------ the Calendar's format mark */

function agendaTournament(format: string | null): AgendaItem {
  return {
    key: "k",
    kind: "tournament",
    eventId: "t",
    date: "2026-11-07",
    time: "09:00",
    meetTime: null,
    us: { directoryId: null, clubName: "Ovalball UAT RUFC", teamName: "Under 12 Boys", compactName: "U12", rugbyCode: "union", crestUrl: null, kit: null },
    them: null,
    name: "Ovalball UAT Knockout Cup",
    tournament: {
      ageGroup: "U12",
      hostClubName: "Ovalball UAT RUFC",
      format,
      endTime: "17:00",
      cover: { kind: "none" },
    },
    dayOfSpan: { day: 1, of: 3 },
    homeAway: null,
    venue: "Ovalball UAT Ground",
    pitch: null,
    status: "confirmed",
    result: null,
    gameType: null,
    playerId: null,
    childFirstName: null,
    attendance: null,
    teamId: "team",
    clubId: "club",
    href: "/tournaments/t",
  } as unknown as AgendaItem
}

const NO_FAMILY = { members: [] } as unknown as FamilyProjection

test("a cup's Calendar card carries the format mark; a league's is untouched", () => {
  const cup = projectParticipantTournament(agendaTournament("knockout"), NO_FAMILY)
  const league = projectParticipantTournament(agendaTournament("round_robin"), NO_FAMILY)

  assert.equal(cup.knockout, true)
  assert.equal(cup.typeLine, "Knockout \u00b7 U12")

  assert.equal(league.knockout, false)
  assert.equal(league.typeLine, "Tournament \u00b7 U12")

  // THE REST OF THE CARD IS THE SAME CARD. Everything a parent reads to decide where to be on Saturday
  // is identical, because a cup day and a league day are the same kind of event -- the format changes
  // one icon's colour and one word, and nothing else.
  for (const key of ["title", "start", "end", "hostedBy", "venue", "day", "cancelled", "status"] as const) {
    assert.deepEqual(cup[key], league[key], `the format changed "${key}", which is not a format fact`)
  }
})

test("a tournament whose format was never recorded is drawn as a tournament, not a cup", () => {
  const unknown = projectParticipantTournament(agendaTournament(null), NO_FAMILY)
  assert.equal(unknown.knockout, false)
  assert.equal(unknown.typeLine, "Tournament \u00b7 U12")
})
