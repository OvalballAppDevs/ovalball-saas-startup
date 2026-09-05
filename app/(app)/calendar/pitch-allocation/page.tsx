import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"

import { getPitchAllocationBoard } from "./data"
import { PitchAllocationBoard } from "./pitch-allocation-board"

/**
 * Calendar -> Pitch Allocation. A VIEW of the same canonical Calendar
 * data every other view reads (Section 2) -- reachable as a Calendar tab,
 * living at its own route only because it needs genuinely different
 * server data-fetching than Week/Month/Agenda (the same reason Agenda is
 * its own route), matching the established precedent in this codebase.
 */
export default async function PitchAllocationPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)

  // Pitch Allocation is a CLUB-scoped board (Section 22-25) -- never
  // reachable from a team/parent/player/site_admin active context, even
  // for an account that separately holds club-wide authority elsewhere.
  if (activeContext.kind !== "club" || !activeContext.id) redirect("/calendar")

  const canManage = await hasCapability(supabase, "fixture.edit", "club", { clubId: activeContext.id })
  if (!canManage) redirect("/calendar")

  const now = new Date()
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  // Section: default to the NEXT date with a real home fixture, not
  // always today -- today frequently has nothing scheduled at all, which
  // read as a broken/empty board rather than "there's nothing to
  // allocate right now". Only applies when no ?date= was explicitly
  // given (a real navigation/bookmark to a specific date is never
  // overridden). Falls back to today when there's no upcoming home
  // fixture at all, matching the previous default exactly.
  let dateIso = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayIso
  if (!date) {
    const { data: teamRows } = await supabase.from("teams").select("id").eq("club_id", activeContext.id)
    const teamIds = (teamRows ?? []).map((t) => t.id)
    if (teamIds.length > 0) {
      const { data: nextFixture } = await supabase
        .from("fixtures")
        .select("kickoff_date")
        .in("home_team_id", teamIds)
        .gte("kickoff_date", todayIso)
        .neq("status", "Cancelled")
        .order("kickoff_date", { ascending: true })
        .limit(1)
        .maybeSingle()
      if (nextFixture?.kickoff_date) dateIso = nextFixture.kickoff_date
    }
  }

  const board = await getPitchAllocationBoard(supabase, activeContext.id, dateIso)

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 md:px-8 md:py-12">
      <div>
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">{activeContext.label}</p>
        <h1 className="mt-2 font-display text-display-l text-ink">Pitch Allocation</h1>
        <p className="mt-1 text-sm text-ink/55">Home fixtures only -- part of Calendar, not a separate system.</p>
      </div>

      <PitchAllocationBoard clubId={activeContext.id} dateIso={dateIso} initialBoard={board} />
    </div>
  )
}
