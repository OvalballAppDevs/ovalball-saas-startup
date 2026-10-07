/**
 * SHARING AN INVITATION -- the same link, the same code, the same words on both clients (CA-M11.1).
 *
 * The website's `/people` and `/teams/[id]` show one triple for a fresh invitation: the join LINK, the
 * human CODE and a QR of the link. The QR encodes nothing but the link (`/join?t=<token>`): scanning it
 * with any phone camera opens the same invitation the link opens, and the app's own scanner accepts
 * only that shape. There is no separate QR payload and no second token model.
 *
 * `invitationJoinUrl` moved here from `lib/invitations/share.ts` (which re-exports it with the site URL
 * filled in). The secret is passed as a value and never stored by either client.
 */

/** The canonical redemption route. Every link, every QR, every share. */
export function invitationJoinUrl(token: string, siteUrl: string): string {
  return `${siteUrl.replace(/\/$/, "")}/join?t=${encodeURIComponent(token)}`
}

/** The route a typed code lands on; the website navigates here so a code gets the same preview a link gets. */
export function invitationCodeUrl(code: string, siteUrl: string): string {
  return `${siteUrl.replace(/\/$/, "")}/join?c=${encodeURIComponent(code)}`
}

/**
 * What a QR scanner may accept: a URL whose path is `/join` on the website, or the app's own scheme, carrying
 * `t` or `c`. Anything else -- another host, another path, a bare string -- is not an Ovalball invitation
 * and is never followed.
 */
export function invitationSecretFromScannedText(text: string, siteUrl: string, appSchemes: readonly string[]): { token: string | null; code: string | null } | null {
  let parsed: URL
  try {
    parsed = new URL(text.trim())
  } catch {
    return null
  }
  const siteHost = (() => {
    try {
      return new URL(siteUrl).host.toLowerCase()
    } catch {
      return null
    }
  })()
  const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:"
  const isSite = isHttp && siteHost !== null && parsed.host.toLowerCase() === siteHost
  const isScheme = appSchemes.some((s) => parsed.protocol === `${s}:`)
  if (!isSite && !isScheme) return null
  const path = (isHttp ? parsed.pathname : `/${parsed.hostname}${parsed.pathname}`).toLowerCase().replace(/\/$/, "")
  if (path !== "/join") return null
  const token = parsed.searchParams.get("t")?.trim() || null
  const code = parsed.searchParams.get("c")?.trim() || null
  if (!token && !code) return null
  return { token, code }
}

export interface InvitationOutcome {
  clubRoles: string[]
  teamLines: string[]
}

/** The roles an invitation carries, in words, for the person sharing it. */
export function describeIntendedOutcome(
  intendedOutcome: unknown,
  teamName: (teamId: string) => string,
  roleLabel: (roleKey: string) => string
): InvitationOutcome {
  const outcome = (intendedOutcome ?? {}) as { roles?: string[]; teams?: { id: string; roles?: string[] }[] }
  const teams = outcome.teams ?? []
  const clubRoles = (outcome.roles ?? []).filter((r) => !teams.some((t) => (t.roles ?? []).includes(r)))
  return {
    clubRoles: clubRoles.map(roleLabel),
    teamLines: teams.map((t) => `${teamName(t.id)}: ${(t.roles ?? []).map(roleLabel).join(", ")}`),
  }
}

export function outcomeLines(outcome: InvitationOutcome): string[] {
  return [...outcome.clubRoles, ...outcome.teamLines]
}

export function invitationExpiryLabel(expiresAt: string | Date | null): string | null {
  if (!expiresAt) return null
  const date = expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
}

/** One fresh invitation, ready to share: what both clients show the moment the credential exists. */
export interface InvitationShareData {
  url: string
  code: string | null
  outcome: string[]
  expiresLabel: string | null
  /** The address an email went to (website only -- the phone sends no email), or null. */
  sentTo: string | null
  /** True after a resend: the previous link and code no longer work. */
  replacesPrevious?: boolean
}

// ---------------------------------------------------------------------------------------------------
// ONE SHARE LAYER (People & Invitations, 2026-10-05)
//
// WhatsApp, Messages and Email are TRANSPORTS for the one canonical link -- never a different link
// and never a record of their own. These build the words and the transport URLs from the link a
// caller already has, so every surface (a staff invitation, a player's team link, a club referral)
// sends the same thing the same way, and a test can hold the QR, the poster, the copied link and every
// message to one URL.
// ---------------------------------------------------------------------------------------------------

/** What a share is for -- the words differ; the link is whatever the server issued. */
export type ShareSubject =
  | { kind: "INVITATION"; clubName: string; roleLine: string | null; placeName: string | null; inviteeName?: string | null }
  | { kind: "TEAM_JOIN"; clubName: string; teamName: string; inviteeName?: string | null }
  | { kind: "REFERRAL"; clubName: string; referredClubName?: string | null }

/**
 * The prefilled message. Human, short, and carrying the link once. Never an internal id.
 *
 *   "Ovalball UAT RUFC has invited you to join Women's 1st Team on Ovalball as Coach. Use this link to
 *    accept your invitation: https://…/join?t=…"
 */
export function shareMessage(subject: ShareSubject, url: string): string {
  const hello = "inviteeName" in subject && subject.inviteeName ? `Hi ${subject.inviteeName.split(" ")[0]}, ` : ""
  switch (subject.kind) {
    case "INVITATION": {
      const where = subject.placeName ?? subject.clubName
      const as = subject.roleLine ? ` as ${subject.roleLine}` : ""
      const lead = `${subject.clubName} has invited you to join ${where} on Ovalball${as}.`
      return `${hello}${lead} Use this link to accept your invitation: ${url}`
    }
    case "TEAM_JOIN": {
      const lead = `${subject.clubName} has invited you to join ${subject.teamName} on Ovalball.`
      return `${hello}${lead} Use this link to ask to join: ${url}`
    }
    case "REFERRAL":
      return `${subject.clubName} uses Ovalball to run its rugby: teams, fixtures, training and people in one place. We think ${subject.referredClubName ?? "your club"} would like it too: ${url}`
  }
}

/** The email subject line for the same share. */
export function shareSubjectLine(subject: ShareSubject): string {
  switch (subject.kind) {
    case "INVITATION":
      return `Your invitation to ${subject.placeName ?? subject.clubName} on Ovalball`
    case "TEAM_JOIN":
      return `Join ${subject.teamName} on Ovalball`
    case "REFERRAL":
      return `${subject.clubName} recommends Ovalball`
  }
}

/** WhatsApp's own share link: opens WhatsApp with the message ready to send to whoever the person picks. */
export function whatsappShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}

/** Messages (SMS/iMessage) with the body filled in; the person picks the recipient. */
export function smsShareUrl(message: string, platform: "ios" | "android" | "web" = "ios"): string {
  return `sms:${platform === "ios" ? "&" : "?"}body=${encodeURIComponent(message)}`
}

/** The person's own mail app, addressed when the address is known. Ovalball sends nothing itself here. */
export function emailShareUrl(message: string, subjectLine: string, to?: string | null): string {
  return `mailto:${to ? encodeURIComponent(to) : ""}?subject=${encodeURIComponent(subjectLine)}&body=${encodeURIComponent(message)}`
}
