import { cache } from "react"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { loadClubMembershipBoard, type ClubMembershipBoard } from "@ovalball/contracts/membership/board"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"

/**
 * WHO MAY OPEN THE CLUB'S MEMBERSHIPS, ASKED ONCE PER REQUEST (Club Memberships Part 2).
 *
 * The same door the Finance Dashboard always had: `finance.subscription.view` at the CLUB, for the club the person is
 * working in. A Team Manager holds that capability only at their team, so they are sent away here exactly as before
 * (browser suite 89 E4), and so is anybody else without it. Every page of the area asks this itself -- not only a
 * shared header -- because a page can be requested on its own; and every server operation behind the pages asks
 * again, so hiding a control here is never the boundary.
 *
 * The other keys decide only what is OFFERED: configure (Settings), enrolment (reminders, waive, generate, change who
 * pays), payments (retry, cancel) and export. `cache` keeps it to one capability read and one board read per request
 * however many parts of the page ask.
 */
export interface MembershipsAccess {
  supabase: Awaited<ReturnType<typeof createClient>>
  clubId: string
  clubName: string
  /** False when a link chose a club other than the one the person is working in (a member page's `?club=`). */
  isActiveClub: boolean
  can: { configure: boolean; enrolment: boolean; payments: boolean; export: boolean }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Always called through the wrappers below with an explicit argument: `cache` keys on the arguments, so a call with
// none and a call with null would otherwise be two reads.
const accessFor = cache(async (clubOverride: string | null): Promise<MembershipsAccess> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const workingClubId = activeClubId(ctx, activeContext)
  // A link may name the club (a member's page opened from the phone): only a selector -- the capability below, and the
  // server's own reads, decide whether this person may see it.
  const clubId = clubOverride && UUID.test(clubOverride) ? clubOverride : workingClubId

  const canView = clubId ? await hasCapability(supabase, "finance.subscription.view", "club", { clubId }) : false
  if (!clubId || !canView) redirect("/dashboard")

  const [configure, enrolment, payments, exportable] = await Promise.all([
    hasCapability(supabase, "finance.subscription.configure", "club", { clubId }),
    hasCapability(supabase, "finance.enrolment.manage", "club", { clubId }),
    hasCapability(supabase, "finance.payment.act", "club", { clubId }),
    hasCapability(supabase, "finance.subscription.export", "club", { clubId }),
  ])

  const clubName =
    (activeContext.kind === "club" && workingClubId === clubId ? activeContext.label : null) ??
    ctx.clubMemberships.find((m) => m.clubId === clubId)?.clubName ??
    "Club"

  return { supabase, clubId, clubName, isActiveClub: clubId === workingClubId, can: { configure, enrolment, payments, export: exportable } }
})

const boardFor = cache(async (clubOverride: string | null): Promise<ClubMembershipBoard | null> => {
  const { supabase, clubId } = await accessFor(clubOverride)
  return loadClubMembershipBoard(supabase, clubId).catch(() => null)
})

export function requireMembershipsAccess(clubOverride: string | null = null): Promise<MembershipsAccess> {
  return accessFor(clubOverride ?? null)
}

/** The club's board for this request: null when the server could not answer (the page says so). */
export function loadMembershipsBoard(clubOverride: string | null = null): Promise<ClubMembershipBoard | null> {
  return boardFor(clubOverride ?? null)
}
