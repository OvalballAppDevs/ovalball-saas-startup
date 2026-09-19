import Link from "next/link"

import type { UserDetailTab } from "./tabs"

/**
 * Server-rendered, because the tab is in the URL. Every tab is a real link, so
 * middle-click, back and "copy link address" all behave the way an administrator
 * expects, and a page that has not hydrated yet is still navigable.
 */
export function TabStrip({ userId, tabs, active }: { userId: string; tabs: UserDetailTab[]; active: string }) {
  return (
    <div role="tablist" aria-label="User sections" className="flex gap-1 overflow-x-auto border-b border-ink/10">
      {tabs.map((tab) => {
        const selected = tab.key === active
        return (
          <Link
            key={tab.key}
            href={`/admin/users/${userId}?tab=${tab.key}`}
            role="tab"
            aria-selected={selected}
            scroll={false}
            className={`shrink-0 border-b-2 px-3.5 py-2.5 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 ${
              selected ? "border-pitch-600 text-ink" : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
