import { redirect } from "next/navigation"

/**
 * CLUBHOUSE V1 CONSOLIDATION (owner product decision): Partner Clubs is no longer a separate
 * destination -- it is absorbed into Clubhouse (`app/(app)/clubhouse/`), which carries every partner
 * behaviour this page used to (request, respond, revoke, the directory map/search) plus Find a
 * Fixture, Compare Calendars and Invite to Ovalball in one place. This route stays only so an existing
 * bookmark or an external link does not break.
 */
export default function PartnerClubsRedirect() {
  redirect("/clubhouse")
}
