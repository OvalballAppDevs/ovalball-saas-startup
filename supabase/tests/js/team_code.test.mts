import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import {
  ageGradeWords,
  childRequestAnswered,
  childRequestSteps,
  interpretTeamCodeChoices,
  interpretTeamPlaceRequests,
  requestApprovalSentence,
  requestAskedLine,
  requestFitLine,
  teamCodeFitSentence,
  teamCodeOptions,
  teamCodeSubjectPayload,
  teamPlaceSentence,
} from "../../../packages/contracts/src/team/team-code"
import { familyAttentionItems, teamRequestHref } from "../../../packages/contracts/src/attention/family"
import { attentionStillOpen, notificationAttentionId, notificationAudience } from "../../../packages/contracts/src/notifications/feed"
import { notificationHref } from "../../../packages/contracts/src/notifications/destinations"
import { teamPlacePendingNote } from "../../../packages/contracts/src/invitations/redeem"

/**
 * TEAM CODES PLACE PLAYERS (20270741000000) -- the client half.
 *
 * The server decides who a code may be for, and every rule behind it is proved in
 * `supabase/tests/team_code_requests.sql`. This pins that both apps read its answers the same way and say
 * them in one set of words: the greyed row, the refusal, the approver's card and the parent's ask.
 */

const U14 = { label: "Under 14 Boys", ageGroup: "U14", gender: "boys", adultSide: false }
const M1 = { label: "Men's 1st Team", ageGroup: null, gender: "mens", adultSide: true }

test("a fit is said once, in the Team Directory's words", () => {
  assert.equal(ageGradeWords("U14"), "Under 14")
  assert.equal(teamCodeFitSentence("FITS", U14), null)
  assert.equal(teamCodeFitSentence("TOO_YOUNG", U14), "Too young for Under 14.")
  assert.equal(teamCodeFitSentence("TOO_OLD", U14), "Too old for Under 14.")
  assert.equal(teamCodeFitSentence("OTHER_PATHWAY", U14), "Under 14 Boys is a boys' side.")
  assert.equal(teamCodeFitSentence("OTHER_PATHWAY", M1), "Men's 1st Team is a men's side.")
  assert.equal(teamCodeFitSentence("UNDER_18", M1), "Adult sides are for players aged 18 and over.")
  assert.equal(teamCodeFitSentence("ADULT_OWN_ACCOUNT", U14), "Players aged 18 or over join with their own account.")
  assert.equal(teamCodeFitSentence("SOMETHING_NEW", U14), "Ovalball can't work out the age grade yet. Ask the club.", "an unknown verdict says less, never something wrong")
  assert.equal(teamPlaceSentence("ACTIVE", "Under 14 Boys"), "Already on Under 14 Boys.")
  assert.equal(teamPlaceSentence(null, "Under 14 Boys"), null)
  // A child's own request waits on a parent first: neither of them is told the team is deciding.
  assert.equal(teamPlaceSentence("PENDING", "Under 14 Boys"), "Already asked. The team will decide.")
  assert.equal(teamPlaceSentence("AWAITING", "Under 14 Boys"), "Already asked. Your parent or guardian confirms it first.")
  assert.equal(teamPlaceSentence("AWAITING", "Under 14 Boys", "child"), "Asked from their own account. Confirm it from your notifications.")
  // Used before, with no place now: shown greyed with why, never offered as if it could be sent again.
  assert.equal(teamPlaceSentence("USED", "Under 14 Boys"), "You've already used this code. To ask again, talk to the team.")
  assert.equal(teamPlaceSentence("USED", "Under 14 Boys", "child"), "You've already used this code for them. To ask again, talk to the team.")
})

test("a parent's answer is said in one set of words, and a team name is never made a clumsy possessive", () => {
  const jamie = { firstName: "Jamie", teamLabel: "Under 13 Boys" }
  assert.deepEqual(childRequestSteps(jamie), ["You confirm that Jamie asked.", "The team's staff decide.", "If they approve, Jamie joins Under 13 Boys."])
  assert.deepEqual(childRequestAnswered("confirmed", jamie), { title: "Confirmed", sentence: "The Under 13 Boys staff decide next. You and Jamie will both hear when they have." })
  assert.deepEqual(childRequestAnswered("declined", jamie), { title: "Declined", sentence: "Jamie has been told." })
  assert.doesNotMatch(childRequestAnswered("confirmed", jamie).sentence, /s's/, "Under 13 Boys's")
  for (const surface of ["apps/mobile/src/family/team-request.tsx", "app/(app)/parent/team-requests/request-card.tsx"]) {
    const source = readFileSync(surface, "utf8")
    assert.match(source, /childRequestAnswered\(done, request\)/, `${surface} says the answer in its own words`)
    assert.match(source, /childRequestSteps\(request\)/, `${surface} lists the steps in its own words`)
  }
})

test("a request still waiting on a parent is said to the child and to the parent as their own next step", () => {
  const choices = interpretTeamCodeChoices({
    team: { id: "t1", label: "Under 13 Boys", club_name: "Ovalball UAT RUFC", adult_side: false, age_group: "U13", gender: "boys" },
    me: { player_id: "p9", fit: "FITS", minor: true, established_adult: false, has_guardian: true, needs_details: false, place: "AWAITING" },
    children: [],
    member: { membership: null, requested: false },
  })
  assert.ok(choices)
  const me = teamCodeOptions(choices).find((o) => o.key === "me")
  assert.deepEqual(me && { description: me.description, disabled: me.disabled }, { description: "Already asked. Your parent or guardian confirms it first.", disabled: true })

  const parent = interpretTeamCodeChoices({
    team: { id: "t1", label: "Under 13 Boys", club_name: "Ovalball UAT RUFC", adult_side: false, age_group: "U13", gender: "boys" },
    me: { player_id: null, fit: null, minor: false, established_adult: true, has_guardian: false, needs_details: true, place: null },
    children: [{ player_id: "p9", first_name: "Jamie", surname: "Whitaker", birth_year: 2014, fit: "FITS", place: "AWAITING" }],
    member: { membership: null, requested: false },
  })
  assert.ok(parent)
  const jamie = teamCodeOptions(parent).find((o) => o.key === "child:p9")
  assert.deepEqual(jamie && { description: jamie.description, disabled: jamie.disabled }, { description: "Born 2014. Asked from their own account. Confirm it from your notifications.", disabled: true })
})

test("the choices are read as the server sent them, and nothing is read from a non-answer", () => {
  assert.equal(interpretTeamCodeChoices(null), null)
  assert.equal(interpretTeamCodeChoices({ team: {} }), null)
  const c = interpretTeamCodeChoices({
    team: { id: "t1", label: "Under 14 Boys", club_name: "Ovalball UAT RUFC", adult_side: false, age_group: "U14", gender: "boys" },
    me: { player_id: null, fit: null, minor: false, established_adult: true, has_guardian: false, needs_details: true, place: null },
    children: [
      { player_id: "p1", first_name: "Oliver", surname: "Smith", birth_year: 2019, fit: "TOO_YOUNG", place: null },
      { player_id: null, first_name: "Ghost" },
    ],
    member: { membership: "ACTIVE", requested: false },
  })
  assert.ok(c)
  assert.equal(c.team.ageGroup, "U14")
  assert.equal(c.children.length, 1, "a row without an id is not a child")
  // A child the server did not mark dispensable is not, and one with no live dispensation has none (20270742000000).
  assert.deepEqual(c.children[0], { playerId: "p1", firstName: "Oliver", surname: "Smith", birthYear: 2019, fit: "TOO_YOUNG", dispensable: false, dispensation: null, place: null })
  assert.equal(c.member.membership, "ACTIVE")
})

test("who a code is for travels in the server's own shape, and nothing else does", () => {
  assert.deepEqual(teamCodeSubjectPayload({ for: "MEMBER" }), { for: "MEMBER" })
  assert.deepEqual(teamCodeSubjectPayload({ for: "CHILD", playerId: "p1" }), { for: "CHILD", player_id: "p1" })
  assert.deepEqual(teamCodeSubjectPayload({ for: "SELF" }), { for: "SELF" })
  assert.deepEqual(teamCodeSubjectPayload({ for: "SELF", dateOfBirth: "1996-04-01", playingPathway: "MALE" }), { for: "SELF", date_of_birth: "1996-04-01", playing_pathway: "MALE" })
  assert.deepEqual(
    teamCodeSubjectPayload({ for: "NEW_CHILD", firstName: "  Harry ", surname: " Smith", dateOfBirth: "2013-03-12", playingPathway: "MALE" }),
    { for: "NEW_CHILD", first_name: "Harry", surname: "Smith", date_of_birth: "2013-03-12", playing_pathway: "MALE" }
  )
})

test("after asking, the one sentence says who decides next and never what a probe could use", () => {
  assert.match(teamPlacePendingNote({ awaiting_guardian: true }), /parent or guardian needs to confirm/)
  assert.match(teamPlacePendingNote({ under_review: true }), /club will check the details/)
  assert.match(teamPlacePendingNote({ already: true }), /already asked/)
  assert.equal(teamPlacePendingNote({}), "Request sent. The team will let you know when it has decided.")
})

test("the approver's card says how it was asked, whether they fit, and exactly what approving does", () => {
  const read = interpretTeamPlaceRequests({
    requests: [
      { membership_id: "m1", player_id: "p1", first_name: "Harry", surname: "Smith", date_of_birth: "2013-03-12", fit: "FITS", source: "TEAM_CODE",
        asked_by: "PARENT", requester_name: "Sarah Smith", confirms_guardian: true, admits_members: ["Sarah Smith"], decided_by_others: false },
      { membership_id: "m2", player_id: "p2", first_name: "Jamie", surname: "Patel", date_of_birth: "2012-11-03", fit: "FITS", source: "TEAM_CODE",
        asked_by: "OWN_ACCOUNT", confirmed_by_name: "Anita Patel", confirms_guardian: false, admits_members: [], decided_by_others: false },
    ],
    awaiting_guardian: 1,
  })
  assert.equal(read.awaitingGuardian, 1)
  const [harry, jamie] = read.requests
  assert.equal(requestFitLine(harry, U14), "Born 12 March 2013. Fits Under 14.")
  assert.equal(requestAskedLine(harry), "Added by Sarah Smith (parent) with the team code.")
  assert.equal(requestApprovalSentence(harry, "Under 14 Boys", "Ovalball UAT RUFC"),
    "Approving adds Harry to Under 14 Boys and confirms Sarah Smith as Harry's parent or guardian. Sarah Smith joins Ovalball UAT RUFC as a member.")
  assert.equal(requestAskedLine(jamie), "Asked from Jamie's own account. Anita Patel (parent) confirmed it.")
  assert.equal(requestApprovalSentence(jamie, "Under 14 Boys", "Ovalball UAT RUFC"), "Approving adds Jamie to Under 14 Boys.")
  assert.equal(requestFitLine({ dateOfBirth: "2012-11-03", fit: "TOO_OLD" }, U14), "Born 3 November 2012. Too old for Under 14.")
})

test("a parent's ask is one Action Required row per request, paired with its notification and gone when answered", () => {
  const req = { membershipId: "m9", playerId: "p9", firstName: "Jamie", surname: "Patel", teamId: "t1", teamLabel: "Under 14 Boys", clubId: "c1", clubName: "Ovalball UAT RUFC", requestedAt: "2026-10-05T18:42:00Z" }
  const items = familyAttentionItems([], [], { kind: "parent", clubId: null }, [req])
  assert.equal(items.length, 1)
  assert.equal(items[0].title, "Confirm Jamie's request")
  assert.equal(items[0].summary, "Under 14 Boys at Ovalball UAT RUFC")
  assert.equal(items[0].href, teamRequestHref("m9"))
  const data = { membership_id: "m9", team_id: "t1" }
  assert.equal(notificationAttentionId("team_place_confirm_requested", data), "team_place_confirmation:m9")
  assert.equal(notificationAudience("team_place_confirm_requested"), "family")
  assert.equal(attentionStillOpen("team_place_confirm_requested", data, items), true)
  assert.equal(attentionStillOpen("team_place_confirm_requested", data, []), false, "answered: the job is done")
  assert.equal(notificationHref("team_place_confirm_requested", data), "/parent/team-requests?request=m9")
})

test("the approvers' ask pairs with the team's own waiting-to-join row", () => {
  assert.equal(notificationAttentionId("team_place_requested", { team_id: "t1", membership_id: "m1" }), "team_place_request:t1")
  assert.equal(notificationAudience("team_place_requested"), "staff")
  assert.equal(notificationHref("team_place_requested", { team_id: "t1" }), "/teams/t1/people")
})
