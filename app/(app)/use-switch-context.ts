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
      router.refresh()
    })
  }

  return { switchTo, isPending }
}
