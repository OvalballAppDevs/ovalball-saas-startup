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
