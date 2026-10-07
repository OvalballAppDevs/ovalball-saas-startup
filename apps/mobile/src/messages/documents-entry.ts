import { useEffect, useState } from "react"
import { readClubLibraryAuthority } from "@ovalball/contracts/documents/library"

import { supabase } from "../auth/supabase"
import { useLibraryClubId } from "../documents/shared"

/**
 * WHETHER CLUB DOCUMENTS IS OFFERED FROM MESSAGES.
 *
 * The library is the same canonical library the Admin Centre opens (`/admin/documents`); messaging
 * only links to it. Offered where the server says this person may view the active club's library --
 * one `my_capabilities` probe -- and otherwise simply absent. What it shows only: every read is RLS.
 */
export function useClubDocumentsEntry(): boolean {
  const clubId = useLibraryClubId()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!clubId) {
      setVisible(false)
      return
    }
    let live = true
    void readClubLibraryAuthority(supabase, clubId)
      .then((authority) => {
        if (live) setVisible(authority.view)
      })
      .catch(() => {
        if (live) setVisible(false)
      })
    return () => {
      live = false
    }
  }, [clubId])

  return visible
}
