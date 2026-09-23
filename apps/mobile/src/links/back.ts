import { useCallback } from "react"
import { useNavigation, useRouter } from "expo-router"

/**
 * BACK, TO THE SURFACE THE SCREEN BELONGS TO.
 *
 * A Training Centre or a Match Centre is reached two ways: pushed from its own
 * tab's agenda, or pushed straight from Home into another tab. In the first case
 * there is a screen beneath it and Back pops to it. In the second it is ALONE on
 * that tab's stack, and a plain `router.back()` is answered by the TABS navigator
 * -- the person lands on Home while the event stays parked on the Calendar tab,
 * which then opens on the event with no way out. Measured on the web build:
 * Home → Training Centre → Back gave `/`, and the Calendar tab then gave
 * `/calendar/training/<id>` again.
 *
 * So Back asks the STACK, not the router, whether there is anything beneath;
 * and when there is not, it dismisses to the surface's own index, which
 * replaces the parked screen with the agenda the person expected.
 */
export function useBackToSurface(surface: "/calendar" | "/fixtures" | "/hub"): () => void {
  const router = useRouter()
  const navigation = useNavigation()
  return useCallback(() => {
    const state = navigation.getState()
    if (state && state.index > 0) {
      router.back()
      return
    }
    router.dismissTo(surface)
  }, [navigation, router, surface])
}
