"use client"

import { useState } from "react"

import { cn } from "@/lib/utils"
import { DEMO_FIXTURE } from "@/lib/marketing/game-day-demo"

/**
 * The game at the centre, and the four people around it.
 *
 * Selecting a role illuminates its relationship to the fixture and explains
 * what that person actually gets. Built as a real tab set rather than a
 * hover-only diagram, so it works with keyboard, touch and screen readers;
 * the connecting lines are decoration layered on top of information that is
 * already in the text.
 */
const ROLES = [
  {
    id: "parent",
    label: "Parent",
    position: "top-left",
    body: "Sees the fixture their child is involved in, and responds with their availability in one tap. They do not see the club's operational fixture negotiation.",
  },
  {
    id: "coach",
    label: "Team staff",
    position: "top-right",
    body: "Sees availability for their own team as responses arrive, and can start planning the squad rather than chasing replies across group chats.",
  },
  {
    id: "player",
    label: "Player",
    position: "bottom-left",
    body: "Eligible players can respond for themselves, and see where and when they are playing — venue, pitch and kick-off.",
  },
  {
    id: "club",
    label: "Club",
    position: "bottom-right",
    body: "Sees what is happening across its grounds, so pitches and match-day preparation can be organised with the numbers in view.",
  },
] as const

export function ConnectedGameVisual() {
  const [active, setActive] = useState(0)
  const role = ROLES[active]

  return (
    <div>
      <div
        role="tablist"
        aria-label="Who the game connects"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        {ROLES.map((r, i) => {
          const selected = i === active
          return (
            <button
              key={r.id}
              type="button"
              role="tab"
              id={`game-role-tab-${r.id}`}
              aria-selected={selected}
              aria-controls="game-role-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={(event) => {
                const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"]
                if (!keys.includes(event.key)) return
                event.preventDefault()
                const last = ROLES.length - 1
                let next = i
                if (event.key === "ArrowRight" || event.key === "ArrowDown") next = i === last ? 0 : i + 1
                if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = i === 0 ? last : i - 1
                if (event.key === "Home") next = 0
                if (event.key === "End") next = last
                setActive(next)
                document.getElementById(`game-role-tab-${ROLES[next].id}`)?.focus()
              }}
              className={cn(
                "flex min-h-12 items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none",
                selected
                  ? "border-pitch-600 bg-pitch-600 text-ink"
                  : "border-white/15 bg-white/[0.04] text-white/75 hover:border-white/35 hover:text-white"
              )}
            >
              {r.label}
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id="game-role-panel"
        aria-labelledby={`game-role-tab-${role.id}`}
        tabIndex={0}
        className="mt-5 grid gap-6 rounded-xl border border-white/10 bg-white/[0.035] p-6 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none md:grid-cols-[1fr_auto] md:items-center md:p-8"
      >
        <div>
          <p className="text-xs tracking-[0.06em] text-white/45 uppercase">{role.label}</p>
          <p className="mt-2 text-base text-white/80 md:text-lg">{role.body}</p>
        </div>

        {/* The fixture itself, unchanged whichever role is selected -- which
            is the point being made. */}
        <div className="rounded-lg border border-pitch-600/30 bg-forest-950/60 px-5 py-4 md:w-64">
          <p className="text-xs tracking-[0.06em] text-pitch-400 uppercase">One game</p>
          <p className="mt-2 text-sm font-medium text-white">{DEMO_FIXTURE.ourTeam}</p>
          <p className="text-sm text-white/60">v {DEMO_FIXTURE.opponentTeam}</p>
          <p className="mt-2 text-xs text-white/45">
            {DEMO_FIXTURE.date} &middot; {DEMO_FIXTURE.kickoff}
          </p>
          <p className="text-xs text-white/45">
            {DEMO_FIXTURE.venue} &middot; {DEMO_FIXTURE.pitch}
          </p>
        </div>
      </div>
    </div>
  )
}
