import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

/**
 * A SEASON PLANNER CLUB DAY ON THE WEBSITE (20270761000000).
 *
 * The club day's own screen is the mobile Season Planner's while the owner reviews it; the website has no grouped
 * page yet. A club-day notification opened here goes to the canonical request conversation of the club day's first
 * fixture -- where each fixture can still be answered -- or, if the reader cannot see it, to Fixtures.
 */
export default async function ClubDayPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const supabase = await createClient()
  const { data } = await supabase.from("fixture_requests").select("id").eq("group_id", groupId).order("created_at").limit(1).maybeSingle()
  redirect(data?.id ? `/messages/request/${data.id}` : "/fixtures")
}
