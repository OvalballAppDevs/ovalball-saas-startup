"use client"

import Link from "next/link"

import type { PositionSummary } from "@/lib/app-context/position-explorer-types"
import { PitchField } from "./pitch-field"

/**
 * The interactive pitch: an original Ovalball diagram (PitchField, purely
 * decorative) with real <Link> markers placed by each position's own
 * normalised pitch_anchor_x/y -- never a hardcoded per-component pixel
 * layout. Each marker is a genuine focusable link (not an SVG element), so
 * keyboard and screen-reader users reach every position the same way a
 * mouse user does; PitchField itself is aria-hidden and contributes
 * nothing to the accessibility tree.
 */
export function PositionPitch({
  code,
  positions,
  selectedKey,
}: {
  code: string
  positions: PositionSummary[]
  selectedKey: string | null
}) {
  return (
    <div className="relative mx-auto aspect-[5/7] w-full max-w-md overflow-hidden rounded-2xl shadow-[0_1px_2px_rgba(16,21,18,0.08)] sm:max-w-lg">
      <PitchField tone={code === "league" ? "league" : "union"} />
      <div className="absolute inset-0">
        {positions.map((p) => {
          const isSelected = p.positionKey === selectedKey
          const x = (p.pitchAnchorX ?? 0.5) * 100
          const y = (p.pitchAnchorY ?? 0.5) * 100
          return (
            <Link
              key={p.id}
              href={`/rugby-hub/positions/${code}/${p.positionKey}`}
              scroll={false}
              aria-current={isSelected ? "true" : undefined}
              aria-label={`${p.displayName}${p.shirtNumber ? `, number ${p.shirtNumber}` : ""}${isSelected ? " (selected)" : ""}`}
              className={`group absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-sm font-semibold outline-none transition-all focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-offset-2 focus-visible:ring-offset-forest-900 ${
                isSelected
                  ? "z-10 scale-110 border-chalk bg-pitch-400 text-ink shadow-lg"
                  : "border-chalk/40 bg-forest-800/90 text-chalk hover:border-chalk hover:bg-forest-800"
              }`}
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              {p.shirtNumber ?? p.displayName.charAt(0)}
              <span
                className={`pointer-events-none absolute top-full mt-1 whitespace-nowrap rounded-md bg-ink/90 px-2 py-1 text-xs font-medium text-chalk opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 ${
                  isSelected ? "opacity-0" : ""
                }`}
              >
                {p.displayName}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
