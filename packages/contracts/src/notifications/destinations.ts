import { matchCentreHref } from "../match-centre/sections"

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
  const trainingPlanId = str(data.training_plan_id)
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
    // A message from the team's staff to its families about one match -- an announcement or a
    // reminder's note. It is read in that match's Changing Room, where every announcement the person
    // was sent is listed; the staff conversation itself is not theirs to open.
    case "fixture_staff_message":
      return fixtureId ? matchCentreHref(fixtureId, "changing-room") : "/messages"
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
    // Everything about one physical game lands on that game's one Match Centre, at the section the
    // notification is about (`?tab=`, which the website ignores and lands on its own page).
    //
    // Attendance: the invitation, a reminder, and a family's answer told to the side's staff.
    case "fixture_attendance_invitation":
    case "fixture_attendance_reminder":
    case "fixture_availability_responded":
      return fixtureId ? matchCentreHref(fixtureId, "attendance") : "/fixtures"
    // Where: the pitch moved, or the changing rooms were allocated.
    case "fixture_pitch_changed":
    case "fixture_arrangements_changed":
      return fixtureId ? matchCentreHref(fixtureId, "arena") : "/fixtures"
    // When and whether: the overview, where the match details are.
    case "fixture_cancelled":
    case "fixture_cancelled_team_folded":
    case "fixture_details_changed":
    case "fixture_kickoff_changed":
    case "fixture_kickoff_change_proposed":
    case "fixture_kickoff_change_declined":
    case "fixture_meet_time_changed":
      return fixtureId ? matchCentreHref(fixtureId) : "/fixtures"
    // Rewards: the parents' vote has opened, or a player has been given an award.
    case "match_award_voting_open":
    case "match_award_received":
      return fixtureId ? matchCentreHref(fixtureId, "rewards") : "/fixtures"

    // ---- A fixture's RESULT -----------------------------------------------
    // Every result notification lands on the result itself -- the submitted score and, for whoever may,
    // confirm or dispute -- never on fixture editing. The website has its own result page at this
    // address; the app opens the Match Centre's Result section from it.
    case "fixture_result_final":
    case "fixture_result_disputed":
    case "fixture_result_awaiting_confirmation":
    case "fixture_result_amendment_proposed":
      return fixtureId ? `/fixtures/${fixtureId}/result` : "/fixtures"

    // ---- Training Centre ------------------------------------------------
    case "training_session_cancelled":
    case "training_session_updated":
    case "training_staff_message":
    case "training_attendance_reminder":
    case "training_plan_cancelled":
    case "training_availability_responded":
      return trainingSessionId ? `/training/${trainingSessionId}` : "/calendar"

    // ---- Training Planning ----------------------------------------------
    // A PLAN IS NOT A SESSION. These two tell a team's staff that the plan behind their training has
    // been created or re-scheduled, and they carry `training_plan_id` rather than a session id -- so
    // they open Training Management, the canonical surface where a plan is read and changed, not a
    // single occurrence of it. Without a case here both fell through to /dashboard, which is the one
    // destination that answers nothing.
    // The plan rides in the query: the website has one Training Management page and ignores it, and the
    // app opens that plan's own screen.
    case "training_plan_created":
    case "training_plan_schedule_changed":
      return trainingPlanId ? `/club/training?plan=${encodeURIComponent(trainingPlanId)}` : "/club/training"

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
    // M7 notifications programme Phase F: publication, applications and cancellation all land on the
    // Centre -- the same address every other tournament-wide (not one-game) notification already uses.
    case "tournament_schedule_published":
    case "tournament_application_received":
    case "tournament_application_decided":
    case "tournament_cancelled":
    // Phase G: a side advancing or learning its next opponent is about the DRAW, not a finished
    // game -- the Centre, where the bracket lives, not the result screen.
    case "tournament_side_advanced":
    case "tournament_opponent_known":
      return tournamentId ? `/tournaments/${tournamentId}` : "/calendar"

    // A RESULT NOTIFICATION LANDS ON THE GAME, not on the tournament. Every one of these says a
    // HUMAN HAS SOMETHING TO DO about one specific score -- confirm it, answer a contest, settle a
    // disagreement -- and a route to the festival leaves them to find it. The game screen re-checks
    // who is asking and shows nothing to anybody who is neither side nor the organiser.
    // A PUBLISHED GAME MOVING (20270721) lands on that game -- its time and pitch are on its own
    // screen -- and a whole published schedule changing lands on the tournament.
    case "tournament_schedule_changed":
    case "tournament_result_awaiting_confirmation":
    case "tournament_result_confirmed":
    case "tournament_result_contested":
    case "tournament_result_resolved": {
      const gameId = str(data.tournament_game_id)
      if (gameId) return `/tournaments/result/${gameId}`
      return tournamentId ? `/tournaments/${tournamentId}` : "/calendar"
    }

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
    // AN ACCEPTED REQUEST HAS BECOME A FIXTURE: it opens the fixture it created, not the request
    // thread it came from. Without the fixture id it falls back to the thread like the others.
    case "fixture_request_accepted":
      if (fixtureId) return `/fixtures/${fixtureId}`
      return str(data.fixture_request_id) ? `/messages/request/${str(data.fixture_request_id)}` : "/fixtures"
    case "fixture_request_received":
    case "fixture_request_declined":
    case "fixture_request_countered":
    case "team_created_from_fixture_request": {
      const requestId = str(data.fixture_request_id)
      return requestId ? `/messages/request/${requestId}` : "/fixtures"
    }

    // ---- Season Planner club days (20270761000000) ---------------------
    // ONE notice for a whole club day, sent or answered, opens that club day -- never one request of it.
    case "club_day_request_received":
    case "club_day_responded": {
      const groupId = str(data.group_id)
      return groupId ? `/fixtures/club-day/${groupId}` : "/fixtures"
    }

    // ---- Looking for Opposition (Clubhouse Sections 15/16) --------------
    // The publisher's/responder's own listing, opened on the Looking for Opposition screen -- never a
    // second per-notification page, matching every other notification here pointing at the one canonical
    // surface the record already lives on.
    case "fixture_opportunity_cancelled":
    case "fixture_opportunity_response_received":
    case "fixture_opportunity_response_declined":
    case "fixture_opportunity_filled": {
      const opportunityId = str(data.opportunity_id)
      return opportunityId ? `/clubhouse/opportunities?highlight=${opportunityId}` : "/clubhouse/opportunities"
    }

    // ---- Call-ups, dispensations and player moves -----------------------
    case "fixture_call_up_requested":
    case "fixture_call_up_decided":
    case "player_eligibility_approval_required":
      return "/club/player-moves"
    // A DISPENSATION opens its own record (20270742000000): the officer and the Club Admins decide there,
    // and every officer told that a Club Admin decided lands on the immutable record of who, what and when.
    // Everybody these reach may read it -- the server chose them from the people who may.
    case "safeguarding_dispensation_requested":
    case "safeguarding_dispensation_decided":
    case "safeguarding_dispensation_revoked": {
      const dispensationId = str(data.dispensation_id)
      return dispensationId ? `/dispensations/${dispensationId}` : "/club/player-moves"
    }

    // ---- Partner clubs ---------------------------------------------------
    case "partner_request_received":
    case "calendar_share_approved":
    case "calendar_share_declined":
      return "/clubhouse"

    // ---- Getting in, and being told about it ----------------------------
    // A CLAIM, and a DIRECTORY REQUEST, are both somebody asking Ovalball itself for something, and
    // Site Admin is who reviews them.
    case "club_claim_submitted":
    case "directory_request_submitted":
      return "/admin/claims"
    case "club_join_request_submitted": {
      // A JOIN REQUEST IS NOT A CLAIM. It is somebody asking an EXISTING club to let them in, and the
      // club reviews it on People & Access through list_pending_club_join_requests. Sharing the claim's
      // destination sent a Club Admin who had been told "somebody wants to join your club" to the Site
      // Admin claims queue -- a surface about a different concept, which most of them cannot open at
      // all. The notification had been carrying the request id the whole time; it is now used, so the
      // page can say which request this was about rather than making them find it.
      const joinRequestId = str(data.join_request_id)
      return joinRequestId ? `/people?request=${encodeURIComponent(joinRequestId)}` : "/people"
    }
    case "club_claim_approved":
    case "club_claim_rejected":
      // Deliberately the dashboard: the outcome of a claim IS what the dashboard now shows them -- a
      // club they run, or the same account without one. There is no separate claim-outcome page, and
      // inventing one to satisfy a coverage count would be the wrong way round.
      return "/dashboard"
    case "club_invitation_accepted":
    case "safeguarding_officer_invitation_accepted":
      return "/people"

    // ---- Account security (Slice 6) --------------------------------------
    // Both go to the person's own Security page, and the first one is the reason that page has a
    // Cancel control: being told somebody asked to reset your sign-in security is only a defence if
    // the notification lands where you can stop it.
    case "account_recovery_requested":
    case "account_recovery_completed":
      return "/account/security"
    // Slice 9 registered this and no destination was added, so it fell to /dashboard -- the same
    // drift this map exists to prevent, caught by its own guard once the gate was run again. Somebody
    // told an administrator had finished acting as them wants their own security page: it is where
    // the session and its audit live.
    case "impersonation_session_ended":
      return "/account/security"

    // ---- Safeguarding appointments and threads (Slice 4G) ----------------
    // A confirmed appointment, transferred threads and a club left without an officer are all things
    // the club's safeguarding page is for. A review by Ovalball belongs there too: it is the page
    // where the officer sees "Reviewed by Ovalball on ...".
    case "safeguarding_officer_confirmed":
    case "safeguarding_thread_reviewed":
    case "safeguarding_threads_transferred":
    case "safeguarding_threads_unattended":
      return "/club/settings/safeguarding"

    // A guardian being told about their own child's call-up is not a club administration notice -- it
    // goes where the parent already looks after their children. A dispensation's outcome opens the record
    // itself, which the family and whoever asked may both read: pending, approved, declined and why.
    case "safeguarding_guardian_call_up":
      return "/parent/children"
    case "safeguarding_guardian_dispensation": {
      const dispensationId = str(data.dispensation_id)
      return dispensationId ? `/dispensations/${dispensationId}` : "/parent/children"
    }
    // Team codes place players (20270741000000). The team's approvers decide on the team's own people
    // page; a parent answers their child's own request where both apps put it.
    case "team_place_requested": {
      const teamId = str(data.team_id)
      return teamId ? `/teams/${teamId}/people` : "/people"
    }
    case "team_place_confirm_requested": {
      const membershipId = str(data.membership_id)
      return membershipId ? `/parent/team-requests?request=${encodeURIComponent(membershipId)}` : "/parent/team-requests"
    }
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
    // A membership reminder (20270746000000) lands on the membership it is about: an adult player's own
    // payments, or the child's subscription page for the parent or guardian it was sent to.
    // So does the club ending the old payer's set-up so someone else can pay (20270753000000).
    case "membership_reminder":
    case "membership_payer_released": {
      const playerId = str(data.player_id)
      if (data.self === true || data.self === "true") return "/player/payments"
      return playerId ? `/parent/players/${playerId}/subscription` : "/parent/children"
    }
    // The club telling a team's staff how many players need attention: that team's own membership view.
    case "membership_team_attention": {
      const teamId = str(data.team_id)
      return teamId ? `/teams/${teamId}/subscriptions` : "/dashboard"
    }
    // GoCardless verified the club's account while it was setting up (20270752000000): where Activate is.
    case "membership_gocardless_verified":
      return "/club/settings/subscriptions"

    // ---- Ovalball's own billing, and Site Admin access -------------------
    case "platform_trial_ending_soon":
    case "platform_trial_ended":
    case "platform_referral_reward_earned":
      // The page is Ovalball Billing; "/ovalball-plan" never existed on the website and opened a 404.
      return "/club/settings/ovalball-billing"
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

    // ---- Events (20270729) -- the Event Centre, at the section the notice is about -------------
    case "event_invitation":
    case "event_reminder":
    case "event_waitlist_promoted": {
      const eventId = str(data.event_id)
      return eventId ? `/events/${eventId}?tab=attendance` : "/calendar"
    }
    case "event_announcement": {
      const eventId = str(data.event_id)
      return eventId ? `/events/${eventId}?tab=messages` : "/calendar"
    }
    case "event_updated":
    case "event_postponed":
    case "event_cancelled": {
      const eventId = str(data.event_id)
      return eventId ? `/events/${eventId}` : "/calendar"
    }

    default:
      // Deliberately the dashboard rather than a guess. The structural guard
      // (scripts/verify-notification-catalogue.mjs) fails the build if any
      // EMITTED type reaches this line, so arriving here means a type that
      // exists only in data -- not one somebody forgot to route.
      return "/dashboard"
  }
}
