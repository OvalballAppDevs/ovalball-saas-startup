import { Linking } from "react-native"
import type { useRouter } from "expo-router"
import { hubHrefFor, parseHubHref, type HubDestination } from "@ovalball/contracts/rugby-hub/destinations"

import { webUrl } from "../config/environment"
import { routeForHubDestination } from "./route-table"

export { routeForHubDestination } from "./route-table"

/**
 * Open a Hub href from anywhere in the app -- a related-content chip, a search
 * result, a glossary "Read more". The href is parsed, routed, and pushed; a Hub
 * link this vocabulary does not know is opened on the website in the system
 * browser so the person still reaches it, and is the ONLY case that leaves the
 * app. It is expected never to happen, and `docs/mobile/RUGBY_HUB_PARITY_MAP.md`
 * lists no destination that relies on it.
 */
export function openHubHref(router: ReturnType<typeof useRouter>, href: string): void {
  const destination = parseHubHref(href)
  const route = destination ? routeForHubDestination(destination) : null
  if (route) {
    router.push(route as never)
    return
  }
  openExternal(href.startsWith("/") ? `${webUrl}${href}` : href)
}

/** The canonical web address of a destination -- what the app shares, and what a browser opens. */
export function hubWebUrl(destination: HubDestination): string {
  return `${webUrl}${hubHrefFor(destination)}`
}

/** An official source, a governing-body page: the system browser, never an embedded one. */
export function openExternal(url: string): void {
  void Linking.openURL(url).catch(() => undefined)
}
