import { useCallback, useEffect, useRef, useState } from "react"
import { useFocusEffect } from "expo-router"
import { readAdminCentreAccess, type AdminCentreSection } from "@ovalball/contracts/club/admin-centre"

import { supabase } from "../auth/supabase"
import { useAppContexts } from "../context/contexts"

/**
 * WHETHER THE ADMIN CENTRE IS THERE AT ALL, and which of its sections -- asked of the SERVER.
 *
 * The rule is the website's: a job appears for a person who holds its capability at the club,
 * decided by `my_capabilities` (the canonical engine), never by the label of the context they are
 * standing in. A Club Admin context whose holder has had `club.profile.edit` withheld by a Site
 * Admin sees no Club Profile row, because the server says so; a Fixtures Secretary context sees the
 * rows its capabilities earn.
 *
 * RE-ASKED, NEVER CACHED ACROSS: on every context change and every time a screen that uses it comes
 * back into focus. A yes held from yesterday is how a control gets offered and then refused.
 */
export interface AdminCentreState {
  loading: boolean
  /** The selected context's club, when the selected context is a club context. */
  clubId: string | null
  sections: AdminCentreSection[]
  refresh: () => Promise<void>
}

export function useAdminCentreAccess(): AdminCentreState {
  const { active } = useAppContexts()
  const clubId = active?.kind === "club" ? (active.clubId ?? active.id) : null
  // EVERY ANSWER CARRIES THE CLUB IT WAS ASKED FOR, and is only ever shown while that is still the selected club: a
  // slow read started under Club A that lands after a switch to Club B is discarded, never shown as B's rows (M8).
  const [answer, setAnswer] = useState<{ clubId: string | null; sections: AdminCentreSection[] } | null>(null)
  const current = useRef(clubId)
  current.current = clubId

  const refresh = useCallback(async () => {
    const asked = clubId
    if (!asked) {
      setAnswer({ clubId: null, sections: [] })
      return
    }
    let sections: AdminCentreSection[] = []
    try {
      sections = (await readAdminCentreAccess(supabase, asked)).sections
    } catch {
      sections = []
    }
    if (current.current !== asked) return
    setAnswer({ clubId: asked, sections })
  }, [clubId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh])
  )

  const mine = answer && answer.clubId === clubId ? answer.sections : null
  return { loading: mine === null, clubId, sections: mine ?? [], refresh }
}
