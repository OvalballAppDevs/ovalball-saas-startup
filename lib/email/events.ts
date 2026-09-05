/**
 * Every transactional email event this product will eventually send, named
 * to match the brief's own list exactly. Nothing here sends anything --
 * see dispatch.ts. This module only defines the shape of each event and
 * renders its subject/text, so wiring a real provider later (Resend or
 * otherwise) is a change to dispatch.ts alone, never to every call site
 * that raises an event.
 */

export type EmailEvent =
  | { type: "club_claim_submitted"; data: { clubName: string; claimantName: string; claimantEmail: string; declaredRole: string; reviewUrl: string } }
  | { type: "club_claim_approved"; data: { clubName: string } }
  | { type: "club_claim_rejected"; data: { clubName: string; reason?: string } }
  | { type: "club_invitation"; data: { clubName: string; inviteLink: string } }
  | { type: "partner_club_invitation"; data: { invitingClubName: string; invitedClubName: string; inviteLink: string } }
  | { type: "team_invitation"; data: { clubName: string; teamNames: string[]; inviteLink: string } }
  | { type: "fixture_request_received"; data: { clubName: string; opponentText: string; date: string } }
  | { type: "fixture_request_accepted"; data: { opponentText: string; date: string } }
  | { type: "fixture_request_declined"; data: { opponentText: string; date: string } }
  | { type: "fixture_changed"; data: { opponentText: string; date: string; change: string } }
  | { type: "fixture_cancelled"; data: { opponentText: string; date: string } }
  | { type: "calendar_share_request"; data: { requestingClubName: string } }
  | { type: "calendar_share_approved"; data: { partnerClubName: string } }
  | { type: "site_admin_invitation"; data: { profileLabel: string; inviteLink: string } }
  | { type: "support_ticket_reply"; data: { reference: string; subject: string; body: string } }
  | { type: "guardian_invitation"; data: { clubName: string; teamName: string; inviteLink: string } }
  | { type: "player_account_invitation"; data: { playerFirstName: string; inviteLink: string } }

export interface RenderedEmail {
  subject: string
  text: string
}

/**
 * Plain-text rendering only, deliberately -- an HTML template pass with
 * real Ovalball branding is real design work that belongs with an actual
 * provider integration, not built speculatively against no send path. The
 * subject/text shape here is what a provider adapter would wrap in HTML.
 */
export function renderEmailEvent(event: EmailEvent): RenderedEmail {
  switch (event.type) {
    case "club_claim_submitted":
      return {
        subject: `New club claim: ${event.data.clubName}`,
        text: `${event.data.claimantName} (${event.data.claimantEmail}) has claimed ${event.data.clubName}, declaring themselves ${event.data.declaredRole}.\n\nReview: ${event.data.reviewUrl}`,
      }
    case "club_claim_approved":
      return { subject: "Your club claim was approved", text: `Your access to ${event.data.clubName} has been approved.` }
    case "club_claim_rejected":
      return {
        subject: "An update on your club claim",
        text: `Your claim on ${event.data.clubName} was not approved this time.${event.data.reason ? ` ${event.data.reason}` : ""}`,
      }
    case "club_invitation":
      return {
        subject: `You've been invited to ${event.data.clubName} on Ovalball`,
        text: `Join ${event.data.clubName} on Ovalball: ${event.data.inviteLink}`,
      }
    case "partner_club_invitation":
      return {
        subject: `${event.data.invitingClubName} has invited you to join them on Ovalball`,
        text: `${event.data.invitingClubName} has invited you to join them on Ovalball.\n\nJoin Ovalball and connect with ${event.data.invitingClubName}.\n\n${event.data.inviteLink}`,
      }
    case "team_invitation":
      return {
        subject: `You've been invited to ${event.data.teamNames.join(", ")} on Ovalball`,
        text: `Join ${event.data.clubName} (${event.data.teamNames.join(", ")}) on Ovalball: ${event.data.inviteLink}`,
      }
    case "fixture_request_received":
      return {
        subject: `New fixture request from ${event.data.clubName}`,
        text: `${event.data.clubName} has requested a fixture on ${event.data.date} against ${event.data.opponentText}.`,
      }
    case "fixture_request_accepted":
      return { subject: "Fixture confirmed", text: `Your fixture on ${event.data.date} against ${event.data.opponentText} is confirmed.` }
    case "fixture_request_declined":
      return { subject: "Fixture request declined", text: `Your request for ${event.data.date} against ${event.data.opponentText} was declined.` }
    case "fixture_changed":
      return { subject: "Fixture updated", text: `Your fixture on ${event.data.date} against ${event.data.opponentText} changed: ${event.data.change}` }
    case "fixture_cancelled":
      return { subject: "Fixture cancelled", text: `Your fixture on ${event.data.date} against ${event.data.opponentText} has been cancelled.` }
    case "calendar_share_request":
      return { subject: "Calendar sharing request", text: `${event.data.requestingClubName} would like to agree calendar sharing with your club.` }
    case "calendar_share_approved":
      return { subject: "Calendar sharing agreed", text: `${event.data.partnerClubName} has agreed to share calendar availability with your club.` }
    case "site_admin_invitation":
      return {
        subject: "You've been invited as an Ovalball Site Administrator",
        text: `You've been invited to become a ${event.data.profileLabel} on Ovalball: ${event.data.inviteLink}`,
      }
    case "support_ticket_reply":
      return {
        subject: `Re: ${event.data.subject} (${event.data.reference})`,
        text: event.data.body,
      }
    case "guardian_invitation":
      return {
        subject: `You've been invited as a Parent/Guardian at ${event.data.clubName}`,
        text: `${event.data.clubName} has invited you as a Parent/Guardian for ${event.data.teamName} on Ovalball: ${event.data.inviteLink}`,
      }
    case "player_account_invitation":
      return {
        subject: `You've been invited to your own Ovalball login`,
        text: `You've been invited to create your own Ovalball login linked to ${event.data.playerFirstName}'s player record: ${event.data.inviteLink}`,
      }
  }
}
