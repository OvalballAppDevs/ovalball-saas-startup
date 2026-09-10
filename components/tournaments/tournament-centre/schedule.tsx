import { Clock, MapPin } from "lucide-react"

import type { CombinedScheduleRow, TournamentEntry, TournamentGame } from "@/lib/tournaments/view-model"
import { cn } from "@/lib/utils"

/**
 * THE DAY, AS A DAY.
 *
 * A festival schedule is read at a glance, standing on a touchline, usually on
 * a phone: "when are we next on, and which pitch". So the time leads, the
 * opponent carries the weight, and the pitch sits with the time rather than
 * trailing at the end of a sentence. It is a list of moments, not a table of
 * records -- there is no header row to scan past on a phone, and each row
 * stands on its own.
 *
 * ONE COMPONENT, TWO USES. The same row renders a single team's day and the
 * whole club's day; the club view simply also names the team. That is the same
 * decision the rest of the product makes about shared surfaces -- a second
 * near-identical schedule component is exactly the thing that drifts.
 */

function clock(t: string | null): string {
  if (!t) return "TBC"
  return t.slice(0, 5)
}

function ScheduleRow({ game, teamName }: { game: TournamentGame; teamName?: string }) {
  const cancelled = game.status === "CANCELLED"
  return (
    <li
      className={cn(
        "flex items-start gap-3 px-4 py-3 sm:gap-4 sm:px-5",
        cancelled && "bg-destructive/[0.04]"
      )}
    >
      <span
        className={cn(
          "w-14 shrink-0 pt-0.5 font-display text-base tabular-nums",
          cancelled ? "text-destructive-text line-through" : "text-ink"
        )}
      >
        {clock(game.startTime)}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block leading-tight font-medium text-balance", cancelled ? "text-destructive-text" : "text-ink")}>
          {teamName && <span className="text-ink-muted">{teamName} </span>}
          <span className="text-ink-subtle">v</span> {game.opponentClubName}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          {game.pitchName && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" aria-hidden="true" />
              {game.pitchName}
            </span>
          )}
          {game.durationMinutes != null && (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" aria-hidden="true" />
              {game.durationMinutes} min
            </span>
          )}
          {/* NEVER COLOUR ALONE: a cancelled game says the word. */}
          {cancelled && <span className="font-medium text-destructive-text">Cancelled</span>}
        </span>
      </span>
      {game.ourScore != null && game.opponentScore != null && (
        <span className="shrink-0 pt-0.5 font-display text-base tabular-nums text-ink">
          {game.ourScore}&ndash;{game.opponentScore}
        </span>
      )}
    </li>
  )
}

export function TeamSchedule({ entry }: { entry: TournamentEntry }) {
  return (
    <section aria-labelledby={`tc-sched-${entry.id}`} className="overflow-hidden rounded-2xl border border-ink/10 bg-white">
      {/* Just "Schedule". The team is already named -- by the tab above when
          several are going, and by the hero when only one is -- and
          "Under 12 Boys's Schedule" is a possessive no one would write. */}
      <h2 id={`tc-sched-${entry.id}`} className="px-4 pt-4 text-sm font-medium tracking-[0.04em] text-ink-muted uppercase sm:px-5">
        Schedule
      </h2>
      {entry.games.length === 0 ? (
        <p className="px-4 py-5 text-sm text-ink-muted sm:px-5">
          No games scheduled yet. The times will appear here once the organiser has set them.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-ink/[0.07]">
          {entry.games.map((g) => (
            <ScheduleRow key={g.id} game={g} />
          ))}
        </ul>
      )}
    </section>
  )
}

export function CombinedSchedule({ rows }: { rows: CombinedScheduleRow[] }) {
  return (
    <section aria-labelledby="tc-sched-all" className="overflow-hidden rounded-2xl border border-ink/10 bg-white">
      <h2 id="tc-sched-all" className="px-4 pt-4 text-sm font-medium tracking-[0.04em] text-ink-muted uppercase sm:px-5">
        Everyone&rsquo;s Day
      </h2>
      <p className="px-4 pt-1 text-xs text-ink-muted sm:px-5">Every game our club is playing, in time order.</p>
      {rows.length === 0 ? (
        <p className="px-4 py-5 text-sm text-ink-muted sm:px-5">No games scheduled yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-ink/[0.07]">
          {rows.map((r) => (
            <ScheduleRow key={r.id} game={r} teamName={r.teamName} />
          ))}
        </ul>
      )}
    </section>
  )
}
