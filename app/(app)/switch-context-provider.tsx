"use client"

import { createContext, useContext, useMemo } from "react"

import { useSwitchContext } from "./use-switch-context"

interface SwitchContextState {
  switchTo: (key: string) => void
  isPending: boolean
}

const SwitchContextStateContext = createContext<SwitchContextState | null>(null)

/**
 * One shared context-switch transition for the whole authenticated app
 * shell -- both ContextSwitcher (desktop) and AppMobileNav (mobile) read
 * FROM this instead of each calling useSwitchContext() independently,
 * which used to give them two unsynchronized `isPending` flags. Section
 * 23 ("Fix stale context display"): ContextSwitchOverlay (rendered once,
 * as a sibling of `{children}` in layout.tsx) reads the SAME `isPending`
 * here to cover the main content area for the brief window between
 * clicking a context and the new server-rendered page landing -- so a
 * still-rendering previous club/team's content is never visible under
 * the newly-selected identity, without weakening or duplicating any
 * authorization check (this is presentation timing only; every page
 * underneath still independently reauthorizes against whatever context
 * cookie is actually set when its own request lands).
 */
export function SwitchContextProvider({ children }: { children: React.ReactNode }) {
  const { switchTo, isPending } = useSwitchContext()
  const value = useMemo(() => ({ switchTo, isPending }), [switchTo, isPending])
  return <SwitchContextStateContext.Provider value={value}>{children}</SwitchContextStateContext.Provider>
}

export function useSwitchContextState(): SwitchContextState {
  const ctx = useContext(SwitchContextStateContext)
  if (!ctx) {
    throw new Error("useSwitchContextState must be used within a SwitchContextProvider")
  }
  return ctx
}
