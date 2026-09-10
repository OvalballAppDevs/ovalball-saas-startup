import { CalendarDays, CalendarHeart, CircleAlert, Clock, MapPin, Users } from "lucide-react"

import { formatClock } from "@/components/fixtures/match-centre/hero"
import { formatEventDateRange, type EventCentreContext } from "@/lib/app-context/event-centre-data"
import { cn } from "@/lib/utils"

/**
 * THE EVENT HERO -- the club, as the thing that is happening.
 *
 * AN OBVIOUS SIBLING, NOT A CLONE. Same forest ground, same mown stripes at
 * the same 3.5%, same white/70 contrast floor, same status pill carrying an
 * icon AND a word, same divided facts strip. Put Match Centre, Training Centre
 * and this side by side and they are plainly one product.
 *
 * WHAT IS DELIBERATELY GONE, because an event has none of it: the opposition,
 * the VS, the second crest, home/away, the result, the kit. A club open day
 * has no side to weigh against another, so the crest is centred and the eye
 * goes straight down the middle -- the same move Training Centre made, for the
 * same reason.
 *
 * WHAT IS DELIBERATELY NEW. An event is the only one of the three that can
 * span DAYS, so the facts strip leads with a date RANGE rather than a single
 * date, and the range is written the way a person says it -- "12-14 September
 * 2026" -- never as two timestamps side by side. And an event is the only one
 * that can belong to the whole club, so the hero names WHO it is for: every
 * team, or the ones involved.
 *
 * THE ACCENT. Match Centre runs to kick-off, Training Centre to start and
 * finish, and this one carries a plum eyebrow reading CLUB EVENT. One word and
 * one accent inside the established system -- not a second colour scheme, and
 * never mistakable for a match or a session.
 */
export function EventCentreHero({
  event,
  clubLogoUrl,
  children,
}: {
  event: EventCentreContext
  clubLogoUrl: string | null
  /**
   * The viewer's own response, rendered INSIDE the card -- the same decision
   * Match Centre and Training Centre made, for the same reason: the invitation
   * and the reply to it are one object.
   */
  children?: React.ReactNode
}) {
  const cancelled = event.status === "CANCELLED"
  const start = formatClock(event.startTime)
  const finish = formatClock(event.endTime)

  // WHO IT IS FOR, in words. A club-wide event says so rather than listing
  // eighteen teams; a scoped event names them, and stops at three before
  // counting the rest so the hero cannot be pushed off the screen by a
  // ten-team presentation evening.
  const audience = event.isClubWide
    ? "All Teams"
    : event.teams.length === 0
      ? null
      : event.teams.length <= 3
        ? event.teams.map((t) => t.displayName).join(" · ")
        : `${event.teams
            .slice(0, 3)
            .map((t) => t.displayName)
            .join(" · ")} +${event.teams.length - 3} more`

  return (
    <section
      aria-labelledby="ec-hero-heading"
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-forest-900 to-forest-950 text-chalk",
        cancelled && "opacity-90 saturate-50"
      )}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex">
        {Array.from({ length: 8 }).map((_, i) => (
          <span key={i} className={cn("h-full flex-1", i % 2 === 0 ? "bg-white/[0.035]" : "bg-transparent")} />
        ))}
      </div>

      <div className="relative">
        {/* The page's h1. The visible name below is the same sentence; this
            one carries the date so a screen-reader user landing here knows
            which event they are on without hunting for the facts strip. */}
        <h1 id="ec-hero-heading" className="sr-only">
          {event.name}, {formatEventDateRange(event.startsOn, event.endsOn)}
        </h1>

        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-6">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
              cancelled ? "bg-red-500/20 text-red-100 ring-red-300/40" : "bg-white/10 text-white/80 ring-white/15"
            )}
          >
            {cancelled ? <CircleAlert className="size-3.5" aria-hidden="true" /> : <CalendarHeart className="size-3.5" aria-hidden="true" />}
            {cancelled ? "Cancelled" : "Scheduled"}
          </span>
          {event.isMultiDay && <span className="text-xs text-white/70">Runs over several days</span>}
        </div>

        <div className="flex flex-col items-center gap-3 px-4 pt-5 pb-1 sm:px-6">
          {clubLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- storage-hosted club logo.
            <img src={clubLogoUrl} alt="" className="size-16 shrink-0 rounded-lg bg-white/10 object-contain p-1 sm:size-20" />
          ) : (
            <span className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-base font-semibold text-white/50 sm:size-20 sm:text-xl">
              {event.clubName.slice(0, 2).toUpperCase()}
            </span>
          )}

          <div className="flex flex-col items-center gap-1 text-center">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-[#e2b7d4] uppercase">Club Event</p>
            {/* Wraps, never truncates: the event's name is the one thing the
                page is about. */}
            <p className="font-display text-xl leading-tight text-balance text-chalk sm:text-2xl">{event.name}</p>
            <p className="text-sm text-white/70">{event.clubName}</p>
          </div>

          {audience && (
            <p className="flex items-center gap-1.5 text-xs text-white/70">
              <Users className="size-3.5 shrink-0" aria-hidden="true" />
              {audience}
            </p>
          )}
        </div>

        {event.location && (
          <p className="flex items-center justify-center gap-1.5 px-4 pt-2 pb-1 text-center text-xs tracking-wide text-white/70 uppercase sm:px-6">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            {event.location.name}
          </p>
        )}

        {/* THE FACTS. A range where there is a range, and an honest "All day"
            where no time was ever recorded -- never a fabricated 00:00, which
            would tell a family to turn up at midnight. */}
        <dl className={cn("mt-3 grid divide-x divide-white/10 border-t border-white/10", event.isAllDay ? "grid-cols-1" : "grid-cols-3")}>
          <TimeCell Icon={CalendarDays} label={event.isMultiDay ? "Dates" : "Date"} value={formatEventDateRange(event.startsOn, event.endsOn)} />
          {!event.isAllDay && (
            <>
              <TimeCell Icon={Clock} label="Starts" value={start ?? "TBC"} muted={!start} />
              <TimeCell Icon={Clock} label="Ends" value={finish ?? "Not set"} muted={!finish} />
            </>
          )}
        </dl>

        {event.isAllDay && (
          <p className="border-t border-white/10 px-4 py-2 text-center text-xs text-white/60 sm:px-6">
            No start time has been set for this event.
          </p>
        )}

        {cancelled && event.cancellationReason && (
          <p className="border-t border-white/10 px-4 py-3 text-sm text-red-100 sm:px-6">{event.cancellationReason}</p>
        )}

        {children}
      </div>
    </section>
  )
}

function TimeCell({
  Icon,
  label,
  value,
  muted,
}: {
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  label: string
  value: string
  muted?: boolean
}) {
  return (
    <div className="flex flex-col items-center gap-1 px-2 py-3">
      <span className="flex items-center gap-1.5 text-[10px] font-medium tracking-[0.1em] text-white/50 uppercase">
        <Icon className="size-3" aria-hidden={true} />
        {label}
      </span>
      <span className={cn("text-center text-sm font-semibold text-balance", muted ? "text-white/50" : "text-chalk")}>{value}</span>
    </div>
  )
}
