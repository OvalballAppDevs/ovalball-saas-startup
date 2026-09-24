import Link from "next/link"
import { AlertCircle, CalendarDays, ChevronRight, Users } from "lucide-react"

import type { AgendaSide } from "@/lib/agenda/load"
import type { TeamOverview } from "@/lib/teams/team-overview"

/**
 * THE TEAM OPERATIONS HOME.
 *
 * What somebody running a rugby team opens on a Monday evening. The order is the order they ask:
 *
 *   NEEDS ATTENTION  what is waiting on me
 *   NEXT UP          who are we playing, where, when, and who can play
 *   TEAM             who am I responsible for
 *
 * WHAT IT DELIBERATELY IS NOT. It is not an analytics dashboard, and it is not a table. The Team
 * context used to show "Requests", "This Week" and a club-news rail -- a club admin's page with the
 * club parts taken out -- and told a manager whose next fixture was three weeks away that there was
 * "nothing scheduled this week". Everything here is either something to act on or the next thing that
 * is actually happening.
 *
 * ATTENTION IS DERIVED, NEVER STORED. Each row comes from canonical domain state -- a pending fixture
 * request, an unanswered availability -- so it disappears when the work is done and not when somebody
 * reads a notification. That distinction is the whole point: READ is about the message, RESOLVED is
 * about the work, and only the second decides what appears here.
 */
export function TeamOperationsPanel({ overview, teamHref }: { overview: TeamOverview; teamHref: string }) {
  const { attention, nextUp, lastResult, people, availability } = overview

  return (
    <>
      {attention.length > 0 && (
        <section className="mt-6 first:mt-0" aria-labelledby="team-attention">
          <h2 id="team-attention" className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">
            Needs Attention
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {attention.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-50/60 px-4 py-3 transition-colors hover:bg-amber-50"
                >
                  <AlertCircle aria-hidden="true" className="size-4 shrink-0 text-amber-700" />
                  <span className="min-w-0 flex-1 text-sm font-medium text-ink">{item.label}</span>
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6 first:mt-0" aria-labelledby="team-next">
        <h2 id="team-next" className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">
          Next Up
        </h2>
        {nextUp ? (
          <div className="mt-3 rounded-2xl border border-line bg-surface p-4">
            <p className="text-xs font-medium tracking-[0.04em] text-ink-muted uppercase">
              {formatDate(nextUp.date)}
              {nextUp.time ? ` · ${nextUp.time.slice(0, 5)}` : ""}
            </p>
            <p className="mt-1 text-lg font-medium text-ink">
              {nextUp.kind === "training" ? "Training" : opponentLabel(nextUp.them)}
            </p>
            <p className="mt-0.5 text-sm text-ink-muted">
              {[nextUp.kind === "fixture" ? nextUp.homeAway : null, nextUp.venue, nextUp.status]
                .filter(Boolean)
                .join(" · ")}
            </p>

            {/* The number a manager actually wants is the one still outstanding. */}
            {availability && (
              <p className="mt-3 text-sm text-ink">
                <span className="font-medium">{availability.attending}</span> available
                {availability.unavailable > 0 && <> · <span className="font-medium">{availability.unavailable}</span> cannot play</>}
                {availability.awaiting > 0 && (
                  <> · <span className="font-medium text-amber-700">{availability.awaiting}</span> not replied</>
                )}
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {nextUp.kind === "fixture" && (
                <Link
                  href={`/fixtures/${nextUp.eventId}`}
                  className="inline-flex h-10 items-center rounded-lg border border-line px-3 text-sm font-medium text-ink hover:bg-surface-muted"
                >
                  Match Centre
                </Link>
              )}
              <Link
                href="/agenda"
                className="inline-flex h-10 items-center rounded-lg border border-line px-3 text-sm font-medium text-ink hover:bg-surface-muted"
              >
                All Fixtures
              </Link>
            </div>
          </div>
        ) : (
          /* An empty state that says what it means and what to do, rather than reporting an absence. */
          <div className="mt-3 rounded-2xl border border-dashed border-line bg-surface px-4 py-6">
            <CalendarDays aria-hidden="true" className="size-5 text-ink-muted" />
            <p className="mt-2 text-sm font-medium text-ink">No fixtures or training in the next year</p>
            <p className="mt-0.5 text-sm text-ink-muted">
              When a fixture is arranged or training is scheduled, it will be the first thing on this page.
            </p>
          </div>
        )}
      </section>

      {lastResult && (
        <section className="mt-6" aria-labelledby="team-last">
          <h2 id="team-last" className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">
            Last Result
          </h2>
          <Link
            href={`/fixtures/${lastResult.eventId}`}
            className="mt-3 flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 hover:bg-surface-muted"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">
                {opponentLabel(lastResult.them)}
              </span>
              <span className="block text-xs text-ink-muted">{formatDate(lastResult.date)}</span>
            </span>
            <span className="shrink-0 text-lg font-medium text-ink">
              {lastResult.result!.ourScore}&ndash;{lastResult.result!.theirScore}
            </span>
          </Link>
        </section>
      )}

      <section className="mt-6" aria-labelledby="team-people">
        <h2 id="team-people" className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">
          Team
        </h2>
        <Link
          href={teamHref}
          className="mt-3 flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 hover:bg-surface-muted"
        >
          <Users aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
          <span className="min-w-0 flex-1 text-sm text-ink">
            <span className="font-medium">{people.players}</span> {people.players === 1 ? "player" : "players"}
            {people.staff > 0 && (
              <>
                {" · "}
                <span className="font-medium">{people.staff}</span> {people.staff === 1 ? "coach or manager" : "coaches and managers"}
              </>
            )}
          </span>
          <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
        </Link>
      </section>
    </>
  )
}

/**
 * Who we are playing, named the way a person would say it.
 *
 * The club is what people call the opposition -- "we're away at Preston" -- and the team name is only
 * worth adding when it says something the club name does not. An unset opposition is stated as unset
 * rather than given a placeholder that reads like a real club.
 */
function opponentLabel(side: AgendaSide | null): string {
  if (!side) return "Opposition to be confirmed"
  return side.clubName || side.teamName || "Opposition to be confirmed"
}

/** "Sat 2 Jan". The year is added only when it is not this one, because most fixtures are soon. */
function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const thisYear = new Date().getUTCFullYear() === d.getUTCFullYear()
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(thisYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(d)
}
