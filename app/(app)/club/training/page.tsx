import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"
import { fullTeamLabel } from "@/lib/teams/compact-label"

import { getTrainingExceptions } from "./exceptions"
import { TrainingManagementClient, type PlanRow, type PitchOption, type SeasonOption, type TeamOption, type UpcomingSession, type VenueOption } from "./training-management-client"

/**
 * SIDE PROJECT 2 -- TRAINING MANAGEMENT landing page (Section 5-6).
 * Gated on club.training.manage (Club-Admin-only, Section 44) -- the same
 * pattern as the Pitch Allocation Settings page (requireTrainingManageAccess
 * in actions.ts re-checks this again on every mutation; this redirect is
 * the read-side UX gate).
 */
export default async function TrainingManagementPage({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const { team: teamFilter } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const clubId = activeClubId(ctx, activeContext)

  const canManage = clubId ? await hasCapability(supabase, "club.training.manage", "club", { clubId }) : false
  if (!clubId || !canManage) redirect("/dashboard")

  const clubName = activeContext.kind === "club" ? activeContext.label : "Club"

  const { data: club } = await supabase.from("clubs").select("directory_id").eq("id", clubId).maybeSingle()
  const { data: directory } = club ? await supabase.from("club_directory").select("rugby_code").eq("id", club.directory_id).maybeSingle() : { data: null }
  const rugbyCode = (directory?.rugby_code as "union" | "league" | null) ?? null

  const [{ data: overviewRows }, { data: teamRows }, { data: venueRows }, { data: pitchRows }, { data: seasonRows }, { data: planRows }] = await Promise.all([
    supabase.rpc("get_training_management_overview", { p_club_id: clubId }),
    supabase.from("teams").select("id, display_name, category, age_group, gender, squad_designation").eq("club_id", clubId).eq("active", true).order("display_name"),
    supabase.from("venues").select("id, name, active").or(`club_id.eq.${clubId},club_id.is.null`).eq("active", true).order("name"),
    supabase.from("club_pitches").select("id, display_name, venue_id, active").eq("club_id", clubId).eq("active", true).order("sort_order"),
    rugbyCode ? supabase.from("seasons").select("id, name, rugby_code, active").eq("rugby_code", rugbyCode).order("starts_on", { ascending: false }) : Promise.resolve({ data: [] }),
    supabase
      .from("training_plans")
      .select("id, team_id, season_id, schedule_mode, preferred_venue_id, preferred_pitch_id, status, needs_attention_reason, teams(display_name, category, age_group, gender, squad_designation), venues(name), club_pitches(display_name), training_plan_schedule_rules(id, weekday, start_time, duration_minutes, starts_on, ends_on)")
      .eq("club_id", clubId)
      .order("created_at", { ascending: false }),
  ])

  const overview = (overviewRows as { active_plan_count: number; teams_without_plan_count: number; upcoming_session_count: number; needs_attention_plan_count: number }[] | null)?.[0] ?? {
    active_plan_count: 0,
    teams_without_plan_count: 0,
    upcoming_session_count: 0,
    needs_attention_plan_count: 0,
  }

  const teamIdsWithAnyPlan = new Set((planRows ?? []).filter((p) => p.status !== "INACTIVE").map((p) => p.team_id))

  const teams: TeamOption[] = (teamRows ?? []).map((t) => ({
    id: t.id,
    label: fullTeamLabel({ category: t.category as "senior" | "youth" | "colts", ageGroup: t.age_group, gender: t.gender, squadDesignation: t.squad_designation }),
  }))
  const venues: VenueOption[] = (venueRows ?? []).map((v) => ({ id: v.id, name: v.name }))
  const pitches: PitchOption[] = (pitchRows ?? []).map((p) => ({ id: p.id, displayName: p.display_name, venueId: p.venue_id }))
  const seasons: SeasonOption[] = (seasonRows ?? []).map((s) => ({ id: s.id, name: s.name }))
  const plans: PlanRow[] = (planRows ?? []).map((p) => ({
    id: p.id,
    teamId: p.team_id,
    teamLabel: p.teams ? fullTeamLabel({ category: p.teams.category as "senior" | "youth" | "colts", ageGroup: p.teams.age_group, gender: p.teams.gender, squadDesignation: p.teams.squad_designation }) : "Unknown team",
    seasonId: p.season_id,
    scheduleMode: p.schedule_mode as "SEASON" | "SEASON_PRE_SEASON" | "CUSTOM",
    venueId: p.preferred_venue_id,
    venueName: p.venues?.name ?? "--",
    pitchId: p.preferred_pitch_id,
    pitchName: p.club_pitches?.display_name ?? "--",
    status: p.status as "ACTIVE" | "INACTIVE" | "NEEDS_ATTENTION",
    needsAttentionReason: p.needs_attention_reason,
    rules: (p.training_plan_schedule_rules ?? []).map((r) => ({
      id: r.id,
      weekday: r.weekday,
      startTime: r.start_time,
      durationMinutes: r.duration_minutes,
      startsOn: r.starts_on,
      endsOn: r.ends_on,
    })),
  }))
  const teamsWithoutPlan = teams.filter((t) => !teamIdsWithAnyPlan.has(t.id))

  // Section 53: Upcoming Sessions -- a genuine near-term window (next 14
  // days), not just a row cap -- a bare row-count limit on a weekly
  // recurring plan degenerates into "every Monday until May" (real gap
  // found live in this pass's own browser verification), which is not a
  // useful "upcoming" view even though every row is technically in the
  // future. Optionally scoped to one team via ?team=<id> (a plain
  // server-rendered filter, no client state needed). Deliberately
  // excludes cancelled sessions and never loads historical training by
  // default. The 200-row limit is a genuine safety cap, not the intended
  // bound -- fourteen days of even several teams' daily training will
  // never realistically approach it.
  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)
  const upcomingWindowEnd = new Date(today)
  upcomingWindowEnd.setDate(upcomingWindowEnd.getDate() + 14)
  const upcomingWindowEndIso = upcomingWindowEnd.toISOString().slice(0, 10)
  let upcomingQuery = supabase
    .from("training_sessions")
    .select("id, team_id, occurrence_date, start_time, duration_minutes, status, source, teams(display_name, category, age_group, gender, squad_designation), club_pitches(display_name), venues(name)")
    .eq("club_id", clubId)
    .neq("status", "CANCELLED")
    .gte("occurrence_date", todayIso)
    .lte("occurrence_date", upcomingWindowEndIso)
    .order("occurrence_date", { ascending: true })
    .order("start_time", { ascending: true })
    .limit(200)
  if (teamFilter) upcomingQuery = upcomingQuery.eq("team_id", teamFilter)
  const { data: upcomingRows } = await upcomingQuery

  const upcomingSessions: UpcomingSession[] = (upcomingRows ?? []).map((s) => ({
    id: s.id,
    teamLabel: s.teams ? fullTeamLabel({ category: s.teams.category as "senior" | "youth" | "colts", ageGroup: s.teams.age_group, gender: s.teams.gender, squadDesignation: s.teams.squad_designation }) : "Team",
    date: s.occurrence_date ?? "",
    startTime: s.start_time,
    durationMinutes: s.duration_minutes,
    pitchName: s.club_pitches?.display_name ?? "Not set",
    venueName: s.venues?.name ?? "Not set",
    source: s.source as "MANUAL" | "AUTOMATIC_PLAN",
  }))

  const exceptions = await getTrainingExceptions(supabase, clubId)

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Club Admin</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Training Management</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink/55">
        Recurring and one-off training for every active team at {clubName}. Automatic Training Booking keeps each team&apos;s planned sessions generated and visible on the Calendar and Pitch
        Allocation -- Calendar&apos;s own manual &quot;Schedule training&quot; still works exactly as before for one-off sessions.
      </p>

      <TrainingManagementClient
        clubId={clubId}
        overview={overview}
        teams={teams}
        teamsWithoutPlan={teamsWithoutPlan}
        venues={venues}
        pitches={pitches}
        seasons={seasons}
        plans={plans}
        upcomingSessions={upcomingSessions}
        upcomingTeamFilter={teamFilter ?? null}
        exceptions={exceptions}
      />
    </div>
  )
}
