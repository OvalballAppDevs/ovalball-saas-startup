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
// A SECOND id, deliberately different from the tournament's, so a route that reached for the wrong one
// cannot pass by coincidence.
const GAME = "22222222-2222-2222-2222-222222222222"
const OTHER = "22222222-2222-2222-2222-222222222222"

type Row = [type: string, data: Record<string, unknown>, expected: string]

const matrix: Row[] = [
  // ---- Messenger -----------------------------------------------------
  ["new_fixture_message", { fixture_id: ID }, `/messages/fixture/${ID}`],
  ["new_fixture_message", { fixture_request_id: ID }, `/messages/request/${ID}`],
  ["new_fixture_message", { club_conversation_id: ID }, `/messages/club/${ID}`],
  // A staff message to families about one match is read in that match's Changing Room (Match Centre
  // consolidation, 2026-10-03): the staff conversation is not theirs to open.
  ["fixture_staff_message", { fixture_id: ID }, `/fixtures/${ID}?tab=changing-room`],
  ["event_invitation", { event_id: ID }, `/events/${ID}?tab=attendance`],
  ["event_reminder", { event_id: ID }, `/events/${ID}?tab=attendance`],
  ["event_waitlist_promoted", { event_id: ID }, `/events/${ID}?tab=attendance`],
  ["event_announcement", { event_id: ID }, `/events/${ID}?tab=messages`],
  ["event_updated", { event_id: ID }, `/events/${ID}`],
  ["event_postponed", { event_id: ID }, `/events/${ID}`],
  ["event_cancelled", { event_id: ID }, `/events/${ID}`],
  ["club_message_request_received", { club_conversation_id: ID }, `/messages/club/${ID}`],
  ["club_message_request_declined", { club_conversation_id: ID }, `/messages/club/${ID}`],
  ["announcement_received", { announcement_id: ID }, `/messages/announcement/${ID}`],
  ["new_direct_message", { direct_conversation_id: ID }, `/messages/direct/${ID}`],

  // ---- Match Centre: one fixture, one route --------------------------
  ["fixture_cancelled", { fixture_id: ID }, `/fixtures/${ID}`],
  ["fixture_cancelled_team_folded", { fixture_id: ID }, `/fixtures/${ID}`],
  ["fixture_details_changed", { fixture_id: ID }, `/fixtures/${ID}`],
  ["competition_match_verification_requested", { competition_match_id: ID }, `/fixtures/competitions/requests?match=${ID}`],
  ["competition_match_changed", { competition_match_id: ID }, `/fixtures/competitions/requests?match=${ID}`],
  ["competition_match_cancelled", { competition_match_id: ID }, `/fixtures/competitions/requests?match=${ID}`],
  ["competition_match_response", { edition_id: ID }, `/fixtures/competitions/${ID}/issue`],
  // MATCH CENTRE SECTIONS (2026-10-03): each lands on the section it is about, as `?tab=`.
  ["fixture_attendance_invitation", { fixture_id: ID }, `/fixtures/${ID}?tab=attendance`],
  ["fixture_attendance_reminder", { fixture_id: ID }, `/fixtures/${ID}?tab=attendance`],
  // CA-M8: a family's answer, told to the side's staff -- the register is in Attendance.
  ["fixture_availability_responded", { fixture_id: ID, player_id: OTHER, team_id: OTHER }, `/fixtures/${ID}?tab=attendance`],
  ["fixture_kickoff_changed", { fixture_id: ID }, `/fixtures/${ID}`],
  ["fixture_kickoff_change_proposed", { fixture_id: ID }, `/fixtures/${ID}`],
  ["fixture_kickoff_change_declined", { fixture_id: ID }, `/fixtures/${ID}`],
  ["fixture_meet_time_changed", { fixture_id: ID }, `/fixtures/${ID}`],
  ["fixture_pitch_changed", { fixture_id: ID }, `/fixtures/${ID}?tab=arena`],
  ["fixture_arrangements_changed", { fixture_id: ID }, `/fixtures/${ID}?tab=arena`],
  ["match_award_voting_open", { fixture_id: ID, team_id: OTHER }, `/fixtures/${ID}?tab=rewards`],
  ["match_award_received", { fixture_id: ID, player_id: OTHER }, `/fixtures/${ID}?tab=rewards`],
  ["fixture_result_final", { fixture_id: ID }, `/fixtures/${ID}/result`],
  ["fixture_result_disputed", { fixture_id: ID }, `/fixtures/${ID}/result`],
  ["fixture_result_awaiting_confirmation", { fixture_id: ID }, `/fixtures/${ID}/result`],
  ["fixture_result_amendment_proposed", { fixture_id: ID }, `/fixtures/${ID}/result`],

  // ---- Training Centre -----------------------------------------------
  ["training_session_cancelled", { training_session_id: ID }, `/training/${ID}`],
  ["training_session_updated", { training_session_id: ID }, `/training/${ID}`],
  ["training_staff_message", { training_session_id: ID }, `/training/${ID}`],
  ["training_attendance_reminder", { training_session_id: ID }, `/training/${ID}`],
  ["training_plan_cancelled", { training_session_id: ID }, `/training/${ID}`],
  ["training_availability_responded", { training_session_id: ID, player_id: OTHER, team_id: OTHER }, `/training/${ID}`],

  // ---- Training Planning ----------------------------------------------
  // A PLAN, NOT A SESSION: these carry `training_plan_id` and open Training Management, the canonical
  // surface where a plan is read and changed, naming the plan -- the website ignores the query, the app
  // opens that plan. Sending them to one occurrence of a plan would answer a different question.
  ["training_plan_created", { training_plan_id: ID }, `/club/training?plan=${ID}`],
  ["training_plan_schedule_changed", { training_plan_id: ID }, `/club/training?plan=${ID}`],
  ["training_plan_created", {}, "/club/training"],
  ["tournament_schedule_changed", { tournament_id: ID, tournament_game_id: OTHER }, `/tournaments/result/${OTHER}`],
  ["tournament_schedule_changed", { tournament_id: ID }, `/tournaments/${ID}`],

  // ---- Tournament Centre ----------------------------------------------
  ["tournament_invitation_received", { tournament_id: ID }, `/tournaments/${ID}`],
  ["tournament_invitation_responded", { tournament_id: ID }, `/tournaments/${ID}`],
  ["tournament_host_proposed", { tournament_id: ID }, `/tournaments/${ID}`],
  ["tournament_host_claimed", { tournament_id: ID }, `/tournaments/${ID}`],
  ["tournament_venue_changed", { tournament_id: ID }, `/tournaments/${ID}`],
  ["tournament_schedule_published", { tournament_id: ID }, `/tournaments/${ID}`],
  ["tournament_application_received", { tournament_id: ID }, `/tournaments/${ID}`],
  ["tournament_application_decided", { tournament_id: ID }, `/tournaments/${ID}`],
  ["tournament_cancelled", { tournament_id: ID }, `/tournaments/${ID}`],
  ["tournament_side_advanced", { tournament_id: ID }, `/tournaments/${ID}`],
  ["tournament_opponent_known", { tournament_id: ID }, `/tournaments/${ID}`],
  ["team_created_from_tournament_invitation", { tournament_id: ID }, `/tournaments/${ID}`],

  // A RESULT NOTIFICATION LANDS ON THE GAME, not on the festival. Each of these says a human has
  // something to do about ONE score -- confirm it, answer a contest, settle a disagreement -- and a
  // route to the tournament leaves them to go looking for which game it was.
  ["tournament_result_awaiting_confirmation", { tournament_id: ID, tournament_game_id: GAME }, `/tournaments/result/${GAME}`],
  ["tournament_result_confirmed", { tournament_id: ID, tournament_game_id: GAME }, `/tournaments/result/${GAME}`],
  ["tournament_result_contested", { tournament_id: ID, tournament_game_id: GAME }, `/tournaments/result/${GAME}`],
  ["tournament_result_resolved", { tournament_id: ID, tournament_game_id: GAME }, `/tournaments/result/${GAME}`],

  // ---- Fixture requests -----------------------------------------------
  ["fixture_request_received", { fixture_request_id: ID }, `/messages/request/${ID}`],
  ["fixture_request_accepted", { fixture_request_id: ID }, `/messages/request/${ID}`],
  ["fixture_request_accepted", { fixture_request_id: ID, fixture_id: ID }, `/fixtures/${ID}`],
  ["fixture_request_declined", { fixture_request_id: ID }, `/messages/request/${ID}`],
  ["fixture_request_countered", { fixture_request_id: ID }, `/messages/request/${ID}`],
  ["team_created_from_fixture_request", { fixture_request_id: ID }, `/messages/request/${ID}`],
  ["club_day_request_received", { group_id: ID }, `/fixtures/club-day/${ID}`],
  ["club_day_responded", { group_id: ID }, `/fixtures/club-day/${ID}`],

  // ---- Looking for Opposition (Clubhouse Sections 15/16) ---------------
  ["fixture_opportunity_cancelled", { opportunity_id: ID }, `/clubhouse/opportunities?highlight=${ID}`],
  ["fixture_opportunity_response_received", { opportunity_id: ID }, `/clubhouse/opportunities?highlight=${ID}`],
  ["fixture_opportunity_response_declined", { opportunity_id: ID }, `/clubhouse/opportunities?highlight=${ID}`],
  ["fixture_opportunity_filled", { opportunity_id: ID }, `/clubhouse/opportunities?highlight=${ID}`],

  // ---- Call-ups, dispensations and player moves ------------------------
  ["fixture_call_up_requested", {}, "/club/player-moves"],
  ["fixture_call_up_decided", {}, "/club/player-moves"],
  ["player_eligibility_approval_required", {}, "/club/player-moves"],
  ["safeguarding_dispensation_requested", {}, "/club/player-moves"],
  ["safeguarding_dispensation_decided", {}, "/club/player-moves"],
  ["safeguarding_dispensation_revoked", {}, "/club/player-moves"],

  // ---- Partner clubs ---------------------------------------------------
  ["partner_request_received", {}, "/clubhouse"],
  ["calendar_share_approved", {}, "/clubhouse"],
  ["calendar_share_declined", {}, "/clubhouse"],

  // ---- Getting in, and being told about it -----------------------------
  ["club_claim_submitted", {}, "/admin/claims"],
  ["directory_request_submitted", {}, "/admin/claims"],
  // NOT the claims queue. A join request is reviewed by the CLUB on People & Access, and the request
  // id it carries is used so the page can say which one this was about.
  ["club_join_request_submitted", { join_request_id: "2098d2ad-60d7-4b02-a769-112ad1b70eca" },
    "/people?request=2098d2ad-60d7-4b02-a769-112ad1b70eca"],
  // An older notification issued before the id was carried still lands somewhere it can be acted on.
  ["club_join_request_submitted", {}, "/people"],
  ["club_claim_approved", {}, "/dashboard"],
  ["club_claim_rejected", {}, "/dashboard"],
  ["club_invitation_accepted", {}, "/people"],
  ["safeguarding_officer_invitation_accepted", {}, "/people"],

  // ---- Account security (Slice 6) --------------------------------------
  // The request notification is the defence against a social-engineered recovery, so it has to land
  // where the person can cancel it -- not on a dashboard that leaves them hunting for the control.
  ["account_recovery_requested", { request_id: "11111111-1111-1111-1111-111111111111" }, "/account/security"],
  ["account_recovery_completed", { request_id: "11111111-1111-1111-1111-111111111111" }, "/account/security"],
  // Slice 9's type, which had no destination at all until the catalogue guard was run again.
  ["impersonation_session_ended", {}, "/account/security"],

  // ---- Safeguarding appointments and threads (Slice 4G) ----------------
  ["safeguarding_officer_confirmed", {}, "/club/settings/safeguarding"],
  ["safeguarding_thread_reviewed", {}, "/club/settings/safeguarding"],
  ["safeguarding_threads_transferred", {}, "/club/settings/safeguarding"],
  ["safeguarding_threads_unattended", {}, "/club/settings/safeguarding"],
  ["safeguarding_guardian_call_up", {}, "/parent/children"],
  ["safeguarding_guardian_dispensation", {}, "/parent/children"],
  ["add_child_approved", {}, "/parent/children"],
  // Team codes place players (20270741000000): the approvers decide on the team's own people page, and a
  // parent answers their child's own request on the page both apps open for it.
  ["team_place_requested", { team_id: "5e0c1f1e-6a54-4f53-9f8c-2f1e1f9b1a01", membership_id: "7a1b2c3d-0000-4000-8000-000000000001" }, "/teams/5e0c1f1e-6a54-4f53-9f8c-2f1e1f9b1a01/people"],
  ["team_place_requested", {}, "/people"],
  ["team_place_confirm_requested", { membership_id: "7a1b2c3d-0000-4000-8000-000000000001" }, "/parent/team-requests?request=7a1b2c3d-0000-4000-8000-000000000001"],
  ["team_place_confirm_requested", {}, "/parent/team-requests"],
  ["add_child_declined", {}, "/parent/children"],
  ["club_join_approved", {}, "/parent/children"],
  ["player_information_requested", {}, "/parent/children"],
  ["guardian_relationship_changed", {}, "/parent/children"],
  ["guardian_relationship_changed", { confidential: true }, "/club/settings/safeguarding"],

  // ---- Season transition ------------------------------------------------
  ["season_transition_warning", {}, "/club/rollover"],
  ["season_transition_needs_attention", {}, "/club/rollover"],
  ["season_transition_completed", {}, "/club/rollover"],

  // ---- Support ----------------------------------------------------------
  ["support_ticket_update", { support_ticket_id: ID }, `/support/${ID}`],

  // ---- A family's own membership money ----------------------------------
  ["gocardless_payment_failed", {}, "/parent/children"],
  ["gocardless_membership_cancelled", {}, "/parent/children"],
  // A membership reminder lands on the membership it is about; an adult player's own is their payments page.
  ["membership_reminder", { player_id: "p-1" }, "/parent/players/p-1/subscription"],
  ["membership_reminder", { player_id: "p-1", self: true }, "/player/payments"],
  ["membership_payer_released", { player_id: "p-1" }, "/parent/players/p-1/subscription"],
  ["membership_payer_released", { player_id: "p-1", self: true }, "/player/payments"],
  ["membership_team_attention", { team_id: "t-1" }, "/teams/t-1/subscriptions"],
  ["membership_gocardless_verified", { club_id: "c-1" }, "/club/settings/subscriptions"],

  // ---- Ovalball's own billing, and Site Admin access --------------------
  ["platform_trial_ending_soon", {}, "/club/settings/ovalball-billing"],
  ["platform_trial_ended", {}, "/club/settings/ovalball-billing"],
  ["platform_referral_reward_earned", {}, "/club/settings/ovalball-billing"],
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

test("a fixture notification always reaches its fixture -- or, for a result, its result -- never the calendar or the dashboard", () => {
  // /fixtures/competitions/... is the competition family, not Match Centre; /fixtures/club-day/... is a Season Planner
  // club day (many fixture requests), not one fixture.
  const fixtureTypes = matrix.filter(([, , href]) => href.startsWith("/fixtures/") && !href.startsWith("/fixtures/competitions") && !href.startsWith("/fixtures/club-day"))
  assert.ok(fixtureTypes.length >= 12, "the fixture block should cover the whole Match Centre family")
  for (const [type, , href] of fixtureTypes) {
    // A RESULT notification lands on the result itself (the submitted score and the confirm/dispute
    // choice), never on fixture management; every other fixture notification lands on the fixture's
    // one Match Centre, at most narrowed to a named section -- never on a different fixture address.
    const got = notificationHref(type, { fixture_id: OTHER })
    if (type.startsWith("fixture_result_")) assert.equal(got, `/fixtures/${OTHER}/result`, type)
    else assert.match(got, new RegExp(`^/fixtures/${OTHER}(\\?tab=(attendance|arena|result|changing-room|rewards))?$`), type)
    assert.equal(got.replace(OTHER, ID), href, `${type} matches its matrix row`)
  }
})

test("a payload that lost its id degrades to the index, never to a broken route", () => {
  const degradations: Array<[string, string]> = [
    ["fixture_cancelled", "/fixtures"],
    ["fixture_attendance_invitation", "/fixtures"],
    ["training_session_cancelled", "/calendar"],
    ["training_attendance_reminder", "/calendar"],
    ["tournament_invitation_received", "/calendar"],
    // Without a game id there is no one score to land on, so it degrades to the Calendar rather than
    // to `/tournaments/result/undefined`.
    ["tournament_result_contested", "/calendar"],
    ["new_fixture_message", "/messages"],
    ["fixture_staff_message", "/messages"],
    ["club_message_request_received", "/messages"],
    ["announcement_received", "/messages"],
    ["new_direct_message", "/messages"],
    ["fixture_request_received", "/fixtures"],
    ["club_day_request_received", "/fixtures"],
    ["club_day_responded", "/fixtures"],
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
