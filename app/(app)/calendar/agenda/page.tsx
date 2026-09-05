import { redirect } from "next/navigation"
import Link from "next/link"
import { cookies } from "next/headers"
import { CalendarDays, Dumbbell } from "lucide-react"

import { ACTIVE_CONTEXT_COOKIE, resolveActiveContext, type SwitchableContext } from "@/lib/app-context/active-context"
import { DIAGNOSTIC_SESSION_COOKIE, resolveDiagnosticClub } from "@/lib/app-context/diagnostic-access"
import { getTeamsForActiveContext } from "@/lib/app-context/my-teams"
import { getSessionContext } from "@/lib/app-context/session-context"
import { reconcileOverdueFixtureResults } from "@/lib/app-context/reconcile-results"
import { buildCalendarLanes } from "@/lib/calendar/build-lanes"
import { extendLanesWithReferencedGroups, loadOpponentGroupLabels, resolveMyFixtureSide } from "@/lib/calendar/resolve-entry-participant"
import { qs } from "@/lib/calendar/query-string"
import { miniRugbyGroupLabel } from "@/lib/mini-rugby/group-label"
import { loadTeamIdentitiesForSeason, teamIdentityKey } from "@/lib/mini-rugby/team-identity.server"
import { resolveCalendarSeasonContext } from "@/lib/calendar/season-context"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

import { SeasonPhaseHeader } from "../season-phase-header"
import { TeamFilterBar } from "../team-filter-bar"

const STATUS_STYLES: Record<string, string> = {
  Booked: "bg-mint-100 text-forest-900",
  Confirmed: "bg-mint-100 text-forest-900",
  Planned: "bg-mint-100/60 text-forest-800",
  "To Be Determined": "bg-mint-100/60 text-forest-800",
  Cancelled: "bg-destructive/10 text-destructive",
  Completed: "bg-ink/5 text-ink/50",
}

interface CalendarEntry {
  id: string
  kind: "fixture" | "training"
  date: string
  time: string | null
  title: string
  subtitle: string
  statusLabel: string
  statusClass: string
}

/**
 * Agenda view -- a flat, chronological list, same canonical data AND same
 * shared season/phase/team-filter state as Week/Month (Master Architecture
 * Pass reconciliation: this previously used its own flat "current season /
 * previous seasons" list and overallSeasonRange(), which meant switching
 * Week -> Agenda silently reset the active phase and re-flattened the
 * grouped team filter. Now it calls the exact same
 * resolveCalendarSeasonContext()/buildCalendarLanes()/TeamFilterBar/
 * SeasonPhaseHeader Week and Month use, so all three views agree on one
 * season_id + phase + team filter.
 */
export default async function CalendarAgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; season?: string; phase?: string }>
}) {
  const { team: teamFilter, season: seasonParam, phase: phaseParam } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  await reconcileOverdueFixtureResults(supabase)

  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const diagnosticClub = ctx.isSiteAdmin
    ? await resolveDiagnosticClub(supabase, cookieStore.get(DIAGNOSTIC_SESSION_COOKIE)?.value ?? null)
    : null
  const boardContext: SwitchableContext = diagnosticClub
    ? {
        key: `diagnostic:${diagnosticClub.clubId}`,
        kind: "club",
        id: diagnosticClub.clubId,
        playerId: null,
        label: diagnosticClub.clubName,
        switcherLabel: diagnosticClub.clubName,
        roleLabel: "Site Admin (Diagnostic)",
        logoUrl: diagnosticClub.clubLogoUrl,
        clubId: diagnosticClub.clubId,
      }
    : activeContext

  const scopedTeams = await getTeamsForActiveContext(supabase, ctx, boardContext)
  const teamIds = scopedTeams.map((t) => t.id)

  // ---- Season resolution -- the exact same shared resolver Week/Month
  // call, never a separately reinvented overall-season-range fallback. ----
  let clubRugbyCode: string | null = null
  if (boardContext.kind === "club" && boardContext.id) {
    const { data: club } = await supabase.from("clubs").select("directory_id").eq("id", boardContext.id).maybeSingle()
    if (club) {
      const { data: directory } = await supabase.from("club_directory").select("rugby_code").eq("id", club.directory_id).maybeSingle()
      clubRugbyCode = directory?.rugby_code ?? null
    }
  }
  const { selectedSeason, selectedPhase, range, prevSeason, nextSeason } = await resolveCalendarSeasonContext(
    supabase,
    clubRugbyCode,
    seasonParam,
    phaseParam
  )

  // ---- Lanes: same shared builder Week uses, so the grouped/sorted team
  // filter (Minis + Juniors / Colts / Girls / Women's / Men's) is
  // identical here -- never a flat re-derived chip list. ----
  const { fullLanes: baseLanes, groupIds } = await buildCalendarLanes(supabase, scopedTeams, ctx, boardContext)
  const selectedLane = teamFilter ? (baseLanes.find((l) => l.id === teamFilter) ?? null) : null
  const filterTeamIds = selectedLane ? selectedLane.memberTeamIds : teamIds
  const filterGroupIds = selectedLane ? (selectedLane.kind === "group" ? [selectedLane.id.replace("group:", "")] : []) : groupIds

  // Master Fixture Registry: "mine" means my team on EITHER side (owning
  // or opponent) -- see calendar/page.tsx's own identical comment.
  let fixturesQuery = supabase
    .from("fixtures")
    .select(
      "id, owning_team_id, opponent_team_id, home_team_id, away_team_id, owning_scheduling_group_id, opponent_scheduling_group_id, kickoff_date, kickoff_time, home_away, status, raw_opposition_text, venue_address, season_id, teams!fixtures_owning_team_id_fkey(display_name)"
    )
    .or(
      filterTeamIds.length > 0
        ? `owning_team_id.in.(${filterTeamIds.join(",")}),opponent_team_id.in.(${filterTeamIds.join(",")})`
        : "owning_team_id.eq.00000000-0000-0000-0000-000000000000"
    )
    .order("kickoff_date", { ascending: true })
  if (range) fixturesQuery = fixturesQuery.gte("kickoff_date", range.start).lte("kickoff_date", range.end)
  const { data: fixtures } = filterTeamIds.length > 0 ? await fixturesQuery : { data: [] }

  // Same canonical side/group resolution Week and Month use (Section 2/20:
  // one shared layer, never a second inline copy) -- previously Agenda
  // duplicated this "iAmOpponent" logic itself and never resolved a group
  // identity at all, so a group fixture's title here always showed the
  // single anchor team's name, never its real group label.
  const mySides = (fixtures ?? []).map((f) => resolveMyFixtureSide(f, teamIds))
  const { lanes: fullLanes, groupLabelById } = await extendLanesWithReferencedGroups(
    supabase,
    baseLanes,
    mySides.map((s) => s.myGroupId),
    false,
    new Set<string>()
  )
  const opponentGroupLabelById = await loadOpponentGroupLabels(
    supabase,
    (fixtures ?? []).map((f, i) => (mySides[i].iAmOpponent ? f.owning_scheduling_group_id : f.opponent_scheduling_group_id))
  )

  let trainingQuery = supabase
    .from("training_sessions")
    .select("id, session_date, start_time, pitch_id, notes, teams(display_name), scheduling_groups(display_tag, alias), club_pitches(display_name)")
    .is("cancelled_at", null)
    .order("session_date", { ascending: true })
  if (range) trainingQuery = trainingQuery.gte("session_date", range.start).lte("session_date", range.end)
  const { data: training } =
    filterTeamIds.length > 0 || filterGroupIds.length > 0
      ? await trainingQuery.or(
          [filterTeamIds.length > 0 ? `team_id.in.(${filterTeamIds.join(",")})` : null, filterGroupIds.length > 0 ? `scheduling_group_id.in.(${filterGroupIds.join(",")})` : null]
            .filter(Boolean)
            .join(",")
        )
      : { data: [] }

  // FUTURE-SEASON FIXTURE OWNERSHIP: a fixture's age-grade display must
  // resolve for the FIXTURE'S OWN season, never a team's current
  // mutable row -- otherwise a past fixture silently relabels itself
  // the moment that team rolls forward. season_id is null only for
  // legacy fixtures predating that column; those fall back to the live
  // join below exactly as before.
  const identityPairs = (fixtures ?? []).flatMap((f) =>
    f.season_id
      ? [{ teamId: f.owning_team_id, seasonId: f.season_id }, ...(f.opponent_team_id ? [{ teamId: f.opponent_team_id, seasonId: f.season_id }] : [])]
      : []
  )
  const teamIdentities = await loadTeamIdentitiesForSeason(supabase, identityPairs)

  const entries: CalendarEntry[] = [
    ...(fixtures ?? []).map((f, i) => {
      const { myTeamId, myGroupId, iAmOpponent } = mySides[i]
      const owningTeamLabel = (f.season_id && teamIdentities.get(teamIdentityKey(f.owning_team_id, f.season_id))?.displayName) || f.teams?.display_name || "Team"
      const opponentTeamLabel =
        (f.opponent_team_id && f.season_id && teamIdentities.get(teamIdentityKey(f.opponent_team_id, f.season_id))?.displayName) ||
        scopedTeams.find((t) => t.id === f.opponent_team_id)?.displayName ||
        "Team"
      // Display identity (Section 11): a group fixture always shows its
      // real group label, never flattened to whichever single component
      // team is currently filtered.
      const myTeamName = myGroupId ? (groupLabelById.get(myGroupId) ?? (iAmOpponent ? opponentTeamLabel : owningTeamLabel)) : iAmOpponent ? opponentTeamLabel : owningTeamLabel
      const theirGroupId = iAmOpponent ? f.owning_scheduling_group_id : f.opponent_scheduling_group_id
      const theirLabel = theirGroupId
        ? (opponentGroupLabelById.get(theirGroupId) ?? (iAmOpponent ? owningTeamLabel : opponentTeamLabel))
        : iAmOpponent
          ? owningTeamLabel
          : opponentTeamLabel
      const opposition = iAmOpponent ? theirLabel : theirGroupId ? theirLabel : f.raw_opposition_text
      const homeAway = f.home_team_id === myTeamId ? "Home" : f.away_team_id === myTeamId ? "Away" : f.home_away
      return {
        id: f.id,
        kind: "fixture" as const,
        date: f.kickoff_date,
        time: f.kickoff_time,
        title: `${myTeamName} vs ${opposition}`,
        subtitle: [homeAway, f.venue_address].filter(Boolean).join(" · "),
        statusLabel: f.status,
        statusClass: STATUS_STYLES[f.status] ?? "bg-ink/5 text-ink/60",
      }
    }),
    ...(training ?? []).map((t) => ({
      id: t.id,
      kind: "training" as const,
      date: t.session_date,
      time: t.start_time,
      title: `${t.teams?.display_name ?? (t.scheduling_groups?.display_tag ? miniRugbyGroupLabel({ displayTag: t.scheduling_groups.display_tag, alias: t.scheduling_groups.alias }) : "Training")} training`,
      subtitle: [t.club_pitches?.display_name, t.notes].filter(Boolean).join(" · "),
      statusLabel: "Training",
      statusClass: "bg-forest-800/10 text-forest-900",
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""))

  const grouped = new Map<string, CalendarEntry[]>()
  for (const e of entries) {
    const monthKey = new Date(e.date + "T00:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    grouped.set(monthKey, [...(grouped.get(monthKey) ?? []), e])
  }

  const baseParams = { team: teamFilter ?? null, season: seasonParam ?? null, phase: phaseParam ?? null }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">{boardContext.label}</p>
          <h1 className="mt-2 font-display text-display-l text-ink">Agenda</h1>
        </div>
        <Link href={`/calendar${qs(baseParams)}`} className="text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
          Back to Week view
        </Link>
      </div>

      <SeasonPhaseHeader
        basePath="/calendar/agenda"
        baseParams={baseParams}
        selectedSeason={selectedSeason}
        selectedPhase={selectedPhase}
        prevSeason={prevSeason}
        nextSeason={nextSeason}
      />

      <TeamFilterBar lanes={fullLanes} activeTeam={teamFilter ?? null} baseParams={baseParams} />

      {grouped.size === 0 ? (
        <div className="mt-8 flex flex-col items-start gap-3 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8">
          <CalendarDays className="size-5 text-ink/30" />
          <div>
            <p className="text-sm font-medium text-ink">No fixtures yet</p>
            <p className="mt-1 text-sm text-ink/55">Fixtures and training for your team(s) will appear here once scheduled.</p>
          </div>
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-8">
          {Array.from(grouped.entries()).map(([month, monthEntries]) => (
            <section key={month}>
              <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">{month}</h2>
              <ul className="mt-3 flex flex-col gap-2">
                {monthEntries.map((e) => {
                  const date = new Date(e.date + "T00:00:00")
                  return (
                    <li key={`${e.kind}-${e.id}`} className="flex flex-wrap items-center gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5">
                      <div className="w-24 shrink-0">
                        <p className="text-sm font-medium text-ink">
                          {date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                        </p>
                        {e.time && <p className="text-xs text-ink/45">{e.time.slice(0, 5)}</p>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 truncate text-sm font-medium text-ink">
                          {e.kind === "training" && <Dumbbell className="size-3.5 shrink-0 text-forest-800/60" />}
                          {e.title}
                        </p>
                        {e.subtitle && <p className="text-xs text-ink/50">{e.subtitle}</p>}
                      </div>
                      <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-medium", e.statusClass)}>{e.statusLabel}</span>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
