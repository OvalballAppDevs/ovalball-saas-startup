import "server-only"

import type { EmailEventKey } from "./catalogue"
import type { EmailEventData } from "./templates"

/**
 * Controlled fixture data for the developer email preview.
 *
 * Everything here is obviously fake and deliberately awkward: a very long
 * club name, a hyphenated team, a multi-paragraph message. Templates look
 * fine with "Test Club"; they break on "Kingston-upon-Thames Rugby Football
 * Club (Colts & Juniors)", which is the sort of name real clubs actually
 * have.
 *
 * No real club, person or address appears in this file.
 */

const LONG_CLUB = "Kingston-upon-Thames Rugby Football Club (Colts & Juniors)"

export const PREVIEW_FIXTURES: { [K in EmailEventKey]: Array<{ label: string; data: EmailEventData[K] }> } = {
  club_invitation: [
    {
      label: "Typical",
      data: {
        clubName: "Sample RUFC",
        clubLogoUrl: null,
        inviteToken: "preview-token-0000",
        roleLabel: "Club Administrator",
      },
    },
    {
      label: "Long club name, no role",
      data: { clubName: LONG_CLUB, clubLogoUrl: null, inviteToken: "preview-token-0000", roleLabel: null },
    },
  ],
  guardian_invitation: [
    {
      label: "Typical",
      data: {
        clubName: "Sample RUFC",
        clubLogoUrl: null,
        teamName: "Under 12s",
        inviteToken: "preview-token-0000",
      },
    },
    {
      label: "Long club and team name",
      data: {
        clubName: LONG_CLUB,
        clubLogoUrl: null,
        teamName: "Under 14s Girls Development Squad",
        inviteToken: "preview-token-0000",
      },
    },
  ],
  player_account_invitation: [
    { label: "Typical", data: { playerFirstName: "Alex", inviteToken: "preview-token-0000" } },
  ],
  safeguarding_officer_invitation: [
    {
      label: "Typical",
      data: { clubName: "Sample RUFC", clubLogoUrl: null, inviteToken: "preview-token-0000" },
    },
  ],
  safeguarding_officer_message: [
    {
      label: "Short message",
      data: {
        clubName: "Sample RUFC",
        senderName: "A Club Administrator",
        body: "Could you give me a call about the age-grade paperwork for Saturday?",
      },
    },
    {
      label: "Multi-paragraph, with markup in the body",
      data: {
        clubName: LONG_CLUB,
        senderName: "A Club Administrator",
        // Deliberately contains markup: the template must escape it, not
        // render it. A message author is not trusted to supply HTML.
        body: "First paragraph about the weekend.\n\nSecond paragraph with <b>markup</b> & an ampersand.\n\nThird paragraph.",
      },
    },
  ],
  site_admin_invitation: [
    { label: "Full administrator", data: { profileLabel: "Full Site Administrator", inviteToken: "preview-token-0000" } },
  ],
  partner_club_invitation: [
    {
      label: "Typical",
      data: {
        invitingClubName: "Sample RUFC",
        invitedClubName: "Another Sample RFC",
        directoryId: "00000000-0000-0000-0000-000000000000",
      },
    },
  ],
  club_claim_submitted: [
    {
      label: "Typical",
      data: {
        clubName: "Sample RUFC",
        claimantName: "A Claimant",
        declaredRole: "Club Secretary",
        reviewPath: "/admin/claims",
      },
    },
  ],
  support_ticket_reply: [
    {
      label: "Typical",
      data: {
        reference: "OV-1234",
        subject: "Can't see our fixtures",
        body: "Thanks for getting in touch — we've corrected the season on your account, and your fixtures should be visible now.",
      },
    },
  ],
  referral_reward_earned: [
    {
      label: "Standard plan",
      data: {
        referringClubName: "Sample RUFC",
        referredClubName: "Another Sample RFC",
        planLabel: "Standard",
        rewardValue: "£15.00",
      },
    },
  ],
}
