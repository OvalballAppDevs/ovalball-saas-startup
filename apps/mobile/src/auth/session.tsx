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

/**
 * `recovering` IS ITS OWN STATE, and that is the whole reason this is not a boolean.
 *
 * Completing a recovery link produces a REAL session at AAL1. Without a distinct state the gate would
 * read that as "signed in" and drop the person into the product with a password they do not know, or
 * -- for an account holding a factor -- as "needs-mfa" and send them to a TOTP challenge before they
 * have set the password they came to set. Neither is what a recovery means, so it is named.
 */
export type SessionStatus = "restoring" | "signed-out" | "needs-mfa" | "signed-in" | "recovering"

interface SessionState {
  status: SessionStatus
  session: Session | null
  userId: string | null
  email: string | null
  refreshAssurance: () => Promise<void>
  signIn: (email: string, password: string) => Promise<FriendlyError | null>
  signOut: () => Promise<void>
  /**
   * Exchange a recovery code for a session and hold the app in `recovering` until a password is set.
   * Returns a friendly failure for a link that is expired, already used, or not this device's.
   */
  beginRecovery: (code: string) => Promise<FriendlyError | null>
  /** The password has been set; return to whatever the session's real status is. */
  endRecovery: () => Promise<void>
}

const SessionContext = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<SessionStatus>("restoring")
  const mounted = useRef(true)
  // A ref, not state: `apply` runs from the auth listener and must see the current value rather than
  // the one captured when the listener was registered, or the first token refresh during a recovery
  // would silently drop the app back into the product.
  const recovering = useRef(false)

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
      // A recovery in progress outranks everything except losing the session altogether -- which is
      // what signing out during a recovery does, and must still work.
      setStatus(recovering.current && next ? "recovering" : nextStatus)
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
    recovering.current = false
    // Local scope first: the point of signing out on a shared handset is that THIS device forgets,
    // and that must happen even with no signal. The library clears the stored session either way.
    await supabase.auth.signOut({ scope: "local" })
    if (!mounted.current) return
    setSession(null)
    setStatus("signed-out")
  }, [])

  /**
   * THE RECOVERY LINK IS EXCHANGED WITH THE AUTH SERVER, which is the only thing that can say whether
   * it is valid. Expired, already used, malformed, replayed, or issued for a verifier this device does
   * not hold all come back as an error here -- this app does not judge any of them itself, and could
   * not, because the authority is GoTrue's.
   */
  const beginRecovery = useCallback(async (code: string): Promise<FriendlyError | null> => {
    recovering.current = true
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error || !data.session) {
      recovering.current = false
      const problem = friendly(error ?? new Error("recovery link"), "that link")
      logDetail("recovery exchange", problem)
      return {
        // Deliberately one message for every reason a link can fail. Telling somebody a link was
        // "already used" rather than "expired" tells whoever is holding a stolen link the same thing.
        message: "That reset link is no longer valid. Ask for a new one and use the most recent email.",
        detail: problem.detail,
        retryable: false,
      }
    }
    await apply(data.session)
    return null
  }, [apply])

  const endRecovery = useCallback(async () => {
    recovering.current = false
    const { data } = await supabase.auth.getSession()
    await apply(data.session)
  }, [apply])

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
      beginRecovery,
      endRecovery,
    }),
    [status, session, refreshAssurance, signIn, signOut, beginRecovery, endRecovery]
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionState {
  const value = useContext(SessionContext)
  if (!value) throw new Error("useSession must be used inside SessionProvider")
  return value
}
