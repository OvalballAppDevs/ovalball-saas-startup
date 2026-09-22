import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"

import {
  getSessionContext,
  listSwitchableContexts,
  resolveActiveContext,
  resolvePersonalAvatarUrl,
  type SessionContext as OvalballSessionContext,
  type SwitchableContext,
} from "@ovalball/contracts"

import { supabase } from "../auth/supabase"
import { useSession } from "../auth/session"
import { friendly, logDetail, type FriendlyError } from "../errors/translate"

/**
 * ONE IDENTITY, MANY RELATIONSHIPS, ONE SELECTED CONTEXT.
 *
 * This is the architectural claim the whole app rests on, and it is not reimplemented here. The same
 * `getSessionContext` the website runs reads the memberships, team assignments, guardian
 * relationships, linked players, site-admin record and governing-body memberships; the same
 * `listSwitchableContexts` turns those into the list a person may operate as. Both live in
 * `packages/contracts` and both clients import them, so an account with a club role, a coaching
 * assignment, two children and a county officer seat gets the same seven contexts in the app as in the
 * browser -- because it is the same function, not because two implementations agree today.
 *
 * SELECTING A CONTEXT IS A PREFERENCE, NOT A PERMISSION. The website keeps it in a cookie and says so
 * plainly; this keeps it in AsyncStorage for the same reason -- it is a view preference, it is not
 * secret, and a person who edits it can at most select a context they were already offered.
 * `resolveActiveContext` falls back to the first legitimate context when a stored key no longer
 * matches anything, which is what happens when a coaching assignment ends between two launches.
 *
 * WHAT IS DELIBERATELY NOT CACHED. Capabilities. Not one is held here. What a person may DO is asked
 * of the server each time it matters, because a cached "yes" outlives the permission it came from and
 * would still be on the phone after a Club Admin took it away.
 */

const SELECTED_CONTEXT_KEY = "ovalball.selected-context"

interface ContextState {
  loading: boolean
  error: FriendlyError | null
  /** The signed-in person, never the context they are viewing. */
  person: { firstName: string | null; avatarUrl: string | null; email: string | null }
  contexts: SwitchableContext[]
  active: SwitchableContext | null
  select: (key: string) => Promise<void>
  reload: () => Promise<void>
}

const AppContexts = createContext<ContextState | null>(null)

export function ContextProvider({ children }: { children: React.ReactNode }) {
  const { status, session, email } = useSession()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [ctx, setCtx] = useState<OvalballSessionContext | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (status !== "signed-in" || !session?.user) {
      setCtx(null)
      setAvatarUrl(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const loaded = await getSessionContext(supabase, session.user)
      setCtx(loaded)
      // THE PERSON'S OWN PICTURE, through the canonical resolver -- the private `avatars` bucket and a
      // short-lived signed URL, exactly as the web does. Never a club logo, and never a kit.
      const { data: profile } = await supabase
        .from("profiles")
        .select("avatar_storage_path")
        .eq("id", session.user.id)
        .maybeSingle()
      setAvatarUrl(await resolvePersonalAvatarUrl(supabase, profile?.avatar_storage_path ?? null))
      const stored = await AsyncStorage.getItem(SELECTED_CONTEXT_KEY)
      setSelectedKey(stored)
    } catch (caught) {
      const problem = friendly(caught, "your teams")
      logDetail("session context", problem)
      setError(problem)
    } finally {
      setLoading(false)
    }
  }, [status, session])

  useEffect(() => {
    void load()
  }, [load])

  const contexts = useMemo(() => (ctx ? listSwitchableContexts(ctx) : []), [ctx])
  const active = useMemo(
    () => (ctx ? resolveActiveContext(ctx, selectedKey) : null),
    [ctx, selectedKey]
  )

  const select = useCallback(async (key: string) => {
    setSelectedKey(key)
    await AsyncStorage.setItem(SELECTED_CONTEXT_KEY, key)
  }, [])

  const value = useMemo<ContextState>(
    () => ({
      loading,
      error,
      person: { firstName: ctx?.firstName ?? null, avatarUrl, email },
      contexts,
      active,
      select,
      reload: load,
    }),
    [loading, error, ctx, avatarUrl, email, contexts, active, select, load]
  )

  return <AppContexts.Provider value={value}>{children}</AppContexts.Provider>
}

export function useAppContexts(): ContextState {
  const value = useContext(AppContexts)
  if (!value) throw new Error("useAppContexts must be used inside ContextProvider")
  return value
}

/**
 * Clears the selected context on sign-out.
 *
 * Small, and it matters: the next person to sign in on a shared handset must not land in the previous
 * person's team. Everything else sensitive lives in the session store, which the library clears.
 */
export async function forgetSelectedContext(): Promise<void> {
  await AsyncStorage.removeItem(SELECTED_CONTEXT_KEY)
}
