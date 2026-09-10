import { CalendarDays, CircleAlert, CircleDashed, Clock, Hourglass, MapPin } from "lucide-react"

import { KitPlaceholder, RugbyKit } from "@/components/club/rugby-kit"
import { formatClock } from "@/components/fixtures/match-centre/hero"
import type { TrainingClubIdentity, TrainingSessionIdentity } from "@/lib/app-context/training-centre-data"
import { cn } from "@/lib/utils"

/**
 * THE TRAINING HERO -- the session, as the thing you turn up to.
 *
 * IT IS THE MATCH CENTRE HERO WITH THE MATCH TAKEN OUT, not a new visual
 * world. Same forest ground, same mown stripes, same three-across facts strip,
 * same white/70 contrast floor, same wrapping club name. Put the two pages
 * side by side and they are obviously the same product.
 *
 * WHAT IS DELIBERATELY GONE, because training has none of it: the opposition,
 * the VS, the second crest and kit, home/away, the result. The brief's rule
 * and the right one -- an empty "Opposition: —" would be a match concept left
 * lying in a page that has no match in it.
 *
 * SO THE COMPOSITION CHANGES SHAPE. Match Centre needs three columns because
 * it has two sides to weigh against each other. Training has ONE side, so the
 * crest and kit are CENTRED and the eye goes straight down the middle to the
 * team and the time. Keeping the three-column grid and leaving two thirds of
 * it empty would have been the clone the brief warns against.
 *
 * THE ACCENT. Match Centre's facts strip runs to kick-off; this one runs to
 * START and FINISH, and the eyebrow reads SCHEDULED TRAINING SESSION in
 * pitch-400 rather than the fixture's status pill. That is the "this is
 * training" signal -- one word and one accent inside the established system,
 * not a second colour scheme.
 */

/** "Tuesday 15 September" -- a session's date is a club-local calendar day, never shifted by the reader's timezone. */
export function formatTrainingDate(sessionDate: string): string {
  const [y, m, d] = sessionDate.split("-").map(Number)
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)))
}

/** "Tue 15 Sep" -- for the facts strip, where the long form wraps to three lines in a 110px column. */
export function formatTrainingDateCompact(sessionDate: string): string {
  const [y, m, d] = sessionDate.split("-").map(Number)
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)))
}

/**
 * The end of the session, from whatever the record actually holds.
 *
 * A session may carry an explicit end_time, or a duration, or neither, and all
 * three are normal. A missing finish is stated as "Not set" rather than
 * computed from a default length -- a parent arranging a pick-up acts on this
 * number, and a plausible invented one is worse than an honest gap.
 */
export function resolveFinish(session: TrainingSessionIdentity): string | null {
  if (session.endTime) return formatClock(session.endTime)
  if (session.startTime && session.durationMinutes) {
    const [h, m] = session.startTime.split(":").map(Number)
    if (Number.isNaN(h) || Number.isNaN(m)) return null
    const total = h * 60 + m + session.durationMinutes
    const hh = Math.floor(total / 60) % 24
    return formatClock(`${String(hh).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`)
  }
  return null
}

export function TrainingCentreHero({
  session,
  club,
  venueName,
  children,
}: {
  session: TrainingSessionIdentity
  club: TrainingClubIdentity
  venueName?: string | null
  /**
   * The viewer's own availability, rendered INSIDE the card -- the same
   * decision as Match Centre, for the same reason: the invitation and the
   * reply to it are one object.
   */
  children?: React.ReactNode
}) {
  const cancelled = session.status === "CANCELLED"
  const start = formatClock(session.startTime)
  const finish = resolveFinish(session)

  return (
    <section
      aria-labelledby="tc-hero-heading"
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-forest-900 to-forest-950 text-chalk",
        cancelled && "opacity-90 saturate-50"
      )}
    >
      {/* The same mown stripes as matchday, at the same 3.5% -- the ground is
          the ground whether there is an opposition on it or not. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex">
        {Array.from({ length: 8 }).map((_, i) => (
          <span key={i} className={cn("h-full flex-1", i % 2 === 0 ? "bg-white/[0.035]" : "bg-transparent")} />
        ))}
      </div>

      <div className="relative">
        {/* THE PAGE'S h1, not an h2.
            The document outline used to start at h2 with five siblings and no
            top-level heading, so a screen-reader user landing here found no
            name for the page. The hero already carries the one sentence that
            names it; it just needed to be the right level. */}
        <h1 id="tc-hero-heading" className="sr-only">
          Training session, {session.teamLabel}, {formatTrainingDate(session.sessionDate)}
        </h1>

        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-6">
          {/* State in an ICON AND A WORD, never colour alone -- a cancelled
              session gets shared as a screenshot in a team WhatsApp group, and
              it has to survive that. */}
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
              cancelled ? "bg-red-500/20 text-red-100 ring-red-300/40" : "bg-white/10 text-white/80 ring-white/15"
            )}
          >
            {cancelled ? <CircleAlert className="size-3.5" aria-hidden="true" /> : <CircleDashed className="size-3.5" aria-hidden="true" />}
            {cancelled ? "Cancelled" : "Scheduled"}
          </span>
          {/* A recurring occurrence says so, because "why is this in my diary
              every Tuesday" is a real question. It names the RECURRENCE, and
              nothing on this page is identified by it. */}
          {session.source === "AUTOMATIC_PLAN" && <span className="text-xs text-white/70">Part of a repeating schedule</span>}
        </div>

        {/* ONE side, centred. */}
        <div className="flex flex-col items-center gap-3 px-4 pt-5 pb-1 sm:px-6">
          <div className="flex items-center justify-center gap-2 sm:gap-3">
            {club.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- storage-hosted club logo.
              <img src={club.logoUrl} alt="" className="size-16 shrink-0 rounded-lg bg-white/10 object-contain p-1 sm:size-20" />
            ) : (
              <span className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-base font-semibold text-white/50 sm:size-20 sm:text-xl">
                {club.displayName.slice(0, 2).toUpperCase()}
              </span>
            )}
            {club.kit ? (
              <RugbyKit kit={club.kit} clubName={club.displayName} variant="primary" className="size-16 text-white sm:size-20" />
            ) : (
              <KitPlaceholder className="size-16 text-white/30 sm:size-20" />
            )}
          </div>

          <div className="flex flex-col items-center gap-1 text-center">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-pitch-400 uppercase">Scheduled Training Session</p>
            {/* Wraps, never truncates -- "Under 14 Girls B" is the canonical
                display name and abbreviating it invents a second one. */}
            <p className="font-display text-xl leading-tight text-balance text-chalk sm:text-2xl">{session.teamLabel}</p>
            <p className="text-sm text-white/70">{club.displayName}</p>
          </div>
        </div>

        {venueName && (
          <p className="flex items-center justify-center gap-1.5 px-4 pt-2 pb-1 text-xs tracking-wide text-white/70 uppercase sm:px-6">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            {venueName}
          </p>
        )}

        {/* The three facts somebody opened this for. Finish is given equal
            weight to start, because the pick-up time is the one a parent
            actually has to act on -- the training equivalent of meet time. */}
        <dl className="mt-3 grid grid-cols-3 divide-x divide-white/10 border-t border-white/10">
          <TimeCell Icon={CalendarDays} label="Date" value={formatTrainingDateCompact(session.sessionDate)} />
          <TimeCell Icon={Clock} label="Starts" value={start ?? "TBC"} muted={!start} />
          <TimeCell Icon={Hourglass} label="Finishes" value={finish ?? "Not set"} muted={!finish} />
        </dl>

        {cancelled && session.cancellationReason && (
          <p className="border-t border-white/10 px-4 py-3 text-sm text-red-100 sm:px-6">
            <span className="font-medium">Cancelled.</span> {session.cancellationReason}
            {session.cancelledByName ? ` — ${session.cancelledByName}` : ""}
          </p>
        )}

        {children && <div className="border-t border-white/10 bg-black/15">{children}</div>}
      </div>
    </section>
  )
}

function TimeCell({ Icon, label, value, muted = false }: { Icon: typeof CalendarDays; label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1 px-2 py-3.5 text-center sm:py-4">
      <dt className="flex items-center gap-1.5 text-[11px] tracking-wide text-white/70 uppercase sm:text-xs">
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        {label}
      </dt>
      <dd className={cn("font-display text-sm leading-tight text-balance sm:text-base", muted ? "text-white/70" : "text-chalk")}>{value}</dd>
    </div>
  )
}
