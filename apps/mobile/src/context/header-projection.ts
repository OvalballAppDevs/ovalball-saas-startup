import type { UnreadCounts } from "@ovalball/contracts"

import { HEADER_UTILITIES, type TabKey } from "./tab-projection"

/**
 * THE HEADER CLUSTER IS A PROJECTION TOO.
 *
 * The bar has one (`projectTabs`); this is its twin for the three utilities that
 * sit in the global header on every screen. Keeping it in a plain module rather
 * than inside the JSX is what lets a test assert the thing that actually matters:
 * that each badge carries its OWN canonical count and no other.
 *
 * NOTHING HERE COUNTS ANYTHING. Every figure is copied straight across from the
 * one `public.my_unread_counts()` row. There is no sum, no fallback from one
 * topic to another, and no arithmetic -- because a bell that goes down when
 * somebody reads a message is a bell nobody trusts, and that is exactly the bug
 * a helpful-looking `total - messages` would reintroduce.
 *
 * `total` is deliberately unreachable from here. It exists for a single "you have
 * things waiting" signal elsewhere and must never be rendered as a badge.
 */
export interface HeaderUtility {
  key: TabKey
  /** The destination's own name, so the header and the More list cannot disagree. */
  label: string
  href: string
  /** The canonical count for THIS utility, never derived from a neighbour. */
  count: number
  /** Whether a badge is drawn at all. Zero unread is no badge, not a badge reading "0". */
  showBadge: boolean
  /**
   * What the badge reads. Above ninety-nine it becomes "99+": a four-digit badge
   * stops being a badge and starts being a layout problem, and nobody acts
   * differently at 130 than at 99.
   */
  badgeText: string
  /**
   * THE COUNT BELONGS IN THE SENTENCE, not only in the dot. A badge is a visual
   * affordance; "Messages, 3 unread" is the fact a screen reader needs.
   */
  accessibilityLabel: string
}

const PRESENTATION: Record<string, { label: string; href: string }> = {
  messages: { label: "Messages", href: "/messages" },
  notifications: { label: "Notifications", href: "/notifications" },
  support: { label: "Support", href: "/support" },
}

/** The count each utility owns — one field of the canonical row, and only that field. */
const COUNT: Record<string, (unread: UnreadCounts) => number> = {
  messages: (unread) => unread.messages,
  notifications: (unread) => unread.notifications,
  support: (unread) => unread.support,
}

export function projectHeaderUtilities(unread: UnreadCounts): HeaderUtility[] {
  return HEADER_UTILITIES.map((key) => {
    const presentation = PRESENTATION[key]
    // A negative or absent figure is shown as nothing rather than as a badge
    // reading "-1"; the database cannot produce one, and a broken read should
    // look quiet rather than alarming.
    const count = Math.max(0, COUNT[key](unread) || 0)
    return {
      key,
      label: presentation.label,
      href: presentation.href,
      count,
      showBadge: count > 0,
      badgeText: count > 99 ? "99+" : String(count),
      accessibilityLabel: count > 0 ? `${presentation.label}, ${count} unread` : presentation.label,
    }
  })
}
