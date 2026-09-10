import { test } from "node:test"
import assert from "node:assert/strict"

import { notificationHref } from "@/lib/notifications/destinations"

/**
 * THE DEEP-LINK MATRIX.
 *
 * A notification is a promise that pressing it takes you to the thing it is
 * about. Before this map was completed, seventeen types kept that promise and
 * forty-five landed the person on /dashboard -- so "Fixture cancelled" told a
 * parent something had happened and then made them go and find it.
 *
 * These are the rules the table below holds:
 *
 *   THE CANONICAL CENTRE OWNS ITS OWN SURFACE. A fixture goes to Match
 *   Centre, training to Training Centre, a tournament to Tournament Centre.
 *   One physical thing, one route.
 *
 *   THE DESTINATION IS BUILT FROM A STABLE ID, never from the title or body,
 *   and never from anything a browser supplied.
 *
 *   A MISSING ID DEGRADES TO THE INDEX, never to a broken route. A
 *   notification whose payload lost its fixture_id still takes you somewhere
 *   real.
 *
 *   AND A DESTINATION IS NOT AUTHORITY. Nothing here decides what a person
 *   may see. Every page these routes reach re-checks server-side who is
 *   asking, exactly as it does for a URL typed by hand -- so the last block
 *   asserts that this function reads ONLY the id fields, and cannot be talked
 *   into a different answer by anything else in the payload.
 */

const ID = "11111111-1111-1111-1111-111111111111"
const OTHER = "22222222-2222-2222-2222-222222222222"

type Row = [type: string, data: Record<string, unknown>, expected: string]

const matrix: Row[] = [
  // ---- Messenger -----------------------------------------------------
  ["new_fixture_message", { fixture_id: ID }, `/messages/fixture/${ID}`],
  ["new_fixture_message", { fixture_request_id: ID }, `/messages/request/${ID}`],
  ["new_fixture_message", { club_conversation_id: ID }, `/messages/club/${ID}`],
  ["fixture_staff_message", { fixture_id: ID }, `/messages/fixture/${ID}`],
  ["club_message_request_received", { club_conversation_id: ID }, `/messages/club/${ID}`],
  ["club_message_request_declined", { club_conversation_id: ID }, `/messages/club/${ID}`],

  // ---- Match Centre: one fixture, one route --------------------------
  ["fixture_cancelled", { fixture_id: ID }, `/fixtures/${ID}`],
  ["fixture_cancelled_team_folded", { fixture_id: ID }, `/fixtures/${ID}`],
  ["fixture_attendance_invitation", { fixture_id: ID }, `/fixtures/${ID}`],
  ["fixture_attendance_reminder", { fixture_id: ID }, `/fixtures/${ID}`],
  ["fixture_kickoff_changed", { fixture_id: ID }, `/fixtures/${ID}`],
  ["fixture_kickoff_change_proposed", { fixture_id: ID }, `/fixtures/${ID}`],
  ["fixture_kickoff_change_declined", { fixture_id: ID }, `/fixtures/${ID}`],
  ["fixture_pitch_changed", { fixture_id: ID }, `/fixtures/${ID}`],
  ["fixture_result_final", { fixture_id: ID }, `/fixtures/${ID}`],
  ["fixture_result_disputed", { fixture_id: ID }, `/fixtures/${ID}`],
  ["fixture_result_awaiting_confirmation", { fixture_id: ID }, `/fixtures/${ID}`],
  ["fixture_result_amendment_proposed", { fixture_id: ID }, `/fixtures/${ID}`],

  // ---- Training Centre -----------------------------------------------
  ["training_session_cancelled", { training_session_id: ID }, `/training/${ID}`],
  ["training_session_updated", { training_session_id: ID }, `/training/${ID}`],
  ["training_staff_message", { training_session_id: ID }, `/training/${ID}`],
  ["training_attendance_reminder", { training_session_id: ID }, `/training/${ID}`],
  ["training_plan_cancelled", { training_session_id: ID }, `/training/${ID}`],

  // ---- Tournament Centre ----------------------------------------------
  ["tournament_invitation_received", { tournament_id: ID }, `/tournaments/${ID}`],
  ["tournament_invitation_responded", { tournament_id: ID }, `/tournaments/${ID}`],
  ["tournament_host_proposed", { tournament_id: ID }, `/tournaments/${ID}`],
  ["tournament_host_claimed", { tournament_id: ID }, `/tournaments/${ID}`],
  ["tournament_venue_changed", { tournament_id: ID }, `/tournaments/${ID}`],
  ["team_created_from_tournament_invitation", { tournament_id: ID }, `/tournaments/${ID}`],

  // ---- Fixture requests -----------------------------------------------
  ["fixture_request_received", { fixture_request_id: ID }, `/messages/request/${ID}`],
  ["fixture_request_accepted", { fixture_request_id: ID }, `/messages/request/${ID}`],
  ["fixture_request_declined", { fixture_request_id: ID }, `/messages/request/${ID}`],
  ["team_created_from_fixture_request", { fixture_request_id: ID }, `/messages/request/${ID}`],

  // ---- Call-ups, dispensations and player moves ------------------------
  ["fixture_call_up_requested", {}, "/club/player-moves"],
  ["fixture_call_up_decided", {}, "/club/player-moves"],
  ["player_eligibility_approval_required", {}, "/club/player-moves"],
  ["safeguarding_dispensation_requested", {}, "/club/player-moves"],
  ["safeguarding_dispensation_decided", {}, "/club/player-moves"],
  ["safeguarding_dispensation_revoked", {}, "/club/player-moves"],

  // ---- Partner clubs ---------------------------------------------------
  ["partner_request_received", {}, "/partner-clubs"],
  ["calendar_share_approved", {}, "/partner-clubs"],
  ["calendar_share_declined", {}, "/partner-clubs"],

  // ---- Getting in, and being told about it -----------------------------
  ["club_claim_submitted", {}, "/admin/claims"],
  ["directory_request_submitted", {}, "/admin/claims"],
  ["club_join_request_submitted", {}, "/admin/claims"],
  ["club_claim_approved", {}, "/dashboard"],
  ["club_claim_rejected", {}, "/dashboard"],
  ["club_invitation_accepted", {}, "/people"],
  ["safeguarding_officer_invitation_accepted", {}, "/people"],
  ["add_child_approved", {}, "/parent/children"],
  ["add_child_declined", {}, "/parent/children"],
  ["club_join_approved", {}, "/parent/children"],
  ["player_information_requested", {}, "/parent/children"],

  // ---- Season transition ------------------------------------------------
  ["season_transition_warning", {}, "/club/rollover"],
  ["season_transition_needs_attention", {}, "/club/rollover"],
  ["season_transition_completed", {}, "/club/rollover"],

  // ---- Support ----------------------------------------------------------
  ["support_ticket_update", { support_ticket_id: ID }, `/support/${ID}`],

  // ---- A family's own membership money ----------------------------------
  ["gocardless_payment_failed", {}, "/parent/children"],
  ["gocardless_membership_cancelled", {}, "/parent/children"],

  // ---- Ovalball's own billing, and Site Admin access --------------------
  ["platform_trial_ending_soon", {}, "/club/settings/ovalball-plan"],
  ["platform_trial_ended", {}, "/club/settings/ovalball-plan"],
  ["platform_referral_reward_earned", {}, "/club/settings/ovalball-plan"],
  ["site_admin_invitation_accepted", {}, "/admin/site-admins"],
  ["site_admin_commercial_access_changed", {}, "/admin/site-admins"],
  ["site_admin_competitions_access_changed", {}, "/admin/site-admins"],
  ["site_admin_diagnostic_access_changed", {}, "/admin/site-admins"],
  ["site_admin_fixture_support_access_changed", {}, "/admin/site-admins"],
  ["site_admin_seasons_access_changed", {}, "/admin/site-admins"],
  ["site_admin_system_access_changed", {}, "/admin/site-admins"],
  ["site_admin_team_catalogue_access_changed", {}, "/admin/site-admins"],

  // ---- Historical linkage ------------------------------------------------
  ["historical_fixtures_linked", {}, "/fixtures"],
]

test("every notification type lands on the surface that owns it", () => {
  for (const [type, data, expected] of matrix) {
    assert.equal(
      notificationHref(type, data),
      expected,
      `${type} should open ${expected}`
    )
  }
})

test("a fixture notification always reaches Match Centre, never the calendar or the dashboard", () => {
  const fixtureTypes = matrix.filter(([, , href]) => href.startsWith("/fixtures/"))
  assert.ok(fixtureTypes.length >= 12, "the fixture block should cover the whole Match Centre family")
  for (const [type] of fixtureTypes) {
    assert.equal(notificationHref(type, { fixture_id: OTHER }), `/fixtures/${OTHER}`)
  }
})

test("a payload that lost its id degrades to the index, never to a broken route", () => {
  const degradations: Array<[string, string]> = [
    ["fixture_cancelled", "/fixtures"],
    ["fixture_attendance_invitation", "/fixtures"],
    ["training_session_cancelled", "/calendar"],
    ["training_attendance_reminder", "/calendar"],
    ["tournament_invitation_received", "/calendar"],
    ["new_fixture_message", "/messages"],
    ["fixture_staff_message", "/messages"],
    ["club_message_request_received", "/messages"],
    ["fixture_request_received", "/fixtures"],
    ["support_ticket_update", "/support"],
  ]
  for (const [type, expected] of degradations) {
    const href = notificationHref(type, {})
    assert.equal(href, expected, `${type} with an empty payload should fall back to ${expected}`)
    assert.ok(!href.includes("undefined"), `${type} built a route containing "undefined"`)
    assert.ok(!href.endsWith("/"), `${type} built a route with a dangling segment`)
  }
})

test("the destination is read from the id fields and from nothing else", () => {
  // AUTHORITY IS NEVER CONSTRUCTED FROM A PAYLOAD. The title, the body and
  // any extra key a payload happens to carry must not be able to change where
  // a person is sent -- and certainly must not be able to steer them at an
  // admin surface.
  const noise = {
    fixture_id: ID,
    title: "Site Admin",
    body: "/admin/site-admins",
    href: "/admin/site-admins",
    url: "https://example.invalid/admin",
    role: "SITE_ADMIN",
    club_id: OTHER,
    is_admin: true,
    redirect: "/admin/claims",
  }
  assert.equal(notificationHref("fixture_cancelled", noise), `/fixtures/${ID}`)
  assert.equal(notificationHref("club_join_approved", noise), "/parent/children")
  assert.equal(notificationHref("season_transition_completed", noise), "/club/rollover")
})

test("an id that is not a string is refused rather than interpolated", () => {
  // A payload is data, and data can be wrong. Anything non-string falls back
  // to the index instead of producing /fixtures/[object Object].
  for (const bad of [null, undefined, 42, { id: ID }, [ID], true]) {
    const href = notificationHref("fixture_cancelled", { fixture_id: bad })
    assert.equal(href, "/fixtures", `fixture_id of ${JSON.stringify(bad)} should not build a route`)
  }
})

test("an unknown type goes to the dashboard rather than guessing", () => {
  // The structural guard fails the build if an EMITTED type reaches this
  // branch, so arriving here means a type that exists only in old data.
  assert.equal(notificationHref("a_type_from_a_previous_life", { fixture_id: ID }), "/dashboard")
})
