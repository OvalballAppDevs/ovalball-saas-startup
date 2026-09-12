import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

import { AnnouncementComposer, type SenderIdentity } from "./announcement-composer"

/**
 * THE IDENTITIES ARE ASKED OF THE DATABASE, NOT ASSEMBLED HERE.
 *
 * public.my_sender_identities is built from internal.may_send_as -- the same
 * function the insert trigger consults. So the list this page offers and the
 * list the database will accept are, by construction, one list.
 *
 * The alternative is to read the session's roles and work out which teams and
 * clubs "should" appear. That drifts the first time an authority rule
 * changes, and it drifts silently: the composer offers a team, the person
 * writes the announcement, and the trigger refuses it at the last step. A
 * boundary the person meets only after doing the work reads as a bug.
 */
export default async function NewAnnouncementPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data } = await supabase.rpc("my_sender_identities")

  const identities: SenderIdentity[] = (data ?? []).map((row) => ({
    identityType: row.identity_type as SenderIdentity["identityType"],
    identityId: row.identity_id,
    label: row.label,
    canAddressTeam: row.can_address_team,
    canAddressClub: row.can_address_club,
  }))

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Messages</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Send an Announcement</h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">
        One message to a whole team or club. Everyone receives it privately &mdash; nobody can see who else it
        went to.
      </p>

      <div className="mt-8">
        <AnnouncementComposer identities={identities} />
      </div>
    </div>
  )
}
