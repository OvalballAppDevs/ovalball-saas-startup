"use client"

import { ActivityRow } from "@/components/notifications/activity-row"
import { groupActivity, type ActivityItem } from "@/lib/notifications/activity"

/**
 * The grouped activity list, shared by the bell panel and the Notifications
 * page. Chronological headings only -- New, Earlier Today, Yesterday, Earlier
 * -- because that is what makes a column of twenty scannable. Categories are
 * the filter's job, not the list's.
 */
export function ActivityList({
  items,
  onOpen,
  density = "comfortable",
  showGroups = true,
}: {
  items: ActivityItem[]
  onOpen?: (id: string) => void
  density?: "comfortable" | "compact"
  /** The compact panel is short enough that headings cost more than they give. */
  showGroups?: boolean
}) {
  if (!showGroups) {
    return (
      <ul className="divide-y divide-ink/[0.07]">
        {items.map((item) => (
          <li key={item.id}>
            <ActivityRow item={item} onOpen={onOpen} density={density} />
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div>
      {groupActivity(items).map(({ group, items: groupItems }) => (
        <section key={group} aria-labelledby={`activity-${group.replace(/\s+/g, "-").toLowerCase()}`}>
          <h2
            id={`activity-${group.replace(/\s+/g, "-").toLowerCase()}`}
            className="sticky top-0 z-10 border-y border-ink/[0.07] bg-chalk/95 px-4 py-1.5 text-[11px] font-medium tracking-[0.07em] text-ink-muted uppercase backdrop-blur-sm"
          >
            {group}
            <span className="ml-1.5 font-normal tabular-nums text-ink-subtle">{groupItems.length}</span>
          </h2>
          <ul className="divide-y divide-ink/[0.07] bg-white">
            {groupItems.map((item) => (
              <li key={item.id}>
                <ActivityRow item={item} onOpen={onOpen} density={density} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
