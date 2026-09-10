"use client"

import { useState } from "react"

import type { TournamentEntry } from "@/lib/tournaments/view-model"
import { cn } from "@/lib/utils"

/**
 * WHO THIS TEAM IS PLAYING.
 *
 * THE COMPOSITION PROBLEM. Match Centre can weigh two crests across a VS
 * because there are exactly two. Here there is one of ours and anywhere from
 * none to a dozen of theirs, and the naive answer -- one enormous home crest
 * with a row of tiny badges beside it -- says something false about the day.
 * At a festival our U12 is one side among several, not the centre of gravity.
 *
 * So OUR TILE AND AN OPPONENT TILE ARE THE SAME SIZE, and ours is distinguished
 * by treatment rather than by scale: a pitch-400 ring and the word "Us". The
 * "v" between them is the only thing borrowed from Match Centre, because that
 * is the one piece of the grammar that still means what it meant there.
 *
 * RESPONSIVE TO COUNT, NOT TO GUESSWORK. Crest size and column width step down
 * as the opponent count rises, so three opponents are comfortable, six are
 * still legible, and nine do not shrink the names into decoration. Past the
 * threshold the tail collapses behind a real disclosure -- a button that says
 * how many are hidden -- rather than being silently truncated or squeezed.
 */

const SCALE = [
  { max: 3, crest: "size-14", cell: "min-w-[7.5rem]", name: "text-sm" },
  { max: 5, crest: "size-12", cell: "min-w-[6.5rem]", name: "text-sm" },
  { max: 8, crest: "size-10", cell: "min-w-[5.5rem]", name: "text-xs" },
] as const
const DENSE = { crest: "size-9", cell: "min-w-[5rem]", name: "text-xs" } as const

/** Beyond this, the tail is disclosed rather than shrunk further. */
const VISIBLE_LIMIT = 8

function scaleFor(count: number) {
  return SCALE.find((s) => count <= s.max) ?? DENSE
}

function IdentityTile({
  logoUrl,
  name,
  sub,
  crestClass,
  nameClass,
  cellClass,
  us = false,
}: {
  logoUrl: string | null
  name: string
  sub: string | null
  crestClass: string
  nameClass: string
  cellClass: string
  us?: boolean
}) {
  return (
    <div className={cn("flex flex-col items-center gap-1.5 text-center", cellClass)}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- storage-hosted club logo.
        <img
          src={logoUrl}
          alt=""
          className={cn("shrink-0 rounded-lg bg-ink/[0.03] object-contain p-1", crestClass, us && "ring-2 ring-pitch-400")}
        />
      ) : (
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-lg border border-ink/10 bg-ink/[0.03] text-xs font-semibold text-ink-muted",
            crestClass,
            us && "ring-2 ring-pitch-400"
          )}
          aria-hidden="true"
        >
          {name.slice(0, 2).toUpperCase()}
        </span>
      )}
      <span className={cn("leading-tight font-medium text-balance text-ink", nameClass)}>{name}</span>
      {sub && <span className="text-[11px] leading-none text-ink-muted">{sub}</span>}
    </div>
  )
}

export function TournamentOpposition({ entry }: { entry: TournamentEntry }) {
  const [expanded, setExpanded] = useState(false)
  const opponents = entry.opponents
  const scale = scaleFor(opponents.length)
  const hidden = expanded ? 0 : Math.max(0, opponents.length - VISIBLE_LIMIT)
  const shown = hidden > 0 ? opponents.slice(0, VISIBLE_LIMIT) : opponents

  return (
    <section aria-labelledby={`tc-opp-${entry.id}`} className="rounded-2xl border border-ink/10 bg-white p-4 sm:p-5">
      <h2 id={`tc-opp-${entry.id}`} className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">
        Playing
      </h2>

      {opponents.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">No opponents recorded for {entry.teamName} yet.</p>
      ) : (
        <div className="mt-4 flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:gap-5">
          <IdentityTile
            logoUrl={entry.logoUrl}
            name={entry.teamName}
            sub="Us"
            crestClass={scale.crest}
            nameClass={scale.name}
            cellClass={scale.cell}
            us
          />

          <span
            aria-hidden="true"
            className="shrink-0 self-center font-display text-lg text-ink-subtle sm:pt-4"
          >
            v
          </span>

          {/* auto-fit rather than a fixed column count: the row fills the width
              it is given and wraps on its own, so the same markup is right at
              1512px and at 390px without a breakpoint per count. */}
          <ul
            className="grid w-full flex-1 justify-items-center gap-x-3 gap-y-4"
            style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${scale.cell.match(/\[([\d.]+)rem\]/)?.[1] ?? "6"}rem, 1fr))` }}
          >
            {shown.map((o) => (
              <li key={o.id}>
                <IdentityTile
                  logoUrl={o.logoUrl}
                  name={o.clubName}
                  sub={o.teamTypeLabel}
                  crestClass={scale.crest}
                  nameClass={scale.name}
                  cellClass={scale.cell}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-4 inline-flex h-11 items-center rounded-lg border border-ink/15 px-3.5 text-sm font-medium text-ink outline-none hover:bg-ink/[0.03] focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          Show {hidden} More {hidden === 1 ? "Opponent" : "Opponents"}
        </button>
      )}
      {expanded && opponents.length > VISIBLE_LIMIT && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-4 inline-flex h-11 items-center rounded-lg border border-ink/15 px-3.5 text-sm font-medium text-ink outline-none hover:bg-ink/[0.03] focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          Show Fewer
        </button>
      )}
    </section>
  )
}
