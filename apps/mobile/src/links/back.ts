import type { useRouter } from "expo-router"

/**
 * BACK, WITH SOMEWHERE TO GO.
 *
 * `router.back()` dispatches GO_BACK whether or not anything can handle it, and
 * a screen reached by a push from another tab may be alone on its stack. The
 * nested layouts name their initial route so that is rare; this is the second
 * line of defence, so that even then the person lands on the surface the screen
 * belongs to rather than on an error.
 */
export function goBackOr(router: ReturnType<typeof useRouter>, fallback: "/calendar" | "/fixtures"): void {
  if (router.canGoBack()) {
    router.back()
    return
  }
  router.replace(fallback)
}
