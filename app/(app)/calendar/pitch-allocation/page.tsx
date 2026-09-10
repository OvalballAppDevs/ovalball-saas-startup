import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, resolveActiveContext } from "@/lib/app-context/active-context"
import { DIAGNOSTIC_SESSION_COOKIE, resolveDiagnosticClub } from "@/lib/app-context/diagnostic-access"
import { getTeamsForActiveContext } from "@/lib/app-context/my-teams"
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

  // ---- WHOSE PITCHES THESE ARE.
  //
  // PRESENTATION CONTEXT IS NOT AUTHORISATION. This used to require
  // `activeContext.kind === "club"`, which meant a team admin -- or a club
  // admin who happened to be looking at one of their teams -- was bounced to
  // /calendar from a board they are entitled to read, and had to go and
  // switch their context by hand to see it. The club is a fact about the
  // pitches; the context is a fact about what the person is currently
  // looking at, and only the first of those decides anything here.
  //
  // So the club is resolved from the viewer's own scope, and the CAPABILITY
  // decides what happens next.
  // A SITE ADMIN HAS NO CLUB OF THEIR OWN, and must never be shown an
  // arbitrary one. The product already has the canonical answer for "which
  // club is a platform admin currently looking at" -- the diagnostic session
  // Calendar itself reads -- so this honours the same mechanism rather than
  // inventing a second one or guessing. Without it a Site Admin is sent back
  // to Calendar, which is the correct outcome: they have not said which club.
  const diagnosticClub = ctx.isSiteAdmin
    ? await resolveDiagnosticClub(supabase, cookieStore.get(DIAGNOSTIC_SESSION_COOKIE)?.value ?? null)
    : null

  let clubId = diagnosticClub?.clubId ?? (activeContext.kind === "club" ? activeContext.id : null)
  if (!clubId) {
    const scoped = await getTeamsForActiveContext(supabase, ctx, activeContext)
    const teamIds = scoped.map((t) => t.id)
    if (teamIds.length > 0) {
      const { data: teamClubs } = await supabase.from("teams").select("club_id").in("id", teamIds)
      const clubIds = new Set((teamClubs ?? []).map((t) => t.club_id).filter((c): c is string => Boolean(c)))
      // One club is every real viewer. A person spanning two clubs has no
      // single pitch board, and picking one would assert something false
      // about the other.
      if (clubIds.size === 1) clubId = [...clubIds][0]
    }
  }
  if (!clubId) redirect("/calendar")

  // ---- VIEWING AND MANAGING ARE TWO DIFFERENT PERMISSIONS.
  //
  // `calendar.view` at club or team scope is enough to READ the board: who is
  // on which pitch and when is ordinary club operational information, and a
  // team admin planning their Saturday needs it.
  //
  // `fixture.edit` at CLUB scope is what allows MOVING anything. A team-scoped
  // grant deliberately does not satisfy it -- reallocating a pitch reorders
  // other teams' afternoons, which is not one team's decision. Nobody is
  // granted a capability here merely to make the board open.
  const [canViewClub, canViewTeam, canManage] = await Promise.all([
    hasCapability(supabase, "calendar.view", "club", { clubId }),
    activeContext.kind === "team" && activeContext.id
      ? hasCapability(supabase, "calendar.view", "team", { clubId, teamId: activeContext.id })
      : Promise.resolve(false),
    hasCapability(supabase, "fixture.edit", "club", { clubId }),
  ])
  if (!ctx.isSiteAdmin && !canViewClub && !canViewTeam && !canManage) redirect("/calendar")

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
    const { data: teamRows } = await supabase.from("teams").select("id").eq("club_id", clubId)
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

  const board = await getPitchAllocationBoard(supabase, clubId, dateIso)

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 md:px-8 md:py-12">
      <div>
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">{activeContext.label}</p>
        <h1 className="mt-2 font-display text-display-l text-ink">Pitch Allocation</h1>
        <p className="mt-1 max-w-xl text-sm text-ink-muted">Every home fixture, training session and club event using a pitch on this day, including the warm-up and pack-up time each one reserves.</p>
      </div>

      <PitchAllocationBoard clubId={clubId} dateIso={dateIso} initialBoard={board} canManage={canManage} />
    </div>
  )
}
