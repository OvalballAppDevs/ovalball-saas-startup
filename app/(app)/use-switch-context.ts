"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"

import { setActiveContext } from "./set-context"

/**
 * Shared by the desktop dropdown and mobile inline list -- writes the
 * cookie server-side then refreshes so layout.tsx re-resolves the active
 * context on the next render. router.refresh() re-runs every server
 * component on the current route, so nav/identity/default scope all pick
 * up the new context without a full page reload.
 */
export function useSwitchContext() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function switchTo(key: string) {
    startTransition(async () => {
      await setActiveContext(key)
      // CONVERGENCE STEP 15 — a governing context has to LAND somewhere.
      //
      // Refreshing in place is right for every other kind: a club, a team and a family context all have
      // a version of the page you were already on. A governing body does not — none of its four
      // destinations exists under /club, /teams or /agenda — so refreshing would leave somebody with the
      // organisation's navigation and their club's page still on screen, which is precisely the two jobs
      // bleeding together that the context system exists to stop.
      //
      // The destination is derived from the key, and that is safe because it is not an authority: the
      // page refuses anybody without an ACTIVE role at that body, exactly as it does when the URL is
      // typed. A tampered key sends somebody to a page that turns them away.
      const bodyId = key.startsWith("governing:") ? key.slice("governing:".length) : null
      if (bodyId) {
        router.push(`/governing/${bodyId}`)
        return
      }
      router.refresh()
    })
  }

  return { switchTo, isPending }
}
