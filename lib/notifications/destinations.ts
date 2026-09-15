/**
 * WHERE A NOTIFICATION TAKES YOU.
 *
 * PURE, AND IN ITS OWN MODULE rather than beside the query that uses it.
 * `lib/app-context/notifications.ts` is server-only, and a destination map
 * that cannot be loaded outside a server render cannot be checked as a table
 * of type -> data -> route. This one can, and is: the structural guard
 * scripts/verify-notification-catalogue.mjs reads its cases against the
 * registry, and supabase/tests/js/notification_destinations.test.mts walks
 * real notification payloads through it.
 *
 * ONE MAP, AND IT HAS TO BE COMPLETE. Before this, seventeen types had a
 * destination and forty-five fell through to /dashboard -- so tapping
 * "Training cancelled" or "Fixture cancelled" put a parent on a dashboard and
 * left them to find it. A notification that goes nowhere is worse than no
 * notification: it spends the person's attention and gives nothing back.
 *
 * DESTINATIONS ARE BUILT FROM STABLE IDS, never from the title or body, and
 * never from anything the browser supplied. And a destination is not
 * authority: every page these routes reach re-checks server-side who is
 * asking, exactly as it does for a link typed by hand. Landing on
 * /fixtures/<id> proves nothing about being allowed to see that fixture.
 *
 * THE CANONICAL CENTRES OWN THEIR OWN SURFACES. A fixture notification goes
 * to Match Centre, training to Training Centre, an event to Event Centre, a
 * tournament to Tournament Centre. This map points at them; it never
 * duplicates them.
 */
export function notificationHref(type: string, data: Record<string, unknown>): string {
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)
  const fixtureId = str(data.fixture_id)
  const trainingSessionId = str(data.training_session_id)
  const tournamentId = str(data.tournament_id)

  switch (type) {
    // ---- Messages -------------------------------------------------------
    case "new_fixture_message": {
      const requestId = str(data.fixture_request_id)
      const clubConversationId = str(data.club_conversation_id)
      if (fixtureId) return `/messages/fixture/${fixtureId}`
      if (requestId) return `/messages/request/${requestId}`
      if (clubConversationId) return `/messages/club/${clubConversationId}`
      return "/messages"
    }
    case "fixture_staff_message":
      return fixtureId ? `/messages/fixture/${fixtureId}` : "/messages"
    case "club_message_request_received":
    case "club_message_request_declined": {
      const clubConversationId = str(data.club_conversation_id)
      return clubConversationId ? `/messages/club/${clubConversationId}` : "/messages"
    }
    // A direct message opens the 1:1 thread. Routed by the CONVERSATION id,
    // never by the sender's user id -- a route keyed on a person would be a
    // way to probe whether a thread with them exists.
    case "new_direct_message": {
      const directId = str(data.direct_conversation_id)
      return directId ? `/messages/direct/${directId}` : "/messages"
    }
    // An announcement opens on its own thread, whether or not it invited a
    // reply: a recipient who cannot answer still needs to read what was said
    // and see it stay readable afterwards. Deliberately NOT routed by scope --
    // a team announcement is not a team conversation, and sending someone to
    // the team's standing thread would show them a different set of messages.
    case "announcement_received": {
      const announcementId = str(data.announcement_id)
      return announcementId ? `/messages/announcement/${announcementId}` : "/messages"
    }

    // ---- Match Centre ---------------------------------------------------
    // Everything about one physical game lands on that game. The invitation
    // and the answer belong on the same surface as the venue and the squad.
    case "fixture_attendance_invitation":
    case "fixture_attendance_reminder":
    case "fixture_cancelled":
    case "fixture_cancelled_team_folded":
    case "fixture_details_changed":
    case "fixture_kickoff_changed":
    case "fixture_kickoff_change_proposed":
    case "fixture_kickoff_change_declined":
    case "fixture_pitch_changed":
    case "fixture_result_final":
    case "fixture_result_disputed":
    case "fixture_result_awaiting_confirmation":
    case "fixture_result_amendment_proposed":
      return fixtureId ? `/fixtures/${fixtureId}` : "/fixtures"

    // ---- Training Centre ------------------------------------------------
    case "training_session_cancelled":
    case "training_session_updated":
    case "training_staff_message":
    case "training_attendance_reminder":
    case "training_plan_cancelled":
      return trainingSessionId ? `/training/${trainingSessionId}` : "/calendar"

    // ---- Tournament Centre ----------------------------------------------
    // These events already existed and already carried tournament_id; this
    // wires them to the Centre that now owns the occasion. No tournament
    // notification was invented here.
    case "tournament_invitation_received":
    case "tournament_invitation_responded":
    case "tournament_host_proposed":
    case "tournament_host_claimed":
    case "tournament_venue_changed":
    case "team_created_from_tournament_invitation":
      return tournamentId ? `/tournaments/${tournamentId}` : "/calendar"

    // ---- Competition matches --------------------------------------------
    // A club is asked to confirm, and told of changes, in its competition
    // requests; the organiser reads an answer on the competition's Issue step.
    // Both routes re-check authority on arrival.
    case "competition_match_verification_requested":
    case "competition_match_changed":
    case "competition_match_cancelled": {
      const matchId = str(data.competition_match_id)
      return matchId ? `/fixtures/competitions/requests?match=${matchId}` : "/fixtures/competitions/requests"
    }
    case "competition_match_response": {
      const editionId = str(data.edition_id)
      return editionId ? `/fixtures/competitions/${editionId}/issue` : "/fixtures/competitions"
    }

    // ---- Fixture requests -----------------------------------------------
    case "fixture_request_received":
    case "fixture_request_accepted":
    case "fixture_request_declined":
    case "team_created_from_fixture_request": {
      const requestId = str(data.fixture_request_id)
      return requestId ? `/messages/request/${requestId}` : "/fixtures"
    }

    // ---- Call-ups, dispensations and player moves -----------------------
    case "fixture_call_up_requested":
    case "fixture_call_up_decided":
    case "player_eligibility_approval_required":
    case "safeguarding_dispensation_requested":
    case "safeguarding_dispensation_decided":
    case "safeguarding_dispensation_revoked":
      return "/club/player-moves"

    // ---- Partner clubs ---------------------------------------------------
    case "partner_request_received":
    case "calendar_share_approved":
    case "calendar_share_declined":
      return "/partner-clubs"

    // ---- Getting in, and being told about it ----------------------------
    case "club_claim_submitted":
    case "directory_request_submitted":
    case "club_join_request_submitted":
      return "/admin/claims"
    case "club_claim_approved":
    case "club_claim_rejected":
      return "/dashboard"
    case "club_invitation_accepted":
    case "safeguarding_officer_invitation_accepted":
      return "/people"
    case "add_child_approved":
    case "add_child_declined":
    case "club_join_approved":
    case "player_information_requested":
      return "/parent/children"
    // A child's other guardians are told when a guardian is added, removed or put on hold. A confidential
    // hold is told only to the club's Safeguarding Officers, whose place for it is the club's safeguarding page.
    case "guardian_relationship_changed":
      return data.confidential === true ? "/club/settings/safeguarding" : "/parent/children"

    // ---- Season transition ----------------------------------------------
    case "season_transition_warning":
    case "season_transition_needs_attention":
    case "season_transition_completed":
      return "/club/rollover"

    // ---- Support ----------------------------------------------------------
    case "support_ticket_update": {
      const ticketId = str(data.support_ticket_id)
      return ticketId ? `/support/${ticketId}` : "/support"
    }

    // ---- A family's own membership money ---------------------------------
    case "gocardless_payment_failed":
    case "gocardless_membership_cancelled":
      return "/parent/children"

    // ---- Ovalball's own billing, and Site Admin access -------------------
    case "platform_trial_ending_soon":
    case "platform_trial_ended":
    case "platform_referral_reward_earned":
      return "/club/settings/ovalball-plan"
    case "site_admin_invitation_accepted":
    case "site_admin_commercial_access_changed":
    case "site_admin_competitions_access_changed":
    case "site_admin_diagnostic_access_changed":
    case "site_admin_fixture_support_access_changed":
    case "site_admin_seasons_access_changed":
    case "site_admin_system_access_changed":
    case "site_admin_team_catalogue_access_changed":
      return "/admin/site-admins"

    // ---- Historical linkage ----------------------------------------------
    case "historical_fixtures_linked":
      return "/fixtures"

    default:
      // Deliberately the dashboard rather than a guess. The structural guard
      // (scripts/verify-notification-catalogue.mjs) fails the build if any
      // EMITTED type reaches this line, so arriving here means a type that
      // exists only in data -- not one somebody forgot to route.
      return "/dashboard"
  }
}
