import * as Linking from "expo-linking"
import type { useRouter } from "expo-router"

import { webUrl } from "../config/environment"
import { routeForIntent } from "../links/destinations"
import { resolveIntent } from "../links/intents"

/**
 * WHERE A LINK IN PUBLISHED CONTENT GOES.
 *
 * A club writes `[Fixtures](/fixtures)` or `[Kit shop](https://...)` in an article; the contract's
 * `safeHref` has already refused anything that is not https, mailto or a path on Ovalball. An external
 * address opens in the system browser -- deliberately, after a tap, never inline. An in-app path is
 * handed to the ONE link resolver this app has: where the resolver knows a native screen for it, that
 * screen opens; where it does not, the website is the canonical destination and opens in the browser.
 */
export function openContentLink(router: ReturnType<typeof useRouter>, href: string, external: boolean): void {
  if (external) {
    void Linking.openURL(href)
    return
  }
  const route = routeForIntent(resolveIntent(`${webUrl || "https://ovalball.app"}${href}`))
  if (route) router.push(route as never)
  else void Linking.openURL(`${webUrl}${href}`)
}

/** "2h ago", "Yesterday", "3 days ago", "2 weeks ago" -- the only time a card needs. */
export function relativeTime(iso: string | null): string {
  if (!iso) return ""
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const minutes = Math.floor((Date.now() - then) / 60_000)
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days} days ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`
  return longDate(iso)
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/** "24 September 2026" */
export function longDate(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** "Tomorrow, 09:00" style: a date with its time, for a notice window. */
export function dateTime(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  return `${longDate(iso)}, ${hh}:${mm}`
}
