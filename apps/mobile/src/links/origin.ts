import { useCallback } from "react"
import { useLocalSearchParams, useNavigation, usePathname, useRouter } from "expo-router"

import { pathBeneath } from "./route-path"

/**
 * BACK TO WHERE THE PERSON CAME FROM -- one mechanism, not one per screen.
 *
 * Tabs keep their own stacks, so a detail screen opened from ANOTHER tab (Season Planner → a request, Requests →
 * a request, Calendar → a fixture) sits on a stack whose screen beneath it is not the one the person came from. A
 * plain `router.back()` then lands on that stack's index (the Fixtures list) or, at a stack's root, on Home.
 *
 * The opener says where it is with a `returnTo` param (a plain in-app path). Back then:
 *   1. with a `returnTo`: pops this screen (a nested section's root pops the section) and goes there -- or, when the
 *      screen beneath already IS that place, only pops, so it keeps its own way home (re-navigating would build a
 *      fresh copy that has forgotten it);
 *   2. without one, when the stack has a screen beneath: pops to it;
 *   3. otherwise: goes to the screen's own landing (`fallback`) -- a deep link, or a screen whose opener's params were
 *      replaced on the way back, always has a sensible way out (navigated to: it may be in another tab).
 */

/** Only an in-app path is honoured: never a URL, never a protocol, never empty. */
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("://")) return null
  return value
}

/** Params for opening a screen that should come back here. */
export function returnHere(pathname: string): { returnTo: string } {
  return { returnTo: pathname }
}

/**
 * A route FROM THE ONE TABLE, carrying where it was opened from. The destination is still decided by
 * `routeForIntent`; only the origin rides along, so Back returns to the screen that opened it.
 */
export function withReturnTo(route: { pathname: string; params?: Record<string, string> }, returnTo: string): { pathname: string; params: Record<string, string> } {
  return { pathname: route.pathname, params: { ...(route.params ?? {}), ...returnHere(returnTo) } }
}

export function useOriginBack(fallback: string): () => void {
  const router = useRouter()
  const navigation = useNavigation()
  const params = useLocalSearchParams<{ returnTo?: string }>()
  const returnTo = safeReturnTo(params.returnTo)
  const pathname = usePathname()
  return useCallback(() => {
    const state = navigation.getState()
    const beneath = !!state && state.index > 0
    if (returnTo) {
      if (beneath) {
        const routes = state.routes as { name: string; params?: Record<string, unknown> }[]
        const below = pathBeneath(pathname, routes[state.index], routes[state.index - 1])
        router.back()
        if (below === returnTo) return
      } else if (parentStackCanPop(navigation)) {
        // The root of a nested stack (a section with its own layout): pop the whole section off its tab too, or it
        // is still sitting there -- stale -- the next time that tab is opened.
        router.back()
      }
      router.navigate(returnTo as never)
      return
    }
    if (beneath) {
      router.back()
      return
    }
    // The root of its stack. When the fallback is this screen's own surface (a Training Centre opened from another
    // tab, whose surface is /calendar), DISMISS to it: that replaces the parked screen, where navigating would leave
    // it sitting beneath the surface with no way out. A fallback in another tab (the Admin Centre's "/") is
    // navigated to, because there is nothing in this stack to dismiss to.
    const ownSurface = fallback !== "/" && (pathname === fallback || pathname.startsWith(`${fallback}/`))
    if (ownSurface) {
      router.dismissTo(fallback as never)
      return
    }
    router.navigate(fallback as never)
  }, [navigation, router, returnTo, fallback, pathname])
}

/** A section's root can be popped off its tab only when the navigator holding it is a STACK with a screen beneath --
 * never via the tab bar's own history, which would switch tabs instead. */
function parentStackCanPop(navigation: { getParent: () => unknown }): boolean {
  const parent = navigation.getParent() as { getState?: () => { type?: string; index?: number } } | undefined
  const state = parent?.getState?.()
  return !!state && state.type === "stack" && (state.index ?? 0) > 0
}
