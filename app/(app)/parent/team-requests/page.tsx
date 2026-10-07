import { redirect } from "next/navigation"

import { PageIdentity } from "@/components/shell/page-identity"
import { createClient } from "@/lib/supabase/server"
import { readFamilyTeamRequests } from "@ovalball/contracts/team/team-code"

import { TeamRequestList } from "./request-card"

export const dynamic = "force-dynamic"
export const metadata = { title: "Team Requests" }

/**
 * WHAT WAITS ON A PARENT -- the requests their children made themselves from their own accounts with a
 * team's code (team codes place players, 20270741000000). `family_team_requests` returns only what waits
 * on THIS parent, so a link to a request that has since been answered -- by the other parent, or never
 * theirs -- simply is not here. The notification and the Action Required row both open this page with
 * `?request=<id>`, which is drawn first and marked.
 */
export default async function TeamRequestsPage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const { request: highlighted } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const requests = await readFamilyTeamRequests(supabase).catch(() => [])
  const ordered = [...requests].sort((a, b) => (a.membershipId === highlighted ? -1 : b.membershipId === highlighted ? 1 : 0))
  const single = ordered.length === 1 ? ordered[0] : null

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <PageIdentity workspace="Family" title={single ? `Confirm ${single.firstName}'s Request` : "Team Requests"} />
      <TeamRequestList requests={ordered} highlighted={highlighted ?? null} />
    </div>
  )
}
