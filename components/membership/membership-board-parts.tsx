import type { ReactNode } from "react"
import Link from "next/link"
import {
  MONTH_STATUS_TONE,
  STANDING_LABEL,
  STANDING_TONE,
  remindAgainOn,
  type MembershipRow,
  type MembershipStanding,
  type StandingCounts,
  type StandingTone,
} from "@ovalball/contracts/membership/board"
import type { TeamStanding } from "@ovalball/contracts/membership/operate"
import { OBLIGATION_STATUS_SHORT } from "@ovalball/contracts/club/finance"

/**
 * THE MEMBERSHIP BOARD'S PARTS ON THE WEBSITE (Club Memberships Part 2) -- what the club's Memberships area, a
 * member's page and a team's view draw the server's one standing (`internal.membership_standing`) with, so the club
 * and a team can never be shown two different answers about whether somebody is paid up.
 *
 * Nothing here decides anything. A standing is a word with a tint behind it, never the tint alone; red is kept for
 * what has actually gone wrong. THE STANDING BAR is the area's one bold element: one stacked bar of the squad's
 * standings, the same on the overview, each team and a team's own page. It is hidden from screen readers because the
 * legend beside it says the same thing in words, with the numbers.
 *
 * Server-safe on purpose (no client state), so the pages render it without shipping script for it.
 */

const PILL: Record<StandingTone, string> = {
  settled: "bg-mint-100 text-forest-800 border-mint-100",
  moving: "bg-white text-rugby-700 border-mint-300",
  neutral: "bg-chalk text-ink-muted border-ink/15",
  attention: "bg-amber-50 text-amber-800 border-amber-200",
  problem: "bg-red-50 text-destructive-text border-red-100",
  quiet: "bg-white text-ink-muted border-ink/15",
}

/** The bar's fills, by meaning: forest settled, mint on its way, grey due, amber look soon, red gone wrong. */
const FILL: Record<StandingTone, string> = {
  settled: "bg-forest-800",
  moving: "bg-mint-300",
  quiet: "bg-ink/10",
  neutral: "bg-ink/30",
  attention: "bg-amber-500",
  problem: "bg-destructive-text",
}

/**
 * Not set up and Overdue share a tone (somebody should look soon) and sit side by side in the bar, so Not set up is
 * drawn hollow -- nothing is set up yet -- and the two never read as one block. Shape, not a new colour.
 */
const SEGMENT: Partial<Record<MembershipStanding, string>> = { NOT_SET_UP: "bg-white ring-2 ring-inset ring-amber-500" }

function fillFor(s: MembershipStanding): string {
  return SEGMENT[s] ?? FILL[STANDING_TONE[s]]
}

/**
 * The bar fills from the left like a season getting sorted: what is settled first, what needs somebody last. This is
 * presentation order only -- lists keep the contract's working order (STANDING_ORDER), most urgent first.
 */
export const BAR_ORDER: MembershipStanding[] = ["UP_TO_DATE", "COLLECTING", "EXEMPT", "DUE", "NOT_SET_UP", "OVERDUE", "ACTION_NEEDED"]

export function standingCount(c: StandingCounts, s: MembershipStanding): number {
  switch (s) {
    case "UP_TO_DATE":
      return c.upToDate
    case "COLLECTING":
      return c.collecting
    case "DUE":
      return c.due
    case "OVERDUE":
      return c.overdue
    case "ACTION_NEEDED":
      return c.actionNeeded
    case "NOT_SET_UP":
      return c.notSetUp
    case "EXEMPT":
      return c.exempt
    case "ENDED":
      return c.ended ?? 0
  }
}

/** Everybody somebody has something to do about: Action needed, Overdue, Not set up and Due, each counted once. */
export function needActionCount(c: StandingCounts): number {
  return c.actionNeeded + c.overdue + c.notSetUp + c.due
}

/**
 * A MONTH'S PAYMENT RECORD in the same tones as a person's standing, so one page never shows Overdue amber on the
 * person and red on their month: settled when paid, moving when the money is on its way, neutral when not yet
 * collected, amber when late, red only when it went wrong, quiet when nothing is owed. The words are the ledger's own
 * (OBLIGATION_STATUS_SHORT), which never collide with a standing's.
 */
/** The one month tone (packages/contracts/src/membership/board.ts), shared with the phone. */
export { MONTH_STATUS_TONE }

export function MonthStatusChip({ status }: { status: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${PILL[MONTH_STATUS_TONE[status] ?? "quiet"]}`}>
      {OBLIGATION_STATUS_SHORT[status] ?? "Recorded"}
    </span>
  )
}

export function StandingPill({ standing, className = "" }: { standing: MembershipStanding; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${PILL[STANDING_TONE[standing]]} ${className}`}>
      {STANDING_LABEL[standing]}
    </span>
  )
}

function Bar({ parts, size, className }: { parts: { key: string; fill: string; n: number }[]; size: "lg" | "sm"; className: string }) {
  const shown = parts.filter((p) => p.n > 0)
  return (
    <div aria-hidden="true" className={`flex w-full gap-0.5 overflow-hidden rounded-full ${size === "lg" ? "h-5" : "h-2"} ${shown.length === 0 ? "bg-ink/5" : ""} ${className}`}>
      {shown.map((p) => (
        // Proportional, but a standing anybody is in never disappears: every part keeps a minimum width.
        <span key={p.key} className={`h-full first:rounded-l-full last:rounded-r-full ${p.fill}`} style={{ flexGrow: p.n, flexBasis: 0, minWidth: size === "lg" ? 6 : 3 }} />
      ))}
    </div>
  )
}

/** THE STANDING BAR. */
export function StandingBar({ counts, size = "lg", className = "" }: { counts: StandingCounts; size?: "lg" | "sm"; className?: string }) {
  return <Bar size={size} className={className} parts={BAR_ORDER.map((s) => ({ key: s, fill: fillFor(s), n: standingCount(counts, s) }))} />
}

/**
 * A team's bar on the club's overview, from the club board's own team breakdown: up to date, collecting, exempt and
 * everybody who needs action (one amber part -- the breakdown counts them together).
 */
export function TeamStandingBar({ team, className = "" }: { team: TeamStanding; className?: string }) {
  return (
    <Bar
      size="sm"
      className={className}
      parts={[
        { key: "up", fill: FILL.settled, n: team.upToDate },
        { key: "collecting", fill: FILL.moving, n: team.collecting },
        { key: "exempt", fill: FILL.quiet, n: team.exempt },
        { key: "needs", fill: FILL.attention, n: team.needsAction },
      ]}
    />
  )
}

/** The legend: every standing in words with its number, in the bar's order. Optionally each is a way into the list. */
export function StandingLegend({
  counts,
  hrefFor,
  showZero = true,
  className = "",
}: {
  counts: StandingCounts
  hrefFor?: (standing: MembershipStanding) => string
  showZero?: boolean
  className?: string
}) {
  const items = BAR_ORDER.map((s) => ({ s, n: standingCount(counts, s) })).filter((i) => showZero || i.n > 0)
  return (
    <ul aria-label="Members by standing" className={`flex flex-wrap gap-x-4 gap-y-1 text-sm ${className}`}>
      {items.map(({ s, n }) => {
        const body = (
          <>
            <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-[3px] ${fillFor(s)}`} />
            <span className={n === 0 ? "text-ink-muted" : "text-ink"}>{STANDING_LABEL[s]}</span>
            <span className={`tabular-nums ${n === 0 ? "text-ink-muted" : "font-semibold text-ink"}`}>{n}</span>
          </>
        )
        return (
          <li key={s}>
            {hrefFor && n > 0 ? (
              <Link
                href={hrefFor(s)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-md underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-forest-800"
              >
                {body}
              </Link>
            ) : (
              <span className="inline-flex min-h-9 items-center gap-1.5">{body}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * A white panel: the one surface every section of these pages sits on. Its heading is the section's h2, or h3 where
 * the page has its own subject heading above it (a member's page).
 */
export function MembershipPanel({
  id,
  title,
  description,
  action,
  children,
  className = "",
  level = 2,
}: {
  /** The heading's id, which names the section for assistive technology. */
  id: string
  title: string
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  level?: 2 | 3
}) {
  const Heading = level === 3 ? "h3" : "h2"
  return (
    <section aria-labelledby={id} className={`min-w-0 rounded-2xl border border-ink/10 bg-white p-5 md:p-6 ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <Heading id={id} className="text-base font-semibold text-ink">
            {title}
          </Heading>
          {description ? <p className="mt-1 max-w-prose text-sm text-ink-muted">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/**
 * A player is shown by initials: player photographs are not part of this domain's read, and a person's picture is
 * never substituted for another's.
 */
export function MemberInitials({ firstName, surname, size = "md" }: { firstName: string; surname: string; size?: "md" | "lg" }) {
  const initials = `${firstName.trim().charAt(0)}${surname.trim().charAt(0)}`.toUpperCase() || "?"
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-mint-100 font-semibold text-forest-800 ${size === "lg" ? "size-14 text-lg" : "size-9 text-xs"}`}
    >
      {initials}
    </span>
  )
}

/** A date as a club reads it in the UK ("3 Oct"), whatever the server's own clock is set to. */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" })
}

/** "6 Oct, 10:42", UK time. */
export function shortDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })
}

/** The month a board is for ("October"), from its as-of date. */
export function monthName(isoDate: string): string {
  return new Date(`${isoDate.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" })
}

/** "Reminded by Tom Hale, 3 Oct · can remind again 6 Oct", or null when nobody has been reminded. */
export function remindedLine(row: Pick<MembershipRow, "lastRemindedAt" | "lastRemindedBy" | "canRemind" | "standing" | "reason">): string | null {
  if (!row.lastRemindedAt) return null
  const when = shortDate(row.lastRemindedAt)
  const who = row.lastRemindedBy ? `Reminded by ${row.lastRemindedBy}, ${when}` : `Reminded ${when}`
  const again = remindAgainOn(row)
  return again ? `${who} · can remind again ${again}` : who
}

/** Who pays, as the club's board knows it. Never a contact detail. */
export function payerLine(payer: MembershipRow["payer"]): string {
  if (!payer) return "Nobody yet"
  return payer.relationship === "self" ? "Pays for themselves" : (payer.name ?? "A guardian")
}

/** The player's name, as the server holds it. */
export function memberName(row: Pick<MembershipRow, "firstName" | "surname">): string {
  return `${row.firstName} ${row.surname}`.trim() || "Unnamed player"
}
