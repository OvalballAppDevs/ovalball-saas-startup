"use server"

import { createClient } from "@/lib/supabase/server"

export interface OppositionContact {
  userId: string
  displayName: string
  teamLabel: string
  clubLabel: string
}

/**
 * The people on the other side of this fixture the viewer may message.
 *
 * A thin pass to public.fixture_opposition_contacts, which applies
 * internal.may_direct_message. Nothing is filtered here: a second opinion
 * about who is contactable is the one that goes stale, and this one would go
 * stale in the direction that matters — offering somebody the send path then
 * refuses.
 *
 * An empty list is the ordinary answer for most fixtures, because most name
 * their opponent from the Club Directory rather than as an Ovalball team.
 */
export async function listOppositionContacts(fixtureId: string): Promise<OppositionContact[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("fixture_opposition_contacts", {
    p_fixture_id: fixtureId,
  })
  if (error || !data) return []

  return data.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name ?? "Ovalball user",
    teamLabel: row.team_label,
    clubLabel: row.club_label,
  }))
}
