"use client"

import { useSyncExternalStore } from "react"

import { referralSlugFrom } from "@ovalball/contracts/clubhouse/referral-link"

const unchanging = () => () => {}

/**
 * The club referral this page was reached through -- `?ref=<slug>`, carried on from `/r/<slug>` (One
 * Referral Link per Club, 20270740000000) -- or none.
 *
 * READ FROM THE ADDRESS, NOT FROM THE ROUTER. The Clubhouse map mounts each pin's card in its own React
 * root (`club-map.tsx`, createRoot into Leaflet's popup), which has no router context: `useSearchParams()`
 * is null there, and reading it threw for every club not yet on Ovalball. `window.location` is the same
 * address in either tree. The server renders no referral; the first render in the browser fills it in.
 */
export function useReferralSlug(): string | null {
  return referralSlugFrom(
    useSyncExternalStore(unchanging, () => new URLSearchParams(window.location.search).get("ref"), () => null)
  )
}
