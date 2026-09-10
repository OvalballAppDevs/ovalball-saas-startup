import { CalendarDays, CircleAlert, CircleCheck, CircleDashed, Clock, MapPin, Users } from "lucide-react"

import { KitPlaceholder, RugbyKit } from "@/components/club/rugby-kit"
import type { MatchCentreFixture, MatchCentreSide } from "@/lib/app-context/match-centre-data"
import { cn } from "@/lib/utils"

/**
 * The Match Centre hero -- the digital match invitation.
 *
 * CONTRAST FLOOR: on the forest-950 ground, muted text is white/70 and never
 * lower. Earlier drafts used white/35-/45 for the secondary lines ("Not yet
 * on Ovalball", "Home fixture", the Date/Meet/Kick-off labels) and axe failed
 * every one of them at WCAG AA. Low-alpha white reads as tasteful restraint
 * on a designer's monitor and is unreadable on a phone in daylight, which is
 * exactly where this page gets used.
 *
 * Composition, and why it is this way round: the KIT is the largest element
 * on each side, not the crest. A child recognises the shirt they are about to
 * put on far faster than a club badge, and two clubs in the same league often
 * have similar crests and never similar kits. The crest sits beneath as a
 * small identifying chip.
 *
 * Club names WRAP rather than truncate. "Rossendale RUFC" truncated to
 * "Rossen..." on a 390px screen is worse than two lines, and truncation was
 * the previous behaviour here.
 *
 * Fixture state is carried by an icon AND a word, never by colour alone --
 * "Cancelled" has to survive a colour-blind reader and a greyscale screenshot
 * in a WhatsApp group, which is where these pages actually get shared.
 */

const STATUS_STYLE: Record<
  MatchCentreFixture["status"],
  { label: string; className: string; Icon: typeof CircleCheck }
> = {
  PLANNED: { label: "Planned", className: "bg-white/10 text-white/80 ring-white/15", Icon: CircleDashed },
  AWAITING_OPPOSITION: { label: "Awaiting opposition", className: "bg-amber-400/15 text-amber-100 ring-amber-300/30", Icon: CircleDashed },
  ACCEPTED: { label: "Confirmed", className: "bg-pitch-400/15 text-pitch-200 ring-pitch-300/30", Icon: CircleCheck },
  AMENDMENT_PENDING: { label: "Amendment pending", className: "bg-amber-400/15 text-amber-100 ring-amber-300/30", Icon: CircleAlert },
  CANCELLED: { label: "Cancelled", className: "bg-red-500/20 text-red-100 ring-red-300/40", Icon: CircleAlert },
  COMPLETED: { label: "Completed", className: "bg-white/10 text-white/70 ring-white/15", Icon: CircleCheck },
}

/** 12-hour clock, the way a fixture list reads it: "10:30am", "2pm". */
export function formatClock(time: string | null): string | null {
  if (!time) return null
  const [h, m] = time.split(":")
  const hour = Number(h)
  if (Number.isNaN(hour)) return null
  const period = hour >= 12 ? "pm" : "am"
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  return m === "00" ? `${hour12}${period}` : `${hour12}:${m}${period}`
}

export function formatFixtureDate(kickoffDate: string): string {
  // Parsed as a plain calendar date. A fixture's date is the club's local
  // day, and letting the reader's timezone shift it is how a Sunday match
  // shows up as Saturday for somebody abroad.
  const [y, m, d] = kickoffDate.split("-").map(Number)
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)))
}

/**
 * "Sat 12 Sep" -- for the three-across facts strip, where the long form wraps
 * to three lines inside a 110px column on a phone and stops being scannable.
 * The weekday survives, because "which Saturday" is the thing a parent is
 * actually placing.
 */
export function formatFixtureDateCompact(kickoffDate: string): string {
  const [y, m, d] = kickoffDate.split("-").map(Number)
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)))
}

export function MatchCentreHero({
  fixture,
  homeSide,
  awaySide,
  venueName,
  children,
}: {
  fixture: MatchCentreFixture
  homeSide: MatchCentreSide
  awaySide: MatchCentreSide
  venueName?: string | null
  /**
   * The viewer's own availability, rendered INSIDE the matchday card.
   * The invitation and the reply to it are one object; a reply detached into
   * a separate white card below read as a form about the match rather than
   * an answer to it.
   */
  children?: React.ReactNode
}) {
  const status = STATUS_STYLE[fixture.status]
  const kickoff = formatClock(fixture.kickoffTime)
  const meet = formatClock(fixture.meetTime)

  return (
    <section
      aria-labelledby="mc-hero-heading"
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-forest-900 to-forest-950 text-chalk",
        // A cancelled fixture is visibly, immediately different -- desaturated
        // rather than merely carrying a small red badge.
        fixture.status === "CANCELLED" && "opacity-90 saturate-50"
      )}
    >
      {/*
        Mown stripes, the way a pitch lies after the mower has been up and down
        it. The one piece of atmosphere on the page, kept at 4-5% so it reads
        as texture at arm's length and never competes with a crest, a kit or a
        word. Purely decorative: remove it and nothing is lost but the feeling
        of a matchday.
      */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex">
        {Array.from({ length: 8 }).map((_, i) => (
          <span key={i} className={cn("h-full flex-1", i % 2 === 0 ? "bg-white/[0.035]" : "bg-transparent")} />
        ))}
      </div>

      <div className="relative">
        {/* THE PAGE'S h1. Same outline defect as Training Centre had, fixed
            in both together so the two surfaces stay structurally identical. */}
        <h1 id="mc-hero-heading" className="sr-only">
          {homeSide.clubDisplayName} versus {awaySide.clubDisplayName}
        </h1>

        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-6">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset", status.className)}>
            <status.Icon className="size-3.5" aria-hidden="true" />
            {status.label}
          </span>
          {fixture.competitionIdentity && <span className="text-xs text-white/70">{fixture.competitionIdentity}</span>}
        </div>

        {/* The VS composition. Three columns at every width, because collapsing
            two teams into a stack loses the one thing the hero exists to say. */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-1 px-3 pt-5 pb-1 sm:gap-4 sm:px-6">
          <SideColumn side={homeSide} />
          <div className="flex flex-col items-center gap-1 pt-6 sm:pt-8">
            <span className="font-display text-sm tracking-[0.14em] text-white/70 sm:text-base">VS</span>
            <span className="h-8 w-px bg-white/10 sm:h-12" aria-hidden="true" />
          </div>
          <SideColumn side={awaySide} />
        </div>

        {/* Home or away, stated in words rather than left to be inferred from
            column order -- a parent needs to know whether to travel. */}
        {(fixture.homeAway === "Home" || fixture.homeAway === "Away") && (
          <p className="px-4 pb-1 text-center text-xs tracking-wide text-white/70 uppercase sm:px-6">
            {fixture.homeAway === "Home" ? "Home fixture" : "Away fixture"}
            {venueName ? ` · ${venueName}` : ""}
          </p>
        )}

        {/* The three facts a parent came for. Meet time is given equal weight to
            kickoff, because it is the one they actually have to act on.
            DISPLAY ONLY -- meet time is set in Fixture Management, which owns
            the fixture; this page shows it and never edits it. */}
        <dl className="mt-3 grid grid-cols-3 divide-x divide-white/10 border-t border-white/10">
          <TimeCell Icon={CalendarDays} label="Date" value={formatFixtureDateCompact(fixture.kickoffDate)} />
          <TimeCell Icon={Users} label="Meet" value={meet ?? "Not set"} muted={!meet} />
          <TimeCell Icon={Clock} label="Kick-off" value={kickoff ?? "TBC"} muted={!kickoff} />
        </dl>

        {fixture.status === "CANCELLED" && fixture.cancellationReason && (
          <p className="border-t border-white/10 px-4 py-3 text-sm text-red-100 sm:px-6">
            <span className="font-medium">Cancelled.</span> {fixture.cancellationReason}
          </p>
        )}

        {children && <div className="border-t border-white/10 bg-black/15">{children}</div>}
      </div>
    </section>
  )
}

function TimeCell({
  Icon,
  label,
  value,
  muted = false,
}: {
  Icon: typeof CalendarDays
  label: string
  value: string
  muted?: boolean
}) {
  return (
    <div className="flex flex-col items-center gap-1 px-2 py-3.5 text-center sm:py-4">
      <dt className="flex items-center gap-1.5 text-[11px] tracking-wide text-white/70 uppercase sm:text-xs">
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        {label}
      </dt>
      {/* text-balance keeps "Sat 12 Sep" from leaving one orphan word on a
          second line inside a 110px column. */}
      <dd className={cn("font-display text-sm leading-tight text-balance sm:text-base", muted ? "text-white/70" : "text-chalk")}>{value}</dd>
    </div>
  )
}

function SideColumn({ side }: { side: MatchCentreSide }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-2 text-center">
      {/*
        The crest and the kit sit side by side at the SAME size. The crest used
        to be a third of the kit's height and tucked underneath it, which read
        as a caption on the shirt rather than as the club's own mark -- two
        equal marks beside each other is what a matchday programme does, and it
        is what the club recognises.
      */}
      <div className="flex items-center justify-center gap-2 sm:gap-3">
        {side.clubLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- storage-hosted club logo, not a Next/Image-managed remote source.
          <img src={side.clubLogoUrl} alt="" className="size-16 shrink-0 rounded-lg bg-white/10 object-contain p-1 sm:size-24" />
        ) : (
          <span className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-base font-semibold text-white/50 sm:size-24 sm:text-xl">
            {side.clubDisplayName.slice(0, 2).toUpperCase()}
          </span>
        )}
        {side.kit ? (
          <RugbyKit kit={side.kit} clubName={side.clubDisplayName} variant="primary" className="size-16 text-white sm:size-24" />
        ) : (
          // A club with no structured kit is a real and common state -- an
          // unclaimed opposition almost always is. It gets a deliberate,
          // finished placeholder rather than an empty box.
          <KitPlaceholder className="size-16 text-white/30 sm:size-24" />
        )}
      </div>

      <div className="flex min-w-0 flex-col items-center gap-1.5">
        <div className="min-w-0">
          {/* Wraps, never truncates. text-balance keeps a two-line club name
              from leaving one orphan word on the second line. */}
          <p className="font-display text-sm leading-tight text-balance text-chalk sm:text-lg">{side.clubDisplayName}</p>
          {side.fixtureSeasonTeamIdentity && <p className="mt-0.5 text-xs text-white/70 sm:text-sm">{side.fixtureSeasonTeamIdentity}</p>}
          {!side.claimed && (
            <p className="mt-1 text-[10px] leading-tight tracking-wide text-white/70 uppercase">
              {side.clubDirectoryId ? "Not yet on Ovalball" : "To be confirmed"}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export { MapPin }
