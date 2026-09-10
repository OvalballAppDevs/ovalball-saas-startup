import { CalendarDays, CircleAlert, MapPin, Trophy, Users } from "lucide-react"

import { formatTournamentDateRange, type TournamentCentreContext } from "@/lib/tournaments/view-model"
import { cn } from "@/lib/utils"

/**
 * THE TOURNAMENT HERO -- the occasion, as the thing that is happening.
 *
 * AN OBVIOUS SIBLING, NOT A CLONE. Same forest ground, same mown stripes at
 * the same 3.5%, same status pill carrying an icon AND a word, same divided
 * facts strip. Put Match Centre, Training Centre, Event Centre and this side
 * by side and they are plainly one product.
 *
 * WHAT IS DIFFERENT, AND WHY.
 *
 * Match Centre's hero weighs one side against another across a VS. A festival
 * has no single opposition to weigh -- it has several, and different ones for
 * each of our teams -- so putting a VS here would be a lie about the shape of
 * the day. The hero therefore answers the four questions somebody arriving at
 * a festival actually has, in the order they ask them: WHAT is it, WHEN,
 * WHERE, and WHO OF OURS IS GOING. The teams are named in the hero rather than
 * counted, because "we have two teams there" is the fact that makes this
 * occasion different from a fixture.
 *
 * The eyebrow is amber, which is the tone a tournament already owns on the
 * Calendar chip and on the Pitch Allocation board. One accent, used the same
 * way in all three places, so a tournament is recognisable before it is read.
 */
export function TournamentCentreHero({
  tournament,
  clubLogoUrl,
}: {
  tournament: TournamentCentreContext
  clubLogoUrl: string | null
}) {
  const cancelled = tournament.cancelled
  const teamNames = tournament.entries.map((e) => e.teamName)

  return (
    <section
      aria-labelledby="tc-hero-heading"
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
        {/* The page's one h1. The visible name below is the same sentence; this
            one carries the date so somebody landing here with a screen reader
            knows which occasion they are on without hunting the facts strip. */}
        <h1 id="tc-hero-heading" className="sr-only">
          {tournament.name}, {formatTournamentDateRange(tournament.startsOn, tournament.endsOn)}
        </h1>

        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-6">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
              cancelled ? "bg-red-500/20 text-red-100 ring-red-300/40" : "bg-white/10 text-white/80 ring-white/15"
            )}
          >
            {cancelled ? <CircleAlert className="size-3.5" aria-hidden="true" /> : <Trophy className="size-3.5" aria-hidden="true" />}
            {cancelled ? "Cancelled" : "Scheduled"}
          </span>
          {tournament.isMultiDay && <span className="text-xs text-white/70">Runs over several days</span>}
        </div>

        <div className="flex flex-col items-center gap-3 px-4 pt-5 pb-1 sm:px-6">
          {clubLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- storage-hosted club logo.
            <img src={clubLogoUrl} alt="" className="size-16 shrink-0 rounded-lg bg-white/10 object-contain p-1 sm:size-20" />
          ) : (
            <span className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-base font-semibold text-white/50 sm:size-20 sm:text-xl">
              {(tournament.entries[0]?.clubName ?? tournament.name).slice(0, 2).toUpperCase()}
            </span>
          )}

          <div className="flex flex-col items-center gap-1 text-center">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-amber-300 uppercase">Tournament</p>
            {/* Wraps, never truncates: the occasion's name is what the page is about. */}
            <p className="font-display text-xl leading-tight text-balance text-chalk sm:text-2xl">{tournament.name}</p>
            {tournament.hostName && <p className="text-sm text-white/70">Hosted by {tournament.hostName}</p>}
          </div>

          {teamNames.length > 0 && (
            <p className="flex items-center gap-1.5 text-center text-xs text-white/70">
              <Users className="size-3.5 shrink-0" aria-hidden="true" />
              <span>
                {teamNames.length <= 3 ? teamNames.join(" · ") : `${teamNames.slice(0, 3).join(" · ")} +${teamNames.length - 3} more`}
              </span>
            </p>
          )}
        </div>

        {cancelled && tournament.cancellationReason && (
          <p className="mx-4 mt-4 rounded-lg bg-red-500/15 px-3 py-2 text-center text-sm text-red-100 sm:mx-6">{tournament.cancellationReason}</p>
        )}

        {/* THE FACTS STRIP, divided by hairlines exactly as the sibling
            surfaces do. Three things, always three: a festival with no venue
            recorded still shows the slot, saying so, rather than collapsing
            the layout and leaving the reader to wonder what is missing. */}
        <dl className="mt-5 grid grid-cols-3 divide-x divide-white/10 border-t border-white/10">
          <Fact icon={<CalendarDays className="size-3.5" aria-hidden="true" />} label={tournament.isMultiDay ? "Dates" : "Date"}>
            {formatTournamentDateRange(tournament.startsOn, tournament.endsOn)}
          </Fact>
          <Fact icon={<MapPin className="size-3.5" aria-hidden="true" />} label="Venue">
            {tournament.venue?.name ?? tournament.venueNotes ?? "Not set"}
          </Fact>
          <Fact icon={<Users className="size-3.5" aria-hidden="true" />} label="Our Teams">
            {tournament.entries.length === 0 ? "None yet" : `${tournament.entries.length}`}
          </Fact>
        </dl>
      </div>
    </section>
  )
}

function Fact({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-3 text-center sm:px-4 sm:py-4">
      <dt className="flex items-center justify-center gap-1 text-[10px] font-medium tracking-[0.1em] text-white/50 uppercase">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 text-sm leading-tight font-medium text-balance text-chalk">{children}</dd>
    </div>
  )
}
