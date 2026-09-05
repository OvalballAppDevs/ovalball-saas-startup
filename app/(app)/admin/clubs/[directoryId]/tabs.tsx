"use client"

import { useState } from "react"

export type TabName =
  | "Overview"
  | "Directory"
  | "Ovalball profile"
  | "Users & roles"
  | "Teams"
  | "Media"
  | "Data quality"
  | "Audit"

/**
 * `content` is already-rendered JSX from the server component parent, not
 * a render-prop function -- Server Components can pass rendered elements
 * as children/props across the boundary, but never a plain function
 * (React can't serialize it into the RSC payload). Every panel's content
 * is rendered up front by the parent; this component only controls which
 * one is visible.
 */
export function ClubDetailTabs({ panels }: { panels: { name: TabName; content: React.ReactNode }[] }) {
  const [active, setActive] = useState<TabName>(panels[0]?.name)

  return (
    <div>
      <div role="tablist" aria-label="Club sections" className="flex gap-1 overflow-x-auto border-b border-ink/10">
        {panels.map(({ name }) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={active === name}
            onClick={() => setActive(name)}
            className={`shrink-0 border-b-2 px-3.5 py-2.5 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 ${
              active === name ? "border-pitch-600 text-ink" : "border-transparent text-ink/50 hover:text-ink"
            }`}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="mt-6" role="tabpanel">
        {panels.find((p) => p.name === active)?.content}
      </div>
    </div>
  )
}
