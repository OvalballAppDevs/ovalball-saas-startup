import "server-only"

import { getSiteUrl } from "@/lib/site-url"

import type { EmailEventKey } from "./catalogue"
import {
  clubIdentity,
  ctaFallback,
  divider,
  heading,
  infoCard,
  mutedParagraph,
  paragraph,
  primaryCta,
  quotedBody,
  renderEmailDocument,
  safeUrl,
  statusNote,
  subheading,
} from "./design/components"

/**
 * One template per canonical email event.
 *
 * PLAIN TEXT IS WRITTEN, NOT STRIPPED
 *
 * Every template returns its own `text`. Running a tag-stripper over the HTML
 * produces something technically present and practically useless: buttons
 * become bare words with the destination lost, tables collapse into run-on
 * lines, and the one thing a plain-text reader actually needs -- the link --
 * is the first casualty. So the text version is composed deliberately, with
 * the URL spelled out.
 */

export interface RenderedEmail {
  subject: string
  preheader: string
  html: string
  text: string
}

/** Data each template needs. Deliberately narrow: templates receive facts, never raw records. */
export type EmailEventData = {
  club_invitation: { clubName: string; clubLogoUrl: string | null; inviteToken: string; roleLabel: string | null }
  guardian_invitation: { clubName: string; clubLogoUrl: string | null; teamName: string; inviteToken: string }
  player_account_invitation: { playerFirstName: string; inviteToken: string }
  safeguarding_officer_invitation: { clubName: string; clubLogoUrl: string | null; inviteToken: string }
  safeguarding_officer_message: { clubName: string; senderName: string; body: string }
  site_admin_invitation: { profileLabel: string; inviteToken: string }
  partner_club_invitation: { invitingClubName: string; invitedClubName: string; directoryId: string }
  club_claim_submitted: { clubName: string; claimantName: string; declaredRole: string; reviewPath: string }
  support_ticket_reply: { reference: string; subject: string; body: string }
  referral_reward_earned: { referringClubName: string; referredClubName: string; planLabel: string; rewardValue: string }
}

type Renderer<K extends EmailEventKey> = (data: EmailEventData[K], siteUrl: string) => RenderedEmail

function link(path: string, siteUrl: string): string {
  // Built from the canonical origin, then re-checked. A template never
  // receives a destination -- only a token or a path.
  return safeUrl(`${siteUrl}${path}`, siteUrl) ?? siteUrl
}

const SUPPORT_LINE = (siteUrl: string) => `Need help? ${siteUrl}/support`

/* ------------------------------------------------------------------ */
/* Identity and invitations                                            */
/* ------------------------------------------------------------------ */

const clubInvitation: Renderer<"club_invitation"> = (d, siteUrl) => {
  const url = link(`/invite/${d.inviteToken}`, siteUrl)
  const subject = `You've been invited to join ${d.clubName} on Ovalball`
  const preheader = `${d.clubName} has invited you to their club on Ovalball.`
  return {
    subject,
    preheader,
    html: renderEmailDocument({
      title: subject,
      preheader,
      siteUrl,
      body: [
        clubIdentity(d.clubName, d.clubLogoUrl),
        heading(`Join ${d.clubName} on Ovalball`),
        paragraph(
          `${d.clubName} uses Ovalball to run fixtures, teams and matchdays. They've invited you to join them.`
        ),
        d.roleLabel ? infoCard([{ label: "Your role", value: d.roleLabel }]) : "",
        primaryCta("Accept your invitation", url),
        ctaFallback(url),
        mutedParagraph(
          "If you weren't expecting this, you can ignore this email — nothing happens until you accept."
        ),
      ].join("\n"),
    }),
    text: [
      `${d.clubName} has invited you to join them on Ovalball.`,
      "",
      d.roleLabel ? `Your role: ${d.roleLabel}` : "",
      "",
      "Accept your invitation:",
      url,
      "",
      "If you weren't expecting this, you can ignore this email - nothing happens until you accept.",
      "",
      SUPPORT_LINE(siteUrl),
    ]
      .filter((l) => l !== "")
      .join("\n"),
  }
}

const guardianInvitation: Renderer<"guardian_invitation"> = (d, siteUrl) => {
  const url = link(`/guardian-invite/${d.inviteToken}`, siteUrl)
  const subject = `${d.clubName} has invited you as a parent or guardian`
  const preheader = `Link your Ovalball account to your child's team at ${d.clubName}.`
  return {
    subject,
    preheader,
    html: renderEmailDocument({
      title: subject,
      preheader,
      siteUrl,
      body: [
        clubIdentity(d.clubName, d.clubLogoUrl),
        heading("You've been invited as a parent or guardian"),
        paragraph(
          `${d.clubName} has invited you to be linked as a parent or guardian for ${d.teamName}. You'll be able to see fixtures and training, and respond to availability.`
        ),
        primaryCta("Accept and link your account", url),
        ctaFallback(url),
        // Deliberately no child name, no date of birth, no medical or
        // attendance detail. Those live behind a login, not in an inbox.
        mutedParagraph(
          "For your child's privacy, their details are only shown once you've signed in and the link is confirmed."
        ),
      ].join("\n"),
    }),
    text: [
      `${d.clubName} has invited you to be linked as a parent or guardian for ${d.teamName} on Ovalball.`,
      "",
      "Accept and link your account:",
      url,
      "",
      "For your child's privacy, their details are only shown once you've signed in and the link is confirmed.",
      "",
      SUPPORT_LINE(siteUrl),
    ].join("\n"),
  }
}

const playerAccountInvitation: Renderer<"player_account_invitation"> = (d, siteUrl) => {
  const url = link(`/player-invite/${d.inviteToken}`, siteUrl)
  const subject = "Your own Ovalball login is ready to set up"
  const preheader = "Create your login to see your fixtures, training and availability."
  return {
    subject,
    preheader,
    html: renderEmailDocument({
      title: subject,
      preheader,
      siteUrl,
      body: [
        heading(`Set up your Ovalball login, ${d.playerFirstName}`),
        paragraph(
          "You've been invited to create your own Ovalball login, linked to your player record. You'll see your own fixtures and training, and can respond to availability yourself."
        ),
        primaryCta("Create your login", url),
        ctaFallback(url),
        mutedParagraph("Ovalball has no passwords — you'll sign in with a one-time link by email."),
      ].join("\n"),
    }),
    text: [
      `${d.playerFirstName}, you've been invited to create your own Ovalball login, linked to your player record.`,
      "",
      "Create your login:",
      url,
      "",
      "Ovalball has no passwords - you'll sign in with a one-time link by email.",
      "",
      SUPPORT_LINE(siteUrl),
    ].join("\n"),
  }
}

const safeguardingOfficerInvitation: Renderer<"safeguarding_officer_invitation"> = (d, siteUrl) => {
  const url = link(`/invite/safeguarding-officer/${d.inviteToken}`, siteUrl)
  const subject = `${d.clubName} has named you as their Safeguarding Officer`
  const preheader = `Accept to confirm your Safeguarding Officer role at ${d.clubName}.`
  return {
    subject,
    preheader,
    html: renderEmailDocument({
      title: subject,
      preheader,
      siteUrl,
      body: [
        clubIdentity(d.clubName, d.clubLogoUrl),
        heading("You've been named as Safeguarding Officer"),
        paragraph(
          `${d.clubName} has named you as their Safeguarding Officer on Ovalball. Accepting confirms the role and lets club staff contact you through Ovalball rather than by email.`
        ),
        primaryCta("Confirm your role", url),
        ctaFallback(url),
        statusNote(
          "This link confirms a named safeguarding role. Only accept it if you have agreed to act as Safeguarding Officer for this club."
        ),
      ].join("\n"),
    }),
    text: [
      `${d.clubName} has named you as their Safeguarding Officer on Ovalball.`,
      "",
      "Accepting confirms the role and lets club staff contact you through Ovalball rather than by email.",
      "",
      "Confirm your role:",
      url,
      "",
      "This link confirms a named safeguarding role. Only accept it if you have agreed to act as Safeguarding Officer for this club.",
      "",
      SUPPORT_LINE(siteUrl),
    ].join("\n"),
  }
}

const safeguardingOfficerMessage: Renderer<"safeguarding_officer_message"> = (d, siteUrl) => {
  const subject = `Message from ${d.senderName} at ${d.clubName} (via Ovalball)`
  const preheader = `${d.senderName} has sent you a message through Ovalball.`
  return {
    subject,
    preheader,
    html: renderEmailDocument({
      title: subject,
      preheader,
      siteUrl,
      footerNote:
        "You received this by email because you do not yet have an active Ovalball account. Once you accept your Safeguarding Officer invitation, messages arrive in Ovalball instead.",
      body: [
        heading(`Message from ${d.senderName}`),
        mutedParagraph(`Sent on behalf of ${d.clubName} through Ovalball.`),
        quotedBody(d.body),
        divider(),
        mutedParagraph(
          "Reply to this person directly. Ovalball did not create a conversation for this message, because you do not yet have an active account."
        ),
      ].join("\n"),
    }),
    text: [
      `Message from ${d.senderName} at ${d.clubName}, sent through Ovalball.`,
      "",
      d.body,
      "",
      "---",
      "You received this by email because you do not yet have an active Ovalball account, so no Ovalball conversation was created. Reply to this person directly.",
      "",
      SUPPORT_LINE(siteUrl),
    ].join("\n"),
  }
}

const siteAdminInvitation: Renderer<"site_admin_invitation"> = (d, siteUrl) => {
  const url = link(`/invite/site-admin/${d.inviteToken}`, siteUrl)
  const subject = "You've been invited as an Ovalball Site Administrator"
  const preheader = `Accept to take up the ${d.profileLabel} role.`
  return {
    subject,
    preheader,
    html: renderEmailDocument({
      title: subject,
      preheader,
      siteUrl,
      body: [
        heading("You've been invited as a Site Administrator"),
        paragraph(`You've been invited to become a ${d.profileLabel} on Ovalball.`),
        infoCard([{ label: "Administrator profile", value: d.profileLabel }]),
        primaryCta("Accept the invitation", url),
        ctaFallback(url),
        statusNote(
          "Site Administrator access covers every club on Ovalball. Only accept if you were expecting this."
        ),
      ].join("\n"),
    }),
    text: [
      `You've been invited to become a ${d.profileLabel} on Ovalball.`,
      "",
      "Accept the invitation:",
      url,
      "",
      "Site Administrator access covers every club on Ovalball. Only accept if you were expecting this.",
      "",
      SUPPORT_LINE(siteUrl),
    ].join("\n"),
  }
}

/* ------------------------------------------------------------------ */
/* Referral -- the free-month programme, stated exactly                */
/* ------------------------------------------------------------------ */

const partnerClubInvitation: Renderer<"partner_club_invitation"> = (d, siteUrl) => {
  // The canonical destination the product already uses: the signup wizard
  // pre-pointed at this directory club. Not a bespoke invite route.
  const url = link(`/signup?directory=${encodeURIComponent(d.directoryId)}`, siteUrl)
  const subject = `${d.invitingClubName} has invited ${d.invitedClubName} to Ovalball`
  const preheader = `${d.invitingClubName} uses Ovalball to run their rugby club.`
  return {
    subject,
    preheader,
    html: renderEmailDocument({
      title: subject,
      preheader,
      siteUrl,
      body: [
        heading(`${d.invitingClubName} has invited you to Ovalball`),
        paragraph(
          `${d.invitingClubName} uses Ovalball to arrange fixtures, run teams and manage matchdays — and they've invited ${d.invitedClubName} to join them.`
        ),
        paragraph(
          "You'll go through the normal sign-up and club-claim process. Nothing is created for you automatically."
        ),
        primaryCta("See what Ovalball does", url),
        ctaFallback(url),
      ].join("\n"),
    }),
    text: [
      `${d.invitingClubName} has invited ${d.invitedClubName} to join them on Ovalball.`,
      "",
      "Ovalball is how they arrange fixtures, run teams and manage matchdays.",
      "You'll go through the normal sign-up and club-claim process. Nothing is created for you automatically.",
      "",
      "See what Ovalball does:",
      url,
      "",
      SUPPORT_LINE(siteUrl),
    ].join("\n"),
  }
}

const referralRewardEarned: Renderer<"referral_reward_earned"> = (d, siteUrl) => {
  const url = link("/club/settings/ovalball-billing", siteUrl)
  const subject = "You've earned a free month of Ovalball"
  const preheader = `${d.referredClubName} has paid their first subscription, so your next month is on us.`
  return {
    subject,
    preheader,
    html: renderEmailDocument({
      title: subject,
      preheader,
      siteUrl,
      body: [
        heading("You've earned a free month"),
        paragraph(
          `${d.referredClubName} joined Ovalball through ${d.referringClubName} and has now paid their first subscription. That earns your club one month of your current plan, free.`
        ),
        infoCard([
          { label: "Club you referred", value: d.referredClubName },
          { label: "Your plan", value: d.planLabel },
          { label: "Credit applied to your account", value: d.rewardValue },
        ]),
        // The offer is a free month. The pence figure is how that month is
        // recorded in the ledger -- it is not a cash reward, and must never
        // be described as one.
        mutedParagraph(
          "The credit above is one month of your plan at the price it cost when the reward was earned. It applies to your next Ovalball collection and can't be paid out as cash."
        ),
        primaryCta("View your Ovalball subscription", url),
        ctaFallback(url),
      ].join("\n"),
    }),
    text: [
      `${d.referredClubName} joined Ovalball through ${d.referringClubName} and has now paid their first subscription.`,
      "",
      `That earns ${d.referringClubName} one month of your current plan, free.`,
      "",
      `Club you referred: ${d.referredClubName}`,
      `Your plan: ${d.planLabel}`,
      `Credit applied to your account: ${d.rewardValue}`,
      "",
      "The credit is one month of your plan at the price it cost when the reward was earned. It applies to your next Ovalball collection and can't be paid out as cash.",
      "",
      "View your Ovalball subscription:",
      url,
      "",
      SUPPORT_LINE(siteUrl),
    ].join("\n"),
  }
}

/* ------------------------------------------------------------------ */
/* Operational                                                         */
/* ------------------------------------------------------------------ */

const clubClaimSubmitted: Renderer<"club_claim_submitted"> = (d, siteUrl) => {
  const url = link(d.reviewPath, siteUrl)
  const subject = `Club claim to review: ${d.clubName}`
  const preheader = `${d.claimantName} has claimed ${d.clubName}.`
  return {
    subject,
    preheader,
    html: renderEmailDocument({
      title: subject,
      preheader,
      siteUrl,
      body: [
        heading("A club claim needs review"),
        infoCard([
          { label: "Club", value: d.clubName },
          { label: "Claimed by", value: d.claimantName },
          { label: "Declared role", value: d.declaredRole },
        ]),
        paragraph("Nobody at this club can start until the claim is approved."),
        primaryCta("Review the claim", url),
        ctaFallback(url),
      ].join("\n"),
    }),
    text: [
      `A club claim needs Site Admin review.`,
      "",
      `Club: ${d.clubName}`,
      `Claimed by: ${d.claimantName}`,
      `Declared role: ${d.declaredRole}`,
      "",
      "Nobody at this club can start until the claim is approved.",
      "",
      "Review the claim:",
      url,
    ].join("\n"),
  }
}

const supportTicketReply: Renderer<"support_ticket_reply"> = (d, siteUrl) => {
  const subject = `Re: ${d.subject} (${d.reference})`
  const preheader = "Ovalball support has replied to your request."
  return {
    subject,
    preheader,
    html: renderEmailDocument({
      title: subject,
      preheader,
      siteUrl,
      footerNote: `Quote ${d.reference} if you reply.`,
      body: [
        heading("Ovalball support has replied"),
        infoCard([
          { label: "Reference", value: d.reference },
          { label: "Subject", value: d.subject },
        ]),
        subheading("Reply"),
        quotedBody(d.body),
      ].join("\n"),
    }),
    text: [
      `Ovalball support has replied to your request.`,
      "",
      `Reference: ${d.reference}`,
      `Subject: ${d.subject}`,
      "",
      d.body,
      "",
      `Quote ${d.reference} if you reply.`,
      "",
      SUPPORT_LINE(siteUrl),
    ].join("\n"),
  }
}

const RENDERERS = {
  club_invitation: clubInvitation,
  guardian_invitation: guardianInvitation,
  player_account_invitation: playerAccountInvitation,
  safeguarding_officer_invitation: safeguardingOfficerInvitation,
  safeguarding_officer_message: safeguardingOfficerMessage,
  site_admin_invitation: siteAdminInvitation,
  partner_club_invitation: partnerClubInvitation,
  club_claim_submitted: clubClaimSubmitted,
  support_ticket_reply: supportTicketReply,
  referral_reward_earned: referralRewardEarned,
} as const

export function renderEmail<K extends EmailEventKey>(
  eventKey: K,
  data: EmailEventData[K],
  siteUrl: string = getSiteUrl()
): RenderedEmail {
  const renderer = RENDERERS[eventKey] as Renderer<K>
  return renderer(data, siteUrl)
}
