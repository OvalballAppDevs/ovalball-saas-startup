import { useEffect, useState } from "react"

import { readPitchAllocationCapabilities, type PitchAllocationCapabilities } from "@ovalball/contracts/pitch-allocation"

import { supabase } from "../auth/supabase"
import { useAppContexts } from "../context/contexts"

/** The board's two keys for the active club, asked of the server; cleared first on every context change. */
export function useVenueAllocationAccess(): { allocate: boolean; viewAllocation: boolean } {
  const { active } = useAppContexts()
  const clubId = active?.kind === "club" ? (active.clubId ?? active.id) : null
  const [caps, setCaps] = useState<PitchAllocationCapabilities>({ view: false, manage: false })
  useEffect(() => {
    let live = true
    setCaps({ view: false, manage: false })
    if (!clubId) return
    void readPitchAllocationCapabilities(supabase, clubId).then((c) => { if (live) setCaps(c) }).catch(() => undefined)
    return () => {
      live = false
    }
  }, [clubId])
  return { allocate: caps.manage, viewAllocation: caps.view }
}
