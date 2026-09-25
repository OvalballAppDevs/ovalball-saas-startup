import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

/**
 * CLUBHOUSE PROGRAMME SECTION 7 -- OLD COMPARE CALENDARS ROUTE, CONSOLIDATED.
 *
 * This page used to render its own month-grid/agenda calendar (`get_partner_team_availability`,
 * "Available -- click to request" for every date not literally a fixture). That is EXACTLY the "EMPTY
 * CALENDAR != AVAILABLE" defect Section 7 exists to close (found and fixed in the shared contract this
 * section) -- rather than fix a second, older surface with the same bug, Clubhouse's own Find a Fixture
 * (Section 6/7) is now the one canonical scheduling-discovery experience, so this legitimate deep link
 * (a partner's "Shared calendar" button, and any bookmark to it) redirects into it with the opponent
 * club preselected/filtered -- never a broken link, never a duplicate product.
 *
 * "Both teams preselected" is not possible here honestly: this route never captured which of the
 * caller's OWN teams was asking (`get_partner_team_availability` only ever took the OPPONENT's team as
 * a parameter) -- Find a Fixture's own existing team-selection step (Section 6) is exactly where that
 * question belongs, asked once, the same way every other Clubhouse entry point already asks it.
 */
export default async function PartnerClubAvailabilityRedirect({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId: partnerClubId } = await params
  const supabase = await createClient()
  const { data: partnerClub } = await supabase.from("clubs").select("directory_id").eq("id", partnerClubId).maybeSingle()

  if (!partnerClub) redirect("/clubhouse")
  redirect(`/clubhouse/find-fixture?opponentDirectoryId=${partnerClub.directory_id}&opponentClubId=${partnerClubId}`)
}
