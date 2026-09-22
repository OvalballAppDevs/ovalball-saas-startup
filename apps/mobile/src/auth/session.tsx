import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { AppState } from "react-native"
import type { Session } from "@supabase/supabase-js"

import { supabase } from "./supabase"
import { friendly, logDetail, type FriendlyError } from "../errors/translate"

/**
 * WHO IS SIGNED IN, AND WHETHER THEY HAVE FINISHED SIGNING IN.
 *
 * Two different questions, and conflating them is how an app lets somebody past a second factor. A
 * Supabase session exists the moment a password is accepted; an account with a TOTP factor is at AAL1
 * at that point and is NOT yet authenticated to the standard Ovalball requires. So this provider
 * carries both the session and the assurance level, and the router sends an AAL1 session to the
 * verification screen rather than to the product.
 *
 * THE ASSURANCE LEVEL IS THE AUTH SERVER'S ANSWER, never a guess from the user record. The website
 * does exactly the same (`app/login/actions.ts`), and it stays true for social identities, for an
 * account that enrols a factor on another device, and for a session restored from disk weeks later.
 *
 * RESTORATION IS A STATE, NOT AN ABSENCE. `status` starts at "restoring" so the app can hold the
 * splash rather than flash the sign-in screen at somebody who is already signed in -- which reads as
 * having been logged out.
 */

export type SessionStatus = "restoring" | "signed-out" | "needs-mfa" | "signed-in"

interface SessionState {
  status: SessionStatus
  session: Session | null
  userId: string | null
  email: string | null
  refreshAssurance: () => Promise<void>
  signIn: (email: string, password: string) => Promise<FriendlyError | null>
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<SessionStatus>("restoring")
  const mounted = useRef(true)

  /** Ask the auth server where this session stands, and derive the status from that alone. */
  const classify = useCallback(async (next: Session | null): Promise<SessionStatus> => {
    if (!next) return "signed-out"
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (error) {
      // FAIL CLOSED. If the assurance level cannot be established, the session is not treated as fully
      // authenticated -- the alternative is letting a network blip stand in for a second factor.
      logDetail("assurance level", friendly(error, "your sign-in"))
      return "needs-mfa"
    }
    const mustStepUp = Boolean(data && data.nextLevel === "aal2" && data.nextLevel !== data.currentLevel)
    return mustStepUp ? "needs-mfa" : "signed-in"
  }, [])

  const apply = useCallback(
    async (next: Session | null) => {
      const nextStatus = await classify(next)
      if (!mounted.current) return
      setSession(next)
      setStatus(nextStatus)
    },
    [classify]
  )

  useEffect(() => {
    mounted.current = true
    void supabase.auth.getSession().then(({ data }) => apply(data.session))

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      void apply(next)
    })

    // A refresh timer that fires while the app is suspended is the "signed out overnight" report
    // nobody can reproduce. The library is told when the app is actually in front of somebody.
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") supabase.auth.startAutoRefresh()
      else supabase.auth.stopAutoRefresh()
    })
    supabase.auth.startAutoRefresh()

    return () => {
      mounted.current = false
      subscription.subscription.unsubscribe()
      appState.remove()
      supabase.auth.stopAutoRefresh()
    }
  }, [apply])

  const signIn = useCallback(async (email: string, password: string): Promise<FriendlyError | null> => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    if (error || !data.user) {
      const problem = friendly(error ?? new Error("invalid login credentials"), "your account")
      logDetail("sign in", problem)
      return problem
    }
    await apply(data.session)
    return null
  }, [apply])

  const signOut = useCallback(async () => {
    // Local scope first: the point of signing out on a shared handset is that THIS device forgets,
    // and that must happen even with no signal. The library clears the stored session either way.
    await supabase.auth.signOut({ scope: "local" })
    if (!mounted.current) return
    setSession(null)
    setStatus("signed-out")
  }, [])

  const refreshAssurance = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    await apply(data.session)
  }, [apply])

  const value = useMemo<SessionState>(
    () => ({
      status,
      session,
      userId: session?.user.id ?? null,
      email: session?.user.email ?? null,
      refreshAssurance,
      signIn,
      signOut,
    }),
    [status, session, refreshAssurance, signIn, signOut]
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionState {
  const value = useContext(SessionContext)
  if (!value) throw new Error("useSession must be used inside SessionProvider")
  return value
}
