import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import {
  DISPENSATION_NOT_A_GRANT,
  DISPENSATION_STATUS_LABEL,
  dispensationAttentionId,
  dispensationHistory,
  dispensationLadder,
  dispensationMismatchSentence,
  dispensationReferenceAsk,
  dispensationStateSentence,
  dispensationTone,
  dispensationWaitingTitle,
  interpretDispensationRecord,
  interpretDispensationsWaiting,
  type DispensationRecord,
} from "../../../packages/contracts/src/team/dispensation"
import { teamCodeOptions, teamCodeSubjectPayload, type TeamCodeChoices } from "../../../packages/contracts/src/team/team-code"
import { teamPlacePendingNote } from "../../../packages/contracts/src/invitations/redeem"
import { notificationAttentionId } from "../../../packages/contracts/src/notifications/feed"
import { notificationHref } from "../../../packages/contracts/src/notifications/destinations"

/**
 * THE AGE DISPENSATION WORKFLOW'S SHARED CONTRACT (20270742000000) -- the words, the picture and the parity.
 *
 * The server decides everything (supabase/tests/age_dispensation_workflow.sql proves it). What this proves is
 * that both apps describe what it decided the SAME way, from ONE implementation:
 *
 *   C1  a record reads exactly as the server sent it, and nothing else is guessed
 *   C2  the status words: six states, a pending one never drawn as a grant
 *   C3  the sentences: the mismatch, where it stands, and that asking is not approval
 *   C4  the age-grade bridge: the rungs and the bridge's state, for both apps
 *   C5  the history is a reading of the immutable record, oldest first
 *   C6  joining: a child who does not fit stays greyed and is offered Request Dispensation, and only then
 *   C7  Needs Attention and notifications: one item per waiting decision, named as the brief names it,
 *       opening the record
 *   C8  parity: the website and the phone draw the record from the same contract, with no words of their own
 *   C9  accessibility: the drawing has a sentence, the state is always words, every field is labelled
 */

const read = (p: string) => readFileSync(p, "utf8")
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const SERVER = {
  id: "d1",
  status: "requested",
  player: { id: "p1", first_name: "Yan", surname: "Adams", date_of_birth: "2015-03-02" },
  club: { id: "c1", name: "Ovalball UAT RUFC" },
  team: { id: "t12", label: "Under 12 Boys", adult_side: false },
  source_team: { id: "t11", label: "Under 11 Mixed" },
  season: { id: "s1", name: "Rugby Union 26/27", ends_on: "2027-05-31" },
  player_age_group: "U11",
  team_age_group: "U12",
  verdict: "TOO_YOUNG",
  reason: "Plays well above his age",
  rule_reference: "Club age-grade dispensation",
  requested_by: { id: "u1", name: "Tom Reed" },
  requested_as: "TEAM_STAFF",
  requested_at: "2026-10-05T10:00:00Z",
  requires_governing_body: false,
  safeguarding_only: false,
  governing_body_reference: null,
  decided_by: null,
  decided_as: null,
  decided_at: null,
  decision_note: null,
  withdrawn_by: null,
  withdrawn_at: null,
  expired_at: null,
  revoked_by: null,
  revoked_at: null,
  revoke_reason: null,
  place: null,
  viewer: { decides_as: "SAFEGUARDING_OFFICER", may_withdraw: false, may_revoke: false, may_record_governing_body: false, is_requester: false, is_family: false },
}

const record = (over: Record<string, unknown> = {}): DispensationRecord => interpretDispensationRecord({ ...SERVER, ...over }) as DispensationRecord

test("C1 a record reads exactly as the server sent it, and nothing else is guessed", () => {
  const r = record()
  assert.equal(r.status, "requested")
  assert.equal(r.player.firstName, "Yan")
  assert.equal(r.player.dateOfBirth, "2015-03-02")
  assert.equal(r.team.label, "Under 12 Boys")
  assert.equal(r.sourceTeam?.label, "Under 11 Mixed")
  assert.equal(r.verdict, "TOO_YOUNG")
  assert.equal(r.viewer.decidesAs, "SAFEGUARDING_OFFICER")
  assert.equal(interpretDispensationRecord(null), null, "no record is no record")
  assert.equal(interpretDispensationRecord({}), null)
  // A date of birth the server withheld stays withheld: the reader never invents one.
  assert.equal(record({ player: { id: "p1", first_name: "Yan", surname: "Adams" } }).player.dateOfBirth, null)
  // An unknown decider role is not promoted into a decider.
  assert.equal(record({ viewer: { ...SERVER.viewer, decides_as: "TEAM_MANAGER" } }).viewer.decidesAs, null)
  // An unknown status is never read as approved.
  assert.equal(record({ status: "granted" }).status, "requested")
})

test("C2 six states in words, and a pending request is never drawn as a grant", () => {
  assert.deepEqual(DISPENSATION_STATUS_LABEL, {
    requested: "Pending",
    approved: "Approved",
    rejected: "Declined",
    withdrawn: "Withdrawn",
    expired: "Expired",
    revoked: "Revoked",
  })
  assert.equal(dispensationTone("requested"), "waiting")
  assert.equal(dispensationTone("approved"), "granted")
  assert.equal(dispensationTone("rejected"), "refused")
  assert.equal(dispensationTone("revoked"), "refused")
  assert.equal(dispensationTone("withdrawn"), "closed")
  assert.equal(dispensationTone("expired"), "closed")
})

test("C3 the sentences: the mismatch, where it stands, and that asking is not approval", () => {
  assert.equal(dispensationMismatchSentence(record()), "Yan is in the Under 11 age grade this season. Under 12 Boys is an Under 12 side.")
  assert.equal(dispensationMismatchSentence(record({ verdict: "TOO_OLD", player_age_group: "U13" })), "Yan is in the Under 13 age grade this season. Under 12 Boys is an Under 12 side.")
  assert.equal(dispensationMismatchSentence(record({ verdict: "UNDER_18", team: { id: "m1", label: "Men's 1st Team", adult_side: true } })), "Yan is under 18. Men's 1st Team is an adult side.")
  const pending = dispensationStateSentence(record())
  assert.ok(pending.includes(DISPENSATION_NOT_A_GRANT), "a pending request always says asking is not approval")
  assert.match(pending, /Safeguarding Officer or a Club Admin decides/)
  assert.match(dispensationStateSentence(record({ safeguarding_only: true })), /Safeguarding Officer decides this, with the governing body's approval/)
  const approved = dispensationStateSentence(record({ status: "approved", decided_by: { id: "u2", name: "Ann Lee" }, decided_as: "SAFEGUARDING_OFFICER", decided_at: "2026-10-06T09:00:00Z" }))
  assert.equal(approved, "Approved by Ann Lee (Safeguarding Officer) on 6 October 2026. Yan can be placed with Under 12 Boys for Rugby Union 26/27 only.")
  assert.match(dispensationStateSentence(record({ status: "rejected", decided_by: { id: "u2", name: "Ann Lee" }, decided_at: "2026-10-06T09:00:00Z", decision_note: "Not this season" })), /Declined by Ann Lee .* Reason: Not this season/)
  assert.match(dispensationStateSentence(record({ status: "expired" })), /A new season needs a new request/)
  assert.match(dispensationStateSentence(record({ status: "revoked", revoke_reason: "Reassessed" })), /A place already made stays; nothing new can rely on it/)
  assert.equal(dispensationWaitingTitle({ firstName: "Yan", surname: "Adams" }), "Dispensation requested for Yan Adams", "the brief's own wording")
  // The governing body's reference: a step only where the approval needs it; otherwise an optional addition
  // that must never read as something still waiting.
  const needed = dispensationReferenceAsk(record({ requires_governing_body: true }))
  assert.equal(needed.action, "Record the Governing Body's Approval")
  assert.match(needed.body, /needs the governing body's reference/)
  assert.match(needed.body, /call-ups waiting on it go ahead/)
  const optional = dispensationReferenceAsk(record())
  assert.equal(optional.action, "Add Governing Body Reference")
  assert.match(optional.body, /^Not needed for this dispensation\./)
  assert.doesNotMatch(optional.body, /waiting|call-up/i, "an optional reference never reads as a pending step")
})

test("C4 the age-grade bridge: the rungs, and the bridge in the record's state", () => {
  const ladder = dispensationLadder(record())!
  assert.deepEqual(ladder.rungs.map((r) => `${r.grade}:${r.role}`), ["U10:edge", "U11:player", "U12:team", "U13:edge"])
  assert.equal(ladder.bridge, "waiting")
  assert.equal(ladder.direction, "up")
  assert.equal(dispensationLadder(record({ status: "approved" }))!.bridge, "built")
  for (const status of ["rejected", "withdrawn", "expired", "revoked"]) assert.equal(dispensationLadder(record({ status }))!.bridge, "broken", status)
  const across = dispensationLadder(record({ verdict: "TOO_OLD", player_age_group: "U15", team_age_group: "U12" }))!
  assert.deepEqual(across.rungs.map((r) => r.role), ["edge", "team", "between", "between", "player", "edge"])
  assert.equal(across.direction, "down")
  assert.equal(dispensationLadder(record({ verdict: "UNDER_18" })), null, "an adult side has no grades to draw")
  assert.equal(dispensationLadder(record({ verdict: "PATHWAY" })), null, "a pathway question is not an age-grade ladder")
})

test("C5 the history is a reading of the immutable record, oldest first", () => {
  const h = dispensationHistory(record({ status: "revoked", decided_by: { id: "u2", name: "Ann Lee" }, decided_as: "CLUB_ADMIN", decided_at: "2026-10-06T09:00:00Z", revoked_by: { id: "u3", name: "Sam Cole" }, revoked_at: "2026-10-07T09:00:00Z", revoke_reason: "Moved house" }))
  assert.deepEqual(h.map((e) => e.kind), ["requested", "approved", "revoked"])
  assert.equal(h[0].who, "Tom Reed (team staff)")
  assert.equal(h[1].who, "Ann Lee (Club Admin)")
  assert.equal(h[2].detail, "Moved house")
})

const CHOICES = (children: Partial<TeamCodeChoices["children"][number]>[]): TeamCodeChoices => ({
  team: { id: "t12", label: "Under 12 Boys", clubName: "Ovalball UAT RUFC", adultSide: false, ageGroup: "U12", gender: "boys" },
  me: { playerId: null, fit: null, minor: false, establishedAdult: true, hasGuardian: false, needsDetails: true, place: null },
  children: children.map((c, i) => ({ playerId: `p${i}`, firstName: `Child${i}`, surname: "Adams", birthYear: 2015, fit: "FITS", dispensable: false, dispensation: null, place: null, ...c })),
  member: { membership: "ACTIVE", requested: false },
})

test("C6 joining: a child who does not fit stays greyed, and is offered Request Dispensation only where the server allows it", () => {
  const rows = teamCodeOptions(CHOICES([{ fit: "TOO_YOUNG", dispensable: true }, { fit: "TOO_OLD", dispensable: false }, { fit: "TOO_YOUNG", dispensation: { id: "d9", status: "approved" } }, { fit: "TOO_YOUNG", dispensation: { id: "d8", status: "requested" } }, { fit: "TOO_YOUNG", dispensable: true, place: "DISPENSATION" }]))
  const [asks, refused, approved, waiting, alreadyAsked] = rows.filter((r) => r.key.startsWith("child:"))
  assert.equal(asks.disabled, true, "the normal way in stays closed")
  assert.match(asks.description ?? "", /Too young for Under 12\./)
  assert.deepEqual(asks.requestDispensation, { playerId: "p0", firstName: "Child0" }, "and the exception is offered")
  assert.equal(refused.disabled, true)
  assert.equal(refused.requestDispensation, undefined, "never where the server says it cannot be asked for")
  assert.equal(approved.disabled, false, "an approved dispensation for this team and season is the way in")
  assert.match(approved.description ?? "", /A dispensation is approved for this season\./)
  assert.equal(waiting.disabled, false, "the place may wait on a dispensation already asked for")
  assert.match(waiting.description ?? "", /waiting for the club's decision/)
  assert.equal(alreadyAsked.disabled, true)
  assert.equal(alreadyAsked.requestDispensation, undefined, "asked already: nothing more to ask")
  assert.match(alreadyAsked.description ?? "", /The club decides the dispensation first, then the team decides\./)
  assert.deepEqual(teamCodeSubjectPayload({ for: "CHILD", playerId: "p0", dispensationReason: "  His brother plays  " }), { for: "CHILD", player_id: "p0", dispensation_reason: "His brother plays" })
  assert.deepEqual(teamCodeSubjectPayload({ for: "CHILD", playerId: "p0" }), { for: "CHILD", player_id: "p0" }, "no reason, no dispensation")
  assert.match(teamPlacePendingNote({ awaiting_dispensation: true }), /Asking is not approval/)
  assert.match(teamPlacePendingNote({ awaiting_dispensation: true, awaiting_guardian: true }), /parent or guardian confirms it, the club decides the dispensation, then the team decides/)
})

test("C7 one Needs Attention item per waiting decision, named as the brief names it, and the request's notification pairs to it", () => {
  const waiting = interpretDispensationsWaiting([{ id: "d1", club_id: "c1", team_id: "t12", player_id: "p1", first_name: "Yan", surname: "Adams", team_label: "Under 12 Boys", decides_as: "CLUB_ADMIN", safeguarding_only: false, requested_at: "x" }, { id: "d2", decides_as: "TEAM_MANAGER" }])
  assert.equal(waiting.length, 1, "nothing the server did not name as this person's decision")
  assert.equal(dispensationAttentionId("d1"), "dispensation:d1")
  assert.equal(notificationAttentionId("safeguarding_dispensation_requested", { dispensation_id: "d1" }), "dispensation:d1", "the ask pairs with its item, so it is history once decided")
  for (const type of ["safeguarding_dispensation_requested", "safeguarding_dispensation_decided", "safeguarding_dispensation_revoked", "safeguarding_guardian_dispensation"]) {
    assert.equal(notificationHref(type, { dispensation_id: "d1" }), "/dispensations/d1", `${type} opens the record`)
  }
})

test("C8 parity: the website and the phone draw the record from the one contract, with no words or operations of their own", () => {
  const web = code("app/(app)/dispensations/[dispensationId]/page.tsx") + code("components/dispensations/dispensation-controls.tsx") + code("components/dispensations/age-grade-bridge.tsx") + code("components/dispensations/dispensation-status-pill.tsx")
  const phone = code("apps/mobile/src/dispensation/record.tsx") + code("apps/mobile/src/dispensation/age-grade-bridge.tsx") + code("apps/mobile/src/dispensation/register.tsx")
  for (const shared of ["dispensationStateSentence", "dispensationMismatchSentence", "dispensationHistory", "dispensationLadder", "DISPENSATION_STATUS_LABEL", "dispensationDecisionPrompt", "dispensationReferenceAsk"]) {
    assert.ok(web.includes(shared), `the website uses ${shared}`)
    assert.ok(phone.includes(shared), `the phone uses ${shared}`)
  }
  for (const [name, src] of [["website", web], ["phone", phone]] as const) {
    assert.doesNotMatch(src, /\.rpc\(/, `the ${name}'s record names no operation of its own`)
    assert.doesNotMatch(src, /"Pending"|"Declined"|"Withdrawn"|"Awaiting [a-z]/, `the ${name} has no status words of its own`)
    assert.doesNotMatch(src, /decide_player_dispensation|request_player_dispensation|source_team_approved|club_approved/, `the ${name} knows nothing of the retired chain`)
  }
  // Both decide through the same operation; both register lists open the same record address.
  assert.match(code("app/(app)/dispensations/actions.ts"), /decideDispensation\(supabase, id, decision\)/)
  assert.match(code("apps/mobile/src/dispensation/record.tsx"), /decideDispensation\(supabase, r\.id, \{ approve: (true|false)/)
  assert.match(code("components/dispensations/dispensation-register.tsx"), /href=\{`\/dispensations\/\$\{r\.id\}`\}/)
  assert.match(code("apps/mobile/src/dispensation/register.tsx"), /pathname: "\/dispensations\/\[id\]", params: \{ id: r\.id \}/)
})

test("C9 accessibility: the drawing has a sentence, the state is always words, and every field and control is named", () => {
  const webBridge = read("components/dispensations/age-grade-bridge.tsx")
  assert.match(webBridge, /aria-hidden="true"/, "the drawing itself is hidden from assistive technology")
  assert.match(webBridge, /<span className="sr-only">\{dispensationLadderSentence\(record\)\}<\/span>/, "and read as one sentence instead")
  const phoneBridge = read("apps/mobile/src/dispensation/age-grade-bridge.tsx")
  assert.match(phoneBridge, /accessibilityRole="image" accessibilityLabel=\{dispensationLadderSentence\(record\)\}/)
  assert.match(read("components/dispensations/dispensation-status-pill.tsx"), /\{DISPENSATION_STATUS_LABEL\[status\]\}/, "the pill always carries the word, never colour alone")
  const controls = read("components/dispensations/dispensation-controls.tsx")
  assert.match(controls, /htmlFor="dispensation-decline"[\s\S]*?Reason for Declining[\s\S]*?aria-required="true"/, "the decline reason is a labelled, required field")
  assert.match(controls, /htmlFor="dispensation-reference"/, "the governing body's reference is labelled")
  const form = read("components/dispensations/request-dispensation-form.tsx")
  assert.match(form, /aria-required="true"/)
  assert.match(form, /aria-label=\{`Request a dispensation for \$\{playerName\}`\}/, "the request names whose it is")
  assert.match(read("apps/mobile/src/dispensation/register.tsx"), /accessibilityLabel=\{`\$\{name\}, \$\{DISPENSATION_STATUS_LABEL\[r\.status\]\}/, "a register row is read with its state")
  // Title Case controls, both apps (content standard rule 2): the same names for the same actions.
  for (const label of ["Request Dispensation", "Send Request", "Decline Request", "Revoke Dispensation", "Withdraw Request"]) {
    assert.ok(controls.includes(label) || form.includes(label) || read("app/join/team-code-steps.tsx").includes(label), `the website names ${label}`)
    assert.ok(
      read("apps/mobile/src/dispensation/record.tsx").includes(label) || read("apps/mobile/src/join/team-code.tsx").includes(label) || read("apps/mobile/app/(tabs)/team/age-grade.tsx").includes(label),
      `the phone names ${label}`
    )
  }
})
