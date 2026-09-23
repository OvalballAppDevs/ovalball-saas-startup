/**
 * P4 — THE PARTICIPANT MATCH CARD, AS ONE MODEL AT TWO DENSITIES.
 *
 * A parent meets the same fixture in the Calendar, in Fixtures and in the Match
 * Centre, and it is one fixture. What differs is how much room there is to say it.
 * So the truth is resolved once by `projectParticipantMatch`, and this suite is
 * about that truth -- above all WHICH SIDE IS AT HOME, because a parent reads the
 * left-hand crest as the side playing at their own ground, and being shown the
 * wrong one is how somebody drives to the wrong place.
 *
 * Nothing here authorises anything: every value is copied from an `AgendaItem` the
 * server already returned under the viewer's own scope.
 */

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import {
  ATTENDANCE_STATE_WORDS,
  matchClassification,
  projectFamily,
  projectParticipantMatch,
  projectParticipantTraining,
  sideLabel,
  spokenSideLabel,
  type AgendaItem,
  type AgendaSide,
} from "@ovalball/contracts"

import { routeForAgendaItem } from "../../../apps/mobile/src/links/destinations"

const OURS: AgendaSide = {
  directoryId: "dir-1",
  clubName: "Ovalball UAT RUFC",
  teamName: "Under 12 Boys",
  compactName: "U12",
  rugbyCode: "union",
  crestUrl: "https://crest.example/ovalball.png",
  kit: null,
}
const THEIRS: AgendaSide = {
  directoryId: "dir-2",
  clubName: "Ashton Under Lyne RUFC",
  teamName: "Under 12 Boys",
  compactName: "U12",
  rugbyCode: "union",
  crestUrl: "https://crest.example/ashton.png",
  kit: null,
}

const CHILDREN = [
  { playerId: "p-1", firstName: "Ava", surname: "Whitaker", fullName: "Ava Whitaker", teamId: "t-1", teamName: "Under 12 Boys", clubId: "c-1", clubName: "Ovalball UAT RUFC", avatarStoragePath: "players/ava.jpg" },
  { playerId: "p-2", firstName: "George", surname: "Whitaker", fullName: "George Whitaker", teamId: "t-2", teamName: "Under 10 Boys", clubId: "c-1", clubName: "Ovalball UAT RUFC", avatarStoragePath: null },
]
const FAMILY = projectFamily(CHILDREN, new Map([["players/ava.jpg", "https://signed.example/ava"]]))

function match(overrides: Partial<AgendaItem> = {}): AgendaItem {
  return {
    key: "fx", kind: "fixture", eventId: "fx-1", date: "2026-09-25", time: "10:30", meetTime: "09:45",
    us: OURS, them: THEIRS, homeAway: "Away", venue: "Ashton Playing Fields", pitch: null,
    status: "Booked", result: null, playerId: "p-1", childFirstName: "Ava", attendance: "ATTENDING",
    teamId: "t-1", clubId: "c-1", href: null,
    ...overrides,
  } as AgendaItem
}

// ------------------------------------------------------- home and away truth

test("an away fixture puts the opposition on the left, because they are at home", () => {
  const card = projectParticipantMatch(match({ homeAway: "Away" }), FAMILY)
  assert.equal(card.home?.clubName, "Ashton Under Lyne RUFC")
  assert.equal(card.away?.clubName, "Ovalball UAT RUFC")
  assert.equal(card.away?.isOurs, true)
  assert.equal(card.ourOrientation, "Away")
})

test("a home fixture puts our side on the left", () => {
  const card = projectParticipantMatch(match({ homeAway: "Home" }), FAMILY)
  assert.equal(card.home?.clubName, "Ovalball UAT RUFC")
  assert.equal(card.home?.isOurs, true)
  assert.equal(card.away?.clubName, "Ashton Under Lyne RUFC")
  assert.equal(card.ourOrientation, "Home")
})

test("our team is NOT simply always on the left", () => {
  const home = projectParticipantMatch(match({ homeAway: "Home" }), FAMILY)
  const away = projectParticipantMatch(match({ homeAway: "Away" }), FAMILY)
  assert.notEqual(home.home?.clubName, away.home?.clubName, "the card ignores the canonical orientation")
})

test("an unsettled orientation claims nothing at all", () => {
  for (const homeAway of ["TBD", "Not Applicable", null] as const) {
    const card = projectParticipantMatch(match({ homeAway }), FAMILY)
    assert.equal(card.oriented, false, `${homeAway} was treated as a real orientation`)
    assert.equal(card.ourOrientation, null)
    // Both sides are still shown -- it is the CLAIM about whose ground it is that
    // is withheld, not the fixture.
    assert.equal(card.home?.isOurs, true)
    assert.equal(card.away?.clubName, "Ashton Under Lyne RUFC")
    assert.ok(!card.spoken.includes("Home for"), "an invented orientation is spoken")
  }
})

// --------------------------------------------------------- crest and naming

test("a missing opposition crest is a null, never a broken image or a kit", () => {
  const card = projectParticipantMatch(match({ them: { ...THEIRS, crestUrl: null } }), FAMILY)
  assert.equal(card.home?.crestUrl, null)
  // The card renders initials through the canonical ClubCrest, which has no
  // `fallback` prop -- so a kit cannot be passed where a crest belongs.
  const component = readFileSync("apps/mobile/src/components/participant/match-card.tsx", "utf8")
  assert.match(component, /<ClubCrest clubName=\{side\?\.clubName \?\? null\} url=\{side\?\.crestUrl \?\? null\}/)
  assert.ok(!/kit/i.test(component.replace(/\/\*[\s\S]*?\*\//g, "")), "the card reaches for a kit")
})

test("a side with no team behind it is named by its club", () => {
  const directoryOnly: AgendaSide = { ...THEIRS, teamName: null, rugbyCode: null, compactName: null }
  assert.equal(sideLabel({ clubName: directoryOnly.clubName, teamName: null, crestUrl: null, isOurs: false }), "Ashton Under Lyne RUFC")
})

test("an unconfirmed opposition is said, not left blank", () => {
  assert.equal(sideLabel(null), "To be confirmed")
})

test("a long opposition name is carried whole, for the component to wrap", () => {
  const long = "Stockport Rugby Union Football Club Under 12 Boys Development"
  const card = projectParticipantMatch(match({ them: { ...THEIRS, teamName: long } }), FAMILY)
  assert.equal(sideLabel(card.home), long, "a long name is truncated in the model rather than by the layout")
  const component = readFileSync("apps/mobile/src/components/participant/match-card.tsx", "utf8")
  assert.match(component, /numberOfLines=\{2\}/, "a long side name has no line limit to wrap within")
})

// ------------------------------------------------------------ classification

test("the classification is the canonical code and the canonical compact identity", () => {
  assert.equal(matchClassification(OURS), "Union · U12")
  assert.equal(matchClassification({ ...OURS, rugbyCode: "league" }), "League · U12")
})

test("nothing is fabricated where the canonical fields are absent", () => {
  // A Club Directory entry has no team row to ask which code it plays.
  assert.equal(matchClassification({ ...OURS, rugbyCode: null, compactName: null }), null)
  assert.equal(matchClassification({ ...OURS, rugbyCode: null }), "U12")
  assert.equal(matchClassification(null), null)
})

// ------------------------------------------------- KO, meet, venue, status

test("the practical facts are carried exactly, and absence stays absent", () => {
  const card = projectParticipantMatch(match(), FAMILY)
  assert.equal(card.kickoff, "10:30")
  assert.equal(card.meetTime, "09:45")
  assert.equal(card.venue, "Ashton Playing Fields")

  const bare = projectParticipantMatch(match({ time: null, meetTime: null, venue: null }), FAMILY)
  assert.equal(bare.kickoff, null, "a kick-off was invented")
  assert.equal(bare.meetTime, null, "a meet time was invented")
  assert.equal(bare.venue, null, "a venue was invented")
  assert.ok(!bare.spoken.includes("Meet"), "an absent meet time is still spoken")
})

test("a cancelled match says so, and does not present its kick-off as confirmed", () => {
  const card = projectParticipantMatch(match({ status: "Cancelled" }), FAMILY)
  assert.equal(card.cancelled, true)
  assert.equal(card.status, "Cancelled")
  assert.ok(card.spoken.includes("Cancelled."), "cancellation is not spoken")
  // Not colour alone: the card dims, writes the word, and says it aloud.
  const component = readFileSync("apps/mobile/src/components/participant/match-card.tsx", "utf8")
  assert.match(component, /opacity: cancelled \? 0\.72/)
  assert.match(component, /\{match\.status\}/)
})

test("a changed match uses the canonical status and no invented one", () => {
  const card = projectParticipantMatch(match({ status: "To Be Determined" }), FAMILY)
  assert.equal(card.status, "To Be Determined")
  assert.equal(card.cancelled, false)
  const model = readFileSync("packages/contracts/src/participant/match-card.ts", "utf8")
  assert.ok(!/"Changed"|"Moved"|"Rescheduled"/.test(model), "a change state was invented")
})

// ---------------------------------------------------- the child and the answer

test("the child comes from the projection, with their own picture and their own side", () => {
  const card = projectParticipantMatch(match({ playerId: "p-1" }), FAMILY)
  assert.equal(card.child?.shortLabel, "Ava")
  assert.equal(card.child?.avatarUrl, "https://signed.example/ava")
  assert.equal(card.child?.teamName, "Under 12 Boys")
})

test("one child's face cannot appear on another child's card", () => {
  const ava = projectParticipantMatch(match({ playerId: "p-1" }), FAMILY)
  const george = projectParticipantMatch(match({ playerId: "p-2" }), FAMILY)
  assert.equal(ava.child?.shortLabel, "Ava")
  assert.equal(george.child?.shortLabel, "George")
  assert.equal(george.child?.avatarUrl, null, "George has no photograph and must not borrow one")
  assert.equal(george.child?.initials, "GW")
  assert.notEqual(ava.child?.teamName, george.child?.teamName)
})

test("a row belonging to no child carries no child strip", () => {
  const card = projectParticipantMatch(match({ playerId: null }), FAMILY)
  assert.equal(card.child, null)
  const component = readFileSync("apps/mobile/src/components/participant/match-card.tsx", "utf8")
  assert.match(component, /if \(!child\) return null/, "an empty child strip is drawn")
})

test("an id outside the family draws no identity at all", () => {
  assert.equal(projectParticipantMatch(match({ playerId: "p-99" }), FAMILY).child, null)
})

test("every availability state uses the canonical register word", () => {
  for (const [state, word] of [
    ["ATTENDING", ATTENDANCE_STATE_WORDS.ATTENDING],
    ["CANNOT_ATTEND", ATTENDANCE_STATE_WORDS.CANNOT_ATTEND],
    ["UNSURE", ATTENDANCE_STATE_WORDS.UNSURE],
  ] as const) {
    const card = projectParticipantMatch(match({ attendance: state }), FAMILY)
    assert.equal(card.attendanceWord, word)
    assert.equal(card.answered, true)
    assert.ok(card.spoken.endsWith(`${word}.`), "the answer is not spoken")
  }
})

test("no answer yet is the canonical AWAITING word, not a fourth state", () => {
  const card = projectParticipantMatch(match({ attendance: null }), FAMILY)
  assert.equal(card.attendanceWord, ATTENDANCE_STATE_WORDS.AWAITING)
  assert.equal(card.answered, false)
})

test("the chip carries an icon and the word, never a colour alone", () => {
  const component = readFileSync("apps/mobile/src/components/participant/match-card.tsx", "utf8")
  assert.match(component, /const shape = attendanceStateShape\(attendance \?\? "AWAITING"\)/)
  assert.match(component, /<Icon size=\{14\}/)
  assert.match(component, /\{word\}/)
})

// ------------------------------------------------------------- spoken label

test("the whole card is one sentence, and VoiceOver never has to read a VS", () => {
  const card = projectParticipantMatch(match(), FAMILY)
  assert.equal(
    card.spoken,
    "Ava, Under 12 Boys. Ashton Under Lyne RUFC Under 12 Boys versus Ovalball UAT RUFC Under 12 Boys. Away for Ovalball UAT RUFC Under 12 Boys. Kick off 10:30. Meet 09:45. Ashton Playing Fields. Attending."
  )
})

test("two sides with the same team name are still told apart when read aloud", () => {
  // Both are "Under 12 Boys". Spoken as the team alone this would be "Under 12
  // Boys versus Under 12 Boys", which tells a blind parent nothing at all.
  const card = projectParticipantMatch(match(), FAMILY)
  assert.ok(card.spoken.includes("Ashton Under Lyne RUFC Under 12 Boys versus Ovalball UAT RUFC Under 12 Boys"))
})

test("a side whose team and club share a name is not said twice", () => {
  assert.equal(spokenSideLabel({ clubName: "Burnley RUFC", teamName: "Burnley RUFC", crestUrl: null, isOurs: false }), "Burnley RUFC")
  assert.equal(spokenSideLabel({ clubName: "Burnley RUFC", teamName: null, crestUrl: null, isOurs: false }), "Burnley RUFC")
  assert.equal(spokenSideLabel(null), "an opponent to be confirmed")
})

// ----------------------------------------------------------------- training

test("a training card has no opposition, and is never given a fake one", () => {
  const session = projectParticipantTraining(
    match({ kind: "training", them: null, homeAway: null, status: null, time: "18:00", venue: "Prairie Playing Fields", attendance: "UNSURE" }),
    FAMILY,
    "19:30"
  )
  assert.equal(session.title, "Training Session")
  assert.equal(session.start, "18:00")
  assert.equal(session.window, "18:00 – 19:30")
  assert.equal(session.venue, "Prairie Playing Fields")
  assert.equal(session.attendanceWord, ATTENDANCE_STATE_WORDS.UNSURE)
  assert.ok(!session.spoken.includes("versus"), "a session was given an opponent")
})

test("a session with no end shows no window rather than a dangling dash", () => {
  const session = projectParticipantTraining(match({ kind: "training", them: null, time: "18:00" }), FAMILY)
  assert.equal(session.window, null)
  assert.equal(session.start, "18:00")
})

// ------------------------------------------------------------- destinations

test("both cards go to the participant centres and nowhere else", () => {
  for (const kind of ["parent", "family", "player"] as const) {
    assert.deepEqual(routeForAgendaItem(match(), kind), {
      pathname: "/fixtures/[fixtureId]/match-centre",
      params: { fixtureId: "fx-1" },
    })
    assert.deepEqual(routeForAgendaItem(match({ kind: "training", eventId: "ts-1", them: null }), kind), {
      pathname: "/calendar/training/[sessionId]",
      params: { sessionId: "ts-1" },
    })
  }
})

test("nothing on the card is separately tappable, so the opposition stays informational", () => {
  const raw = readFileSync("apps/mobile/src/components/participant/match-card.tsx", "utf8")
  // One Pressable: the card. No crest, name, club or chip has a handler.
  assert.equal((raw.match(/<Pressable/g) ?? []).length, 1)
  assert.match(raw, /accessible=\{false\}/, "the crest column is exposed as its own element")
  // Prose explaining why something is absent must not be mistaken for the thing.
  const component = raw.replace(/\/\*[\s\S]*?\*\//g, "")
  for (const forbidden of ["openConversationWith", "Message", "Contact", "profile"]) {
    assert.ok(!component.includes(forbidden), `the card offers ${forbidden}`)
  }
})
