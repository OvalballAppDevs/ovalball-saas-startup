"use client"

import Link from "next/link"

import type { PositionSummary } from "@/lib/app-context/position-explorer-types"
import { groupByFamily, POSITION_FAMILY_LABEL } from "@/lib/app-context/position-explorer-types"

/**
 * The complete semantic alternative to the pitch (section 18): every
 * position, grouped by its real position_family, as ordinary links sharing
 * the exact same selected state and destination as the pitch markers. Not
 * a screen-reader-only duplicate -- visible to everyone, since a grouped
 * list is also just a legitimate second way to browse.
 */
export function PositionList({
  code,
  positions,
  selectedKey,
}: {
  code: string
  positions: PositionSummary[]
  selectedKey: string | null
}) {
  const groups = groupByFamily(positions)

  return (
    <nav aria-label="All positions" className="flex flex-col gap-5">
      {groups.map((g) => (
        <div key={g.family}>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">{POSITION_FAMILY_LABEL[g.family] ?? g.family}</h3>
          <ul className="mt-2 flex flex-col gap-1">
            {g.positions.map((p) => {
              const isSelected = p.positionKey === selectedKey
              return (
                <li key={p.id}>
                  <Link
                    href={`/rugby-hub/positions/${code}/${p.positionKey}`}
                    scroll={false}
                    aria-current={isSelected ? "true" : undefined}
                    className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 ${
                      isSelected ? "bg-forest-900 text-chalk" : "text-ink/80 hover:bg-mint-100"
                    }`}
                  >
                    <span
                      className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                        isSelected ? "bg-pitch-400 text-ink" : "bg-ink/10 text-ink/70"
                      }`}
                    >
                      {p.shirtNumber ?? p.displayName.charAt(0)}
                    </span>
                    <span className="font-medium">{p.displayName}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
