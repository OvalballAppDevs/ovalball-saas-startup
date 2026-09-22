import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"

import {
  clubLogoUrlFromPath,
  getSessionContext,
  listSwitchableContexts,
  resolveActiveContext,
  resolvePersonalAvatarUrl,
  type SessionContext as OvalballSessionContext,
  type SwitchableContext,
} from "@ovalball/contracts"

import { AppState } from "react-native"

import { supabase } from "../auth/supabase"
import { useSession } from "../auth/session"
import { loadInbox, unreadTotal } from "../messages/inbox"
import { canManageClubCrest } from "../identity/images"
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
  /** The canonical session context, for readers that take it (the inbox assembler does). */
  sessionContext: OvalballSessionContext | null
  contexts: SwitchableContext[]
  active: SwitchableContext | null
  /**
   * THE ONE CAPABILITY THIS SHELL ASKS FOR, and it is asked of the SERVER.
   *
   * The bottom bar gives its fifth cell to Subscriptions for somebody who may actually open it, so it
   * has to know -- and the only acceptable way to know is `my_capabilities`, which runs
   * `internal.capability_decision` and is the same resolver the website uses. Deriving it from the
   * context kind would hand the cell to every coach who cannot open the page, and would be a
   * capability decided on a handset.
   *
   * It is re-asked on every context change and never cached across one: a cached yes outlives the
   * permission it came from.
   */
  canSeeTeamSubscriptions: boolean
  /**
   * THE OWNING CLUB'S OWN IDENTITY, resolved once for whatever context is selected.
   *
   * Section 20's invariant: standing in Under 12 Boys, the club identity shown is Preston
   * Grasshoppers' crest -- not the team's, and never a kit. It lives HERE rather than on each screen
   * because the header is on every screen, and a screen that forgot to pass it fell back to the TEAM's
   * initials, which is a different club identity on different pages of the same app. One resolution,
   * one answer.
   *
   * The URL comes from `clubLogoUrlFromPath`, the canonical rule: the club's own upload, else the Club
   * Directory's branding logo, else nothing -- and nothing means initials, never a substitute image.
   */
  club: { name: string | null; crestUrl: string | null; clubId: string | null; hasOwnCrest: boolean; canManageCrest: boolean }
  /**
   * UNREAD MESSAGES, counted from the same rows the inbox lists.
   *
   * Not a second notification system: `loadInbox` returns the canonical rows and this is their sum,
   * so the badge and the list agree by construction rather than by coincidence.
   *
   * REFRESHED DETERMINISTICALLY, not in realtime. Recounted when the app comes to the front, when the
   * context changes, and when a conversation is read. Realtime exists in the platform and could be
   * reused, but a subscription that must be torn down on every context switch is a correctness problem
   * before it is a performance one -- recorded as hardening debt rather than half-built here.
   */
  unreadMessages: number
  /** Recount after reading, so the badge clears without waiting for a focus event. */
  refreshUnread: () => Promise<void>
  /**
   * RE-READ THE TWO IDENTITY PICTURES, after one of them has been changed.
   *
   * The owner asked for the picture in the header to BE the control for changing
   * it, and "changes canonically" is the part that matters: the write goes to
   * `profiles.avatar_storage_path` or `clubs.logo_storage_path`, which every
   * surface already reads, and this re-reads them so the header shows the new one
   * without the person having to leave the screen.
   *
   * Narrower than `reload` on purpose. A full reload re-resolves the session
   * context, the switchable contexts and the capability probe, which is a lot of
   * work to do because somebody chose a new photograph -- and it would reset the
   * selected context along the way.
   */
  refreshIdentityImages: () => Promise<void>
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

  const EMPTY_CLUB = { name: null, crestUrl: null, clubId: null, hasOwnCrest: false, canManageCrest: false }
  const [club, setClub] = useState<ContextState["club"]>(EMPTY_CLUB)

  /**
   * The club identity, plus whether this person may CHANGE its crest.
   *
   * The capability is asked of `my_capabilities`, which is the same engine
   * `club_logos_insert_club_admin` evaluates when the upload happens -- so the
   * crest becomes a control only for somebody the write would admit, and stays a
   * plain picture for everybody else. A control that is offered and then refused
   * is worse than no control.
   *
   * `hasOwnCrest` is deliberately separate from `crestUrl`: a club with no upload
   * of its own still shows the Club Directory's branding logo, so a non-null URL
   * does not mean there is anything to remove.
   */
  const loadClub = useCallback(async (clubId: string | null) => {
    if (!clubId) {
      setClub(EMPTY_CLUB)
      return
    }
    const [{ data }, canManageCrest] = await Promise.all([
      supabase.from("clubs").select("logo_storage_path, club_directory(name, logo_storage_path)").eq("id", clubId).maybeSingle(),
      canManageClubCrest(supabase, clubId),
    ])
    if (!data) {
      setClub({ ...EMPTY_CLUB, clubId })
      return
    }
    setClub({
      name: data.club_directory?.name ?? null,
      crestUrl: clubLogoUrlFromPath(supabase, data.logo_storage_path ?? data.club_directory?.logo_storage_path ?? null),
      clubId,
      hasOwnCrest: Boolean(data.logo_storage_path),
      canManageCrest,
    })
  }, [])

  useEffect(() => {
    let live = true
    // Cleared first: the previous club's crest must never sit beside the new context's name.
    setClub(EMPTY_CLUB)
    const clubId = active?.clubId ?? null
    void (async () => {
      if (!live) return
      await loadClub(clubId)
    })()
    return () => {
      live = false
    }
  }, [active, loadClub])

  const [canSeeTeamSubscriptions, setCanSeeTeamSubscriptions] = useState(false)
  useEffect(() => {
    let live = true
    // Cleared FIRST: the previous context's answer must never decide this context's navigation, even
    // for the moment the new answer is in flight.
    setCanSeeTeamSubscriptions(false)
    if (!active || active.kind !== "team" || !active.clubId) return
    void (async () => {
      const { data } = await supabase.rpc("my_capabilities", {
        p_scope_type: "team",
        p_club_id: active.clubId ?? undefined,
        p_team_id: active.id ?? undefined,
      })
      if (!live) return
      const allowed = (data ?? []).some(
        (row) => row.capability_key === "finance.subscription.view" && row.allowed === true
      )
      setCanSeeTeamSubscriptions(allowed)
    })()
    return () => {
      live = false
    }
  }, [active])

  const select = useCallback(async (key: string) => {
    setSelectedKey(key)
    await AsyncStorage.setItem(SELECTED_CONTEXT_KEY, key)
  }, [])

  /**
   * The unread count, recounted on the three events that can change it: the app coming to the front,
   * the context changing, and a conversation being read.
   */
  const [unreadMessages, setUnreadMessages] = useState(0)
  const refreshUnread = useCallback(async () => {
    if (status !== "signed-in" || !session?.user || !ctx) {
      setUnreadMessages(0)
      return
    }
    try {
      setUnreadMessages(unreadTotal(await loadInbox(supabase, ctx, session.user.id, active)))
    } catch (caught) {
      // A badge is not worth an error state. The inbox itself will report the failure when opened.
      logDetail("unread count", friendly(caught, "your messages"))
    }
  }, [status, session, ctx, active])

  useEffect(() => {
    void refreshUnread()
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void refreshUnread()
    })
    return () => subscription.remove()
  }, [refreshUnread])

  /** Both pictures, re-read from their canonical columns. See the field's own commentary. */
  const refreshIdentityImages = useCallback(async () => {
    if (status !== "signed-in" || !session?.user) return
    const { data: profile } = await supabase.from("profiles").select("avatar_storage_path").eq("id", session.user.id).maybeSingle()
    setAvatarUrl(await resolvePersonalAvatarUrl(supabase, profile?.avatar_storage_path ?? null))
    await loadClub(active?.clubId ?? null)
  }, [status, session, active, loadClub])

  const value = useMemo<ContextState>(
    () => ({
      loading,
      error,
      person: { firstName: ctx?.firstName ?? null, avatarUrl, email },
      sessionContext: ctx,
      contexts,
      active,
      canSeeTeamSubscriptions,
      unreadMessages,
      refreshUnread,
      refreshIdentityImages,
      club,
      select,
      reload: load,
    }),
    [loading, error, ctx, avatarUrl, email, contexts, active, canSeeTeamSubscriptions, unreadMessages, refreshUnread, refreshIdentityImages, club, select, load]
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
