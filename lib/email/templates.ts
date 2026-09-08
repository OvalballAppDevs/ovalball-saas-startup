import "server-only"

import { CONTACT_EMAIL, OPERATOR_STATEMENT, PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/legal/metadata"
import { getSiteUrl } from "@/lib/site-url"

import { templateContract, type EmailTemplateContent } from "./contracts"
import { applyVariables } from "./resolve-content"

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
  club_welcome: { firstName: string; clubName: string; clubLogoUrl: string | null }
  support_ticket_reply: { reference: string; subject: string; body: string }
  referral_reward_earned: { referringClubName: string; referredClubName: string; planLabel: string; rewardValue: string }
}

/**
 * A renderer owns an email's STRUCTURE -- which info card, whether a club
 * crest appears, where a quoted message sits. It does not own its COPY: the
 * subject, preheader, heading, body and button label all arrive as `content`,
 * resolved once by lib/email/resolve-content.ts from the active Site Admin
 * version or the registered default.
 *
 * That split is the whole registry: an administrator can rewrite what an email
 * says without being able to change what it is, who gets it, or what data it
 * can reach.
 */
type Renderer<K extends EmailEventKey> = (
  data: EmailEventData[K],
  siteUrl: string,
  content: EmailTemplateContent
) => RenderedEmail

/**
 * The variable map for one event, built explicitly per event from its own
 * typed data. Nothing generic is ever handed to the interpolator -- there is
 * no object here to walk, so there is no `{{player.date_of_birth}}` to find.
 */
const VARIABLE_MAPS: { [K in EmailEventKey]: (data: EmailEventData[K]) => Record<string, string> } = {
  club_invitation: (d) => ({ club_name: d.clubName, role_label: d.roleLabel ?? "" }),
  guardian_invitation: (d) => ({ club_name: d.clubName }),
  player_account_invitation: (d) => ({ player_first_name: d.playerFirstName }),
  safeguarding_officer_invitation: (d) => ({ club_name: d.clubName }),
  safeguarding_officer_message: (d) => ({ club_name: d.clubName }),
  site_admin_invitation: () => ({}),
  partner_club_invitation: (d) => ({ club_name: d.invitingClubName, invited_club_name: d.invitedClubName }),
  club_claim_submitted: (d) => ({ club_name: d.clubName }),
  club_welcome: (d) => ({ first_name: d.firstName, club_name: d.clubName }),
  support_ticket_reply: (d) => ({ reference: d.reference }),
  referral_reward_earned: (d) => ({ referred_club_name: d.referredClubName }),
}

/**
 * The event's copy with its own variables substituted. Nothing else is
 * reachable.
 *
 * The eyebrow rides along but does NOT come from `content`: it is read
 * straight from the event's code-owned contract, so no amount of editing can
 * change which kind of message an email announces itself as.
 */
type ResolvedCopy = EmailTemplateContent & { eyebrow: string }

function copyFor<K extends EmailEventKey>(
  key: K,
  data: EmailEventData[K],
  content: EmailTemplateContent
): ResolvedCopy {
  const values = VARIABLE_MAPS[key](data)
  return {
    subject: applyVariables(content.subject, values),
    preheader: applyVariables(content.preheader, values),
    heading: applyVariables(content.heading, values),
    body: applyVariables(content.body, values),
    ctaLabel: content.ctaLabel ? applyVariables(content.ctaLabel, values) : null,
    eyebrow: templateContract(key).eyebrow,
  }
}

/** Body copy is authored as paragraphs separated by blank lines. */
function bodyParagraphs(body: string): string {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => paragraph(p))
    .join("\n")
}

function link(path: string, siteUrl: string): string {
  // Built from the canonical origin, then re-checked. A template never
  // receives a destination -- only a token or a path.
  return safeUrl(`${siteUrl}${path}`, siteUrl) ?? siteUrl
}

const SUPPORT_LINE = (siteUrl: string) => `Need help? ${siteUrl}/support`

/**
 * The plain-text counterpart of the shared HTML footer, appended once by
 * {@link renderEmail} rather than composed by each template.
 *
 * It carries the same three facts the HTML footer carries: the product, who
 * operates it, and where a reply lands. A recipient whose client shows the
 * text part must not be told materially less than one reading the HTML.
 */
const TEXT_FOOTER = [
  `${PRODUCT_NAME} - ${PRODUCT_TAGLINE}`,
  OPERATOR_STATEMENT,
  `Replies to this email go to ${CONTACT_EMAIL}.`,
].join("\n")

/* ------------------------------------------------------------------ */
/* Identity and invitations                                            */
/* ------------------------------------------------------------------ */

const clubInvitation: Renderer<"club_invitation"> = (d, siteUrl, content) => {
  const url = link(`/invite/${d.inviteToken}`, siteUrl)
  const c = copyFor("club_invitation", d, content)
  return {
    subject: c.subject,
    preheader: c.preheader,
    html: renderEmailDocument({
      title: c.subject,
      preheader: c.preheader,
      eyebrow: c.eyebrow,
      siteUrl,
      body: [
        clubIdentity(d.clubName, d.clubLogoUrl),
        heading(c.heading),
        bodyParagraphs(c.body),
        d.roleLabel ? infoCard([{ label: "Your role", value: d.roleLabel }]) : "",
        primaryCta(c.ctaLabel ?? "Accept your invitation", url),
        ctaFallback(url),
        mutedParagraph(
          "If you weren't expecting this, you can ignore this email — nothing happens until you accept."
        ),
      ].join("\n"),
    }),
    text: [
      c.body,
      "",
      d.roleLabel ? `Your role: ${d.roleLabel}` : "",
      "",
      `${c.ctaLabel ?? "Accept your invitation"}:`,
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

const guardianInvitation: Renderer<"guardian_invitation"> = (d, siteUrl, content) => {
  const url = link(`/guardian-invite/${d.inviteToken}`, siteUrl)
  const c = copyFor("guardian_invitation", d, content)
  return {
    subject: c.subject,
    preheader: c.preheader,
    html: renderEmailDocument({
      title: c.subject,
      preheader: c.preheader,
      eyebrow: c.eyebrow,
      siteUrl,
      body: [
        clubIdentity(d.clubName, d.clubLogoUrl),
        heading(c.heading),
        bodyParagraphs(c.body),
        primaryCta(c.ctaLabel ?? "Accept and link your account", url),
        ctaFallback(url),
        // Deliberately no child name, no date of birth, no medical or
        // attendance detail. Those live behind a login, not in an inbox.
        mutedParagraph(
          "For your child's privacy, their details are only shown once you've signed in and the link is confirmed."
        ),
      ].join("\n"),
    }),
    text: [
      c.body,
      "",
      `${c.ctaLabel ?? "Accept and link your account"}:`,
      url,
      "",
      "For your child's privacy, their details are only shown once you've signed in and the link is confirmed.",
      "",
      SUPPORT_LINE(siteUrl),
    ].join("\n"),
  }
}

const playerAccountInvitation: Renderer<"player_account_invitation"> = (d, siteUrl, content) => {
  const url = link(`/player-invite/${d.inviteToken}`, siteUrl)
  const c = copyFor("player_account_invitation", d, content)
  return {
    subject: c.subject,
    preheader: c.preheader,
    html: renderEmailDocument({
      title: c.subject,
      preheader: c.preheader,
      eyebrow: c.eyebrow,
      siteUrl,
      body: [
        heading(c.heading),
        bodyParagraphs(c.body),
        primaryCta(c.ctaLabel ?? "Create your login", url),
        ctaFallback(url),
        mutedParagraph("Ovalball has no passwords — you'll sign in with a one-time link by email."),
      ].join("\n"),
    }),
    text: [
      c.body,
      "",
      `${c.ctaLabel ?? "Create your login"}:`,
      url,
      "",
      "Ovalball has no passwords - you'll sign in with a one-time link by email.",
      "",
      SUPPORT_LINE(siteUrl),
    ].join("\n"),
  }
}

const safeguardingOfficerInvitation: Renderer<"safeguarding_officer_invitation"> = (d, siteUrl, content) => {
  const c = copyFor("safeguarding_officer_invitation", d, content)
  const url = link(`/invite/safeguarding-officer/${d.inviteToken}`, siteUrl)
  const subject = c.subject
  const preheader = c.preheader
  return {
    subject,
    preheader,
    html: renderEmailDocument({
      title: subject,
      preheader,
      eyebrow: c.eyebrow,
      siteUrl,
      body: [
        clubIdentity(d.clubName, d.clubLogoUrl),
        heading(c.heading),
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

const safeguardingOfficerMessage: Renderer<"safeguarding_officer_message"> = (d, siteUrl, content) => {
  const c = copyFor("safeguarding_officer_message", d, content)
  const subject = c.subject
  const preheader = c.preheader
  return {
    subject,
    preheader,
    html: renderEmailDocument({
      title: subject,
      preheader,
      eyebrow: c.eyebrow,
      siteUrl,
      footerNote:
        "You received this by email because you do not yet have an active Ovalball account. Once you accept your Safeguarding Officer invitation, messages arrive in Ovalball instead.",
      body: [
        heading(c.heading),
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

const siteAdminInvitation: Renderer<"site_admin_invitation"> = (d, siteUrl, content) => {
  const c = copyFor("site_admin_invitation", d, content)
  const url = link(`/invite/site-admin/${d.inviteToken}`, siteUrl)
  const subject = c.subject
  const preheader = c.preheader
  return {
    subject,
    preheader,
    html: renderEmailDocument({
      title: subject,
      preheader,
      eyebrow: c.eyebrow,
      siteUrl,
      body: [
        heading(c.heading),
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

const partnerClubInvitation: Renderer<"partner_club_invitation"> = (d, siteUrl, content) => {
  const c = copyFor("partner_club_invitation", d, content)
  // The canonical destination the product already uses: the signup wizard
  // pre-pointed at this directory club. Not a bespoke invite route.
  const url = link(`/signup?directory=${encodeURIComponent(d.directoryId)}`, siteUrl)
  const subject = c.subject
  const preheader = c.preheader
  return {
    subject,
    preheader,
    html: renderEmailDocument({
      title: subject,
      preheader,
      eyebrow: c.eyebrow,
      siteUrl,
      body: [
        heading(c.heading),
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

const referralRewardEarned: Renderer<"referral_reward_earned"> = (d, siteUrl, content) => {
  const c = copyFor("referral_reward_earned", d, content)
  const url = link("/club/settings/ovalball-billing", siteUrl)
  const subject = c.subject
  const preheader = c.preheader
  return {
    subject,
    preheader,
    html: renderEmailDocument({
      title: subject,
      preheader,
      eyebrow: c.eyebrow,
      siteUrl,
      body: [
        heading(c.heading),
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

const clubClaimSubmitted: Renderer<"club_claim_submitted"> = (d, siteUrl, content) => {
  const c = copyFor("club_claim_submitted", d, content)
  const url = link(d.reviewPath, siteUrl)
  const subject = c.subject
  const preheader = c.preheader
  return {
    subject,
    preheader,
    html: renderEmailDocument({
      title: subject,
      preheader,
      eyebrow: c.eyebrow,
      siteUrl,
      body: [
        heading(c.heading),
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

const clubWelcome: Renderer<"club_welcome"> = (d, siteUrl, content) => {
  // The destination is generated here, from canonical routing -- an editable
  // CTA URL would turn every welcome email into a correctly-branded,
  // correctly-authenticated phishing vector.
  const url = link("/dashboard", siteUrl)
  const c = copyFor("club_welcome", d, content)
  return {
    subject: c.subject,
    preheader: c.preheader,
    html: renderEmailDocument({
      title: c.subject,
      preheader: c.preheader,
      eyebrow: c.eyebrow,
      siteUrl,
      body: [
        clubIdentity(d.clubName, d.clubLogoUrl),
        heading(c.heading),
        bodyParagraphs(c.body),
        primaryCta(c.ctaLabel ?? "Open Ovalball", url),
        ctaFallback(url),
      ].join("\n"),
    }),
    text: [c.heading, "", c.body, "", `${c.ctaLabel ?? "Open Ovalball"}:`, url, "", SUPPORT_LINE(siteUrl)].join("\n"),
  }
}

const supportTicketReply: Renderer<"support_ticket_reply"> = (d, siteUrl, content) => {
  const c = copyFor("support_ticket_reply", d, content)
  const subject = c.subject
  const preheader = c.preheader
  return {
    subject,
    preheader,
    html: renderEmailDocument({
      title: subject,
      preheader,
      eyebrow: c.eyebrow,
      siteUrl,
      footerNote: `Quote ${d.reference} if you reply.`,
      body: [
        heading(c.heading),
        infoCard([
          { label: "Reference", value: d.reference },
          { label: "Subject", value: d.subject },
        ]),
        subheading("Our reply"),
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
  club_welcome: clubWelcome,
  support_ticket_reply: supportTicketReply,
  referral_reward_earned: referralRewardEarned,
} as const

export function renderEmail<K extends EmailEventKey>(
  eventKey: K,
  data: EmailEventData[K],
  siteUrl: string = getSiteUrl(),
  content?: EmailTemplateContent
): RenderedEmail {
  const renderer = RENDERERS[eventKey] as Renderer<K>
  // Defaulting to the registered content keeps this callable synchronously --
  // by tests, by the preview fixtures, and by anything that has not resolved a
  // Site Admin override. Production passes the resolved content explicitly.
  const rendered = renderer(data, siteUrl, content ?? templateContract(eventKey).default)

  // The plain-text brand footer is appended HERE, not in each template.
  //
  // It was previously carried by SUPPORT_LINE, which every template happened
  // to end with -- except one. club_claim_submitted did not, and a template
  // added next year would be just as free to forget. The HTML side cannot have
  // that problem because every template renders through one shell; doing the
  // same for text makes the two structurally equal rather than equal by
  // convention.
  return { ...rendered, text: `${rendered.text.trimEnd()}\n\n${TEXT_FOOTER}` }
}
