import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"

import {
  EMPTY_FAMILY,
  loadFamilyProjection,
  normaliseSelection,
  selectedMember,
  teamIdsForSelection,
  type FamilyMember,
  type FamilyProjection,
} from "@ovalball/contracts"

import { supabase } from "../auth/supabase"
import { useAppContexts } from "../context/contexts"

/**
 * WHICH CHILD AM I LOOKING AT — ONE ANSWER, FOR EVERY PARENT SURFACE.
 *
 * Home, Fixtures, Calendar, Match Centre and Training Centre all need the same
 * two things: the children this context legitimately covers, and which of them
 * the parent has narrowed to. Answering that per screen is how one surface shows
 * both children while another is still filtered to one, and how a selection is
 * lost every time somebody changes tab.
 *
 * SO IT IS SESSION STATE, not a prop threaded through five components. A screen
 * asks `useFamily()` and gets the same answer every other screen has.
 *
 * ------------------------------------------------------------------
 * A CHILD FILTER IS NOT A CONTEXT SWITCH, and conflating them would be the
 * worst thing this module could do.
 *
 *   THE CONTEXT SWITCHER changes who the signed-in person is OPERATING AS --
 *   parent, coach, club admin. It changes navigation, default scope and which
 *   of their proved relationships a page acts on behalf of.
 *
 *   THE CHILD FILTER narrows what is shown INSIDE the Parent/Guardian context.
 *
 * Selecting Pippa does not make the signed-in person Pippa. A parent remains the
 * parent: their authority is unchanged, their avatar is unchanged, and nothing
 * they may do becomes something Pippa may do. The two live in different modules
 * for exactly this reason -- `contexts.tsx` owns the first, this owns the second,
 * and neither writes the other's state.
 * ------------------------------------------------------------------
 *
 * THE ALLOWED VALUES ARE THE SERVER'S. `loadFamilyProjection` is built from
 * `resolveFamilyScope`, which reads only relationships the session proved.
 * Nothing here derives a child from a club, a surname, a team, a fixture or a
 * link. A restored or deep-linked id is CHECKED against that list and normalised
 * to "all children" when it is not there -- never used to fetch, and never shown
 * as a selected chip naming somebody this person does not hold.
 *
 * AND SELECTING NARROWS NOTHING THE SERVER HAD NOT ALREADY DECIDED. The rows a
 * surface filters were returned for the whole family; the filter removes from
 * them. There is no query here for a selection to widen.
 */

import { SELECTED_CHILD_KEY } from "./selection"

interface FamilyState {
  loading: boolean
  projection: FamilyProjection
  /** The selected child, or null for ALL CHILDREN. Always a value the projection contains. */
  selectedPlayerId: string | null
  selected: FamilyMember | null
  /** The teams the current selection covers, for a surface that narrows by team. */
  teamIds: string[]
  /** True when there is genuinely more than one child to choose between. */
  hasChoice: boolean
  select: (playerId: string | null) => void
  reload: () => Promise<void>
}

const FamilyContext = createContext<FamilyState | null>(null)

export function FamilyProvider({ children }: { children: React.ReactNode }) {
  const { sessionContext, active, loading: contextLoading } = useAppContexts()
  const [projection, setProjection] = useState<FamilyProjection>(EMPTY_FAMILY)
  const [loading, setLoading] = useState(true)
  const [requested, setRequested] = useState<string | null>(null)
  const [restored, setRestored] = useState(false)

  const load = useCallback(async () => {
    if (!sessionContext || !active) {
      setProjection(EMPTY_FAMILY)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setProjection(await loadFamilyProjection(supabase, sessionContext, active))
    } catch {
      // A family that cannot be resolved is an empty family, not a broken
      // screen: every surface renders its own honest empty state, and none of
      // them is blocked by a picture that failed to sign.
      setProjection(EMPTY_FAMILY)
    } finally {
      setLoading(false)
    }
  }, [sessionContext, active])

  useEffect(() => {
    void load()
  }, [load])

  // THE LAST CHOICE IS REMEMBERED, and then CHECKED. A parent who filtered to
  // one child yesterday should find that filter today; a parent whose child's
  // place has since ended should find their family, not an error about an id.
  useEffect(() => {
    void (async () => {
      try {
        setRequested(await AsyncStorage.getItem(SELECTED_CHILD_KEY))
      } catch {
        setRequested(null)
      } finally {
        setRestored(true)
      }
    })()
  }, [])

  /*
    THE NORMALISATION IS THE BOUNDARY, and it runs on every render rather than
    once at restore. Whatever the stored value, the deep link or a stale state
    holds, the SELECTION is only ever an id the current projection contains.
    Everything downstream reads this, so there is no path by which an id the
    parent does not hold reaches a query or a chip.
  */
  const selectedPlayerId = normaliseSelection(projection, requested)

  const value = useMemo<FamilyState>(
    () => ({
      loading: loading || contextLoading || !restored,
      projection,
      selectedPlayerId,
      selected: selectedMember(projection, selectedPlayerId),
      teamIds: teamIdsForSelection(projection, selectedPlayerId),
      hasChoice: projection.hasChoice,
      select: (playerId) => {
        // Stored as REQUESTED, not as accepted: the normalisation above still
        // has the final say, so writing a value here can never widen anything.
        setRequested(playerId)
        void AsyncStorage.setItem(SELECTED_CHILD_KEY, playerId ?? "").catch(() => {})
      },
      reload: load,
    }),
    [loading, contextLoading, restored, projection, selectedPlayerId, load]
  )

  return <FamilyContext.Provider value={value}>{children}</FamilyContext.Provider>
}

export function useFamily(): FamilyState {
  const value = useContext(FamilyContext)
  if (!value) throw new Error("useFamily must be used inside FamilyProvider")
  return value
}
