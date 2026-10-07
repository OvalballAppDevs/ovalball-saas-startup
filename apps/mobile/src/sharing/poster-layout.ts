/**
 * THE POSTER, AS WORDS AND LINES -- pure, so a poster's copy and its line breaks are tested without a
 * phone (People & Invitations; it grew out of the Joining Pass, which it replaces).
 *
 * ONE COMPOSITION, THREE VARIANTS. An invitation to one person, a team's joining link and a club
 * referral are different things in the database and stay different there; on paper they are the same
 * approved template -- Ovalball's mark, a rugby photograph fading into forest, the club's real crest,
 * the real QR on white -- with the words changed. Nothing here issues, stores or looks anything up:
 * every word comes from the link a caller already holds and the club's canonical identity. A poster
 * never carries an email address, because a picture travels further than the message it was sent in.
 */

export type PosterVariant = "INVITATION" | "TEAM_JOIN" | "REFERRAL"

export interface PosterIdentity {
  clubName: string
  crestUrl: string | null
}

export interface PosterSubject {
  variant: PosterVariant
  /** INVITATION: what they are invited as, in words ("Coach", "Club Admin", "Physio"). */
  role?: string | null
  /** The team it is for, when there is one ("Women's 1st Team"). */
  teamName?: string | null
}

/** One line of the stacked headline. `lead` is the big Bebas line, `joiner` the small connecting word. */
export interface PosterLine {
  text: string
  tone: "lead" | "accent" | "joiner" | "place"
}

export interface PosterCopy {
  stack: PosterLine[]
  /** One sentence under the stack (the referral's promise), or null. */
  standfirst: string | null
  /** What to do with the QR. */
  scanLine: string
  /** Where a code can be typed instead, or null when there is no code. */
  codeLine: string | null
  footnote: string
  expiry: string | null
}

/** The website's code-entry address as a person types it: the host and `/join`, no scheme. */
export function joinAddressForPrint(siteUrl: string): string {
  return `${siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}/join`
}

/**
 * The words on a poster.
 *
 *   INVITATION  YOU'VE BEEN INVITED / as a / COACH / for / WOMEN'S 1ST TEAM / at / Ovalball UAT RUFC
 *   TEAM_JOIN   JOIN / WOMEN'S 1ST TEAM / at / Ovalball UAT RUFC
 *   REFERRAL    RISE / TOGETHER. -- "Your club, on Ovalball: ..." -- written to the club that RECEIVES it (the
 *               owner's decision, 2026-10-05): the referring club is named in the footnote, never asked to recommend.
 */
export function posterCopy(
  identity: PosterIdentity,
  subject: PosterSubject,
  share: { code: string | null; expiresLabel: string | null },
  siteUrl: string
): PosterCopy {
  const where = joinAddressForPrint(siteUrl)
  const codeLine = share.code ? `or enter ${share.code} at ${where}` : null
  const expiry = share.expiresLabel ? `Open until ${share.expiresLabel}` : null

  if (subject.variant === "REFERRAL") {
    return {
      stack: [
        { text: "RISE", tone: "lead" },
        { text: "TOGETHER.", tone: "accent" },
      ],
      standfirst: "Your club, on Ovalball: teams, fixtures, training and people in one place.",
      scanLine: "Scan to see what Ovalball does",
      codeLine: null,
      footnote: `Recommended by ${identity.clubName}.`,
      expiry,
    }
  }

  if (subject.variant === "TEAM_JOIN") {
    return {
      stack: [
        { text: "JOIN", tone: "lead" },
        { text: (subject.teamName ?? identity.clubName).toUpperCase(), tone: "accent" },
        { text: "at", tone: "joiner" },
        { text: identity.clubName, tone: "place" },
      ],
      standfirst: null,
      scanLine: "Scan to ask to join on Ovalball",
      codeLine,
      footnote: "Using it asks to join. The club decides.",
      expiry,
    }
  }

  const stack: PosterLine[] = [{ text: "YOU'VE BEEN INVITED", tone: "lead" }]
  if (subject.role) {
    stack.push({ text: articleFor(subject.role), tone: "joiner" }, { text: subject.role.toUpperCase(), tone: "accent" })
  }
  if (subject.teamName) stack.push({ text: "for", tone: "joiner" }, { text: subject.teamName.toUpperCase(), tone: "accent" })
  stack.push({ text: subject.teamName || subject.role ? "at" : "to join", tone: "joiner" }, { text: identity.clubName, tone: "place" })
  return {
    stack,
    standfirst: null,
    scanLine: "Scan to join on Ovalball",
    codeLine,
    footnote: "Personal to the person it was sent to: it only works with the email address it was issued for.",
    expiry,
  }
}

/** "as a Coach", "as an Assistant Coach". */
function articleFor(role: string): string {
  return /^[aeiou]/i.test(role.trim()) ? "as an" : "as a"
}

/**
 * Break `text` into at most `maxLines` lines no wider than `maxWidth`, measured as `fontSize * em` per
 * character (an average advance for the face; SVG text does not wrap itself). A word longer than a line
 * is kept whole rather than split; what does not fit in the last line ends in an ellipsis.
 */
export function wrapLines(text: string, maxWidth: number, fontSize: number, em = 0.56, maxLines = 2): string[] {
  const perLine = Math.max(2, Math.floor(maxWidth / (fontSize * em)))
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (!current || next.length <= perLine) {
      current = next
      continue
    }
    lines.push(current)
    current = word
  }
  if (current) lines.push(current)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  const last = kept[maxLines - 1]
  kept[maxLines - 1] = last.length + 1 > perLine ? `${last.slice(0, perLine - 1).trimEnd()}…` : `${last}…`
  return kept
}
