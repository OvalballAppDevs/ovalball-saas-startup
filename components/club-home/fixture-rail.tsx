"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { matchDateParts } from "@/lib/club-public/format"
import type { ClubUpcomingMatch } from "@/lib/club-public/matches"
import { useReducedMotion } from "@/lib/motion/use-reduced-motion"
import { cn } from "@/lib/utils"

import { FOCUS_LIGHT, Tag } from "./primitives"

/**
 * Upcoming fixtures as a rail.
 *
 * A native horizontal scroller with scroll-snap, so touch, trackpad and
 * keyboard (the rail itself is focusable and arrow keys scroll it) all work
 * with no JavaScript at all. The buttons are an addition for mouse users, not
 * the only way through: nothing autoplays, nothing moves on its own, and the
 * buttons say which way they go and switch off at either end.
 */
export function FixtureRail({ matches, label }: { matches: ClubUpcomingMatch[]; label: string }) {
  const railRef = useRef<HTMLUListElement>(null)
  const reduced = useReducedMotion()
  const [edges, setEdges] = useState({ start: true, end: false })

  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    const update = () =>
      setEdges({ start: rail.scrollLeft <= 4, end: rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 4 })
    update()
    rail.addEventListener("scroll", update, { passive: true })
    window.addEventListener("resize", update)
    return () => {
      rail.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
    }
  }, [])

  const scroll = (direction: 1 | -1) => {
    const rail = railRef.current
    if (!rail) return
    rail.scrollBy({ left: direction * rail.clientWidth * 0.85, behavior: reduced ? "auto" : "smooth" })
  }

  const hasOverflow = !(edges.start && edges.end)

  return (
    <div>
      {hasOverflow && (
        <div className="mb-3 flex justify-end gap-2">
          <button type="button" onClick={() => scroll(-1)} disabled={edges.start} aria-label="Earlier fixtures" className={cn(FOCUS_LIGHT, "grid size-11 place-items-center rounded-full border border-ink/15 bg-white text-ink hover:border-ink/40 disabled:opacity-40")}>
            <ChevronLeft aria-hidden="true" className="size-5" />
          </button>
          <button type="button" onClick={() => scroll(1)} disabled={edges.end} aria-label="Later fixtures" className={cn(FOCUS_LIGHT, "grid size-11 place-items-center rounded-full border border-ink/15 bg-white text-ink hover:border-ink/40 disabled:opacity-40")}>
            <ChevronRight aria-hidden="true" className="size-5" />
          </button>
        </div>
      )}
      <ul
        ref={railRef}
        tabIndex={0}
        aria-label={label}
        className={cn(FOCUS_LIGHT, "-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-3 md:mx-0 md:scroll-px-0 md:px-0")}
      >
        {matches.map((m) => {
          const d = matchDateParts(m.date)
          return (
            <li key={m.id} className="w-[min(18rem,calc(100vw-4rem))] shrink-0 snap-start">
              <article className="flex h-full flex-col rounded-2xl border border-ink/10 bg-white p-5" aria-label={`${m.teamLabel} v ${m.opposition}, ${d.long}`}>
                <div className="flex items-start justify-between gap-3">
                  <p className="flex items-baseline gap-2">
                    <span className="font-display text-4xl leading-none text-(--club-ink)">{d.day}</span>
                    <span className="text-sm font-semibold text-ink">
                      {d.weekday} {d.month}
                    </span>
                  </p>
                  {m.venueRole && <Tag tone={m.venueRole === "Home" ? "strong" : "neutral"}>{m.venueRole}</Tag>}
                </div>
                <p className="mt-4 text-sm font-medium text-ink-muted">{m.teamLabel}</p>
                <p className="mt-0.5 text-lg leading-snug font-semibold text-ink">
                  <span className="font-normal text-ink-muted">v </span>
                  {m.opposition}
                </p>
                <p className="mt-3 text-sm text-ink-muted">{m.time ? `Kick-off ${m.time}` : "Kick-off to be confirmed"}</p>
                {m.competition && <p className="mt-1 text-sm text-ink-muted">{m.competition.name}</p>}
                {m.matchCentreHref && (
                  <div className="mt-auto pt-4">
                    <Link href={m.matchCentreHref} className={cn(FOCUS_LIGHT, "inline-flex min-h-10 items-center rounded-lg bg-(--club-tint-strong) px-3 text-sm font-semibold text-(--club-ink) underline-offset-4 hover:underline")}>
                      Match Centre
                    </Link>
                  </div>
                )}
              </article>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
