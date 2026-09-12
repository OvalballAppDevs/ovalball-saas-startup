"use server"

import { createClient } from "@/lib/supabase/server"

export interface ContactCandidate {
  userId: string
  displayName: string
  contextLabel: string
  contextDetail: string | null
}

/**
 * The people this person may start a 1:1 with.
 *
 * A thin pass to public.my_direct_message_candidates, which is built only
 * from relationships the caller already holds. It is NOT a user search: there
 * is no query shape here that reaches anybody outside those relationships, so
 * a name filter can safely run in the browser over an already-authorised list
 * rather than becoming a server-side directory lookup.
 */
export async function listContactCandidates(): Promise<ContactCandidate[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("my_direct_message_candidates")
  if (error || !data) return []

  return data.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name ?? "Ovalball user",
    contextLabel: row.context_label,
    contextDetail: row.context_detail,
  }))
}
