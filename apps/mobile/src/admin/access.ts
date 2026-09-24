import { useCallback, useEffect, useState } from "react"
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
  const [sections, setSections] = useState<AdminCentreSection[] | null>(null)

  const refresh = useCallback(async () => {
    if (!clubId) {
      setSections([])
      return
    }
    try {
      const access = await readAdminCentreAccess(supabase, clubId)
      setSections(access.sections)
    } catch {
      setSections([])
    }
  }, [clubId])

  useEffect(() => {
    // Cleared FIRST: the previous context's answer must never decide this context's rows.
    setSections(null)
    void refresh()
  }, [refresh])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh])
  )

  return { loading: sections === null, clubId, sections: sections ?? [], refresh }
}
