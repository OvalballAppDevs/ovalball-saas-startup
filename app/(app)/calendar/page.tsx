import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext, type SwitchableContext } from "@/lib/app-context/active-context"
import { DIAGNOSTIC_SESSION_COOKIE, resolveDiagnosticClub } from "@/lib/app-context/diagnostic-access"
import { getTeamsForActiveContext } from "@/lib/app-context/my-teams"
import { getSessionContext } from "@/lib/app-context/session-context"
import { reconcileOverdueFixtureResults } from "@/lib/app-context/reconcile-results"
import { resolveCalendarSeasonContext, clampIsoToRange } from "@/lib/calendar/season-context"
import { buildCalendarLanes } from "@/lib/calendar/build-lanes"
import { extendLanesWithReferencedGroups, loadOpponentGroupLabels, resolveMyFixtureSide } from "@/lib/calendar/resolve-entry-participant"
import { miniRugbyGroupLabel } from "@/lib/mini-rugby/group-label"
import { loadTeamIdentitiesForSeason, teamIdentityKey } from "@/lib/mini-rugby/team-identity.server"
import { hasCapability } from "@/lib/permissions/has-capability"
import { compactTeamLabel } from "@/lib/teams/compact-label"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

import type { CompetitionOption } from "./create-fixture-dialog"
import { FilterSheet } from "./filter-sheet"
import { MobileAgenda } from "./mobile-agenda"
import { MonthView } from "./month-view"
import { ScheduleTrainingDialog, type PitchOption, type TrainingTargetOption } from "./schedule-training-dialog"
import { SeasonPhaseHeader } from "./season-phase-header"
import { TeamFilterBar } from "./team-filter-bar"
import { qs } from "@/lib/calendar/query-string"
import { WeekBoard, type TournamentParticipantView, type WeekEntry } from "./week-board"

/**
 * Calendar Core -- a VIEW over canonical fixtures/training_sessions/
 * teams/scheduling_groups/seasons, never a second editable calendar store
 * (every mutation still goes through the existing fixture/training RPCs
 * and RLS this page only reads from). Season-first: the header reads the
 * EXISTING canonical seasons table (starts_on/pre_season_starts_on/
 * ends_on) for its "26/27 Pre-Season"/"26/27 Season" period, never a
 * separately invented frontend date model. Team-lanes layout for Week:
 * teams as sticky rows, days as columns -- an operations board, not a
 * generic date-grid calendar.
 */

const STATUS_STYLES: Record<string, string> = {
  Booked: "bg-mint-100 text-forest-900 border-mint-300",
  Confirmed: "bg-mint-100 text-forest-900 border-mint-300",
  Planned: "bg-amber-50 text-amber-900 border-amber-300",
  "To Be Determined": "bg-amber-50 text-amber-900 border-amber-300",
  Cancelled: "bg-destructive/10 text-destructive border-destructive/30",
  Completed: "bg-ink/5 text-ink/60 border-ink/15",
}
const ACTIONABLE_STATUSES = new Set(["Planned", "To Be Determined"])

function startOfWeek(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day // Monday start
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}
// Local-date formatting, deliberately never .toISOString() -- that
// converts to UTC first, which silently shifts every date back a day for
// any viewer west of UTC.
function toIso(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}
function addDays(d: Date, n: number): Date {
  const date = new Date(d)
  date.setDate(date.getDate() + n)
  return date
}
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{
    week?: string
    month?: string
    team?: string
    view?: string
    season?: string
    phase?: string
    status?: string | string[]
    ha?: string
    kind?: string
  }>
}) {
  const { week: weekParam, month: monthParam, team: teamFilter, view: viewParam, season: seasonParam, phase: phaseParam, status, ha, kind } = await searchParams
  const statusFilters = status ? (Array.isArray(status) ? status : [status]) : []
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

  // ---- Season resolution -- one shared resolver Week/Month/Agenda all
  // call (lib/calendar/season-context.ts), so switching between views
  // never silently resets or reinterprets the active season/phase. -------
  let clubRugbyCode: string | null = null
  if (boardContext.kind === "club" && boardContext.id) {
    const { data: club } = await supabase.from("clubs").select("directory_id").eq("id", boardContext.id).maybeSingle()
    if (club) {
      const { data: directory } = await supabase.from("club_directory").select("rugby_code").eq("id", club.directory_id).maybeSingle()
      clubRugbyCode = directory?.rugby_code ?? null
    }
  }
  const {
    selectedSeason,
    selectedPhase,
    range,
    seasonConfigBroken,
    isExplicitPeriodSwitch,
    prevSeason,
    nextSeason,
  } = await resolveCalendarSeasonContext(supabase, clubRugbyCode, seasonParam, phaseParam)

  const view = viewParam === "month" ? "month" : "week"

  // ---- Date range for the active view -- bounded, never the whole season. ----
  const todayIso = toIso(new Date())
  let rangeStart: Date
  let rangeEnd: Date
  let gridDays: string[] = []
  let weekDays: Date[] = []
  let monthAnchor: Date = new Date(`${todayIso}T00:00:00`)
  if (view === "week") {
    const rawWeekAnchor = weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam) ? weekParam : isExplicitPeriodSwitch ? (range?.start ?? todayIso) : todayIso
    // Bounds apply to every anchor source alike -- a query-string-crafted
    // ?week= is clamped exactly like a real click would be, so there is no
    // way to reach an out-of-range anchor by hand-editing the URL either
    // (Section 3: "Do not solve this by UI-only restriction").
    const weekAnchorSource = range ? clampIsoToRange(rawWeekAnchor, range) : rawWeekAnchor
    const anchor = new Date(`${weekAnchorSource}T00:00:00`)
    const weekStart = startOfWeek(anchor)
    weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    rangeStart = weekStart
    rangeEnd = addDays(weekStart, 6)
  } else {
    const rawMonthAnchor = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? `${monthParam}-01` : isExplicitPeriodSwitch ? (range?.start ?? todayIso) : todayIso
    const monthAnchorSource = range ? clampIsoToRange(rawMonthAnchor, range) : rawMonthAnchor
    const monthStart = new Date(`${monthAnchorSource}T00:00:00`)
    monthStart.setDate(1)
    monthAnchor = monthStart
    const gridStart = startOfWeek(monthStart)
    gridDays = Array.from({ length: 42 }, (_, i) => toIso(addDays(gridStart, i)))
    rangeStart = gridStart
    rangeEnd = addDays(gridStart, 41)
  }
  const startIso = toIso(rangeStart)
  const endIso = toIso(rangeEnd)

  // ---- Lanes: one shared builder Week and Agenda both call
  // (lib/calendar/build-lanes.ts) -- one lane per active scheduling group
  // among the scoped teams (member teams' commitments roll up into ONE
  // lane, never duplicated per component team), then one per remaining
  // team, plus edit/create authority scoped to the ACTIVE context (a
  // Coach assigned only U12 sees a "+" affordance on the U12 lane, not
  // U14; the old canManageClubFixturesAnywhere(ctx) leaked "+" onto every
  // lane for a multi-role account switched into Parent View). ----
  const activeManageableClubEarly = activeManageableClubId(ctx, boardContext)
  const {
    fullLanes: baseLanes,
    groupIds,
    hasClubFixtureAuthority: hasClubFixtureAuthorityEarly,
    manageableTeamIds: manageableTeamIdsEarly,
  } = await buildCalendarLanes(supabase, scopedTeams, ctx, boardContext)

  // Master Fixture Registry: a fixture between two Ovalball teams is ONE
  // row, so "mine" means MY team on EITHER side (owning_team_id, the
  // creating/requesting side, or opponent_team_id, the responding side)
  // -- never just owning_team_id, or half of this club's own confirmed
  // fixtures (every one where this club responded rather than created)
  // would silently vanish from its own Calendar.
  const fixtureOrClauses = [
    teamIds.length > 0 ? `owning_team_id.in.(${teamIds.join(",")})` : null,
    teamIds.length > 0 ? `opponent_team_id.in.(${teamIds.join(",")})` : null,
    groupIds.length > 0 ? `owning_scheduling_group_id.in.(${groupIds.join(",")})` : null,
    groupIds.length > 0 ? `opponent_scheduling_group_id.in.(${groupIds.join(",")})` : null,
  ].filter((c): c is string => Boolean(c))
  let fixturesQuery = supabase
    .from("fixtures")
    .select(
      "id, owning_team_id, opponent_team_id, opponent_directory_id, home_team_id, away_team_id, owning_scheduling_group_id, opponent_scheduling_group_id, kickoff_date, kickoff_time, home_away, status, raw_opposition_text, venue_address, home_score, away_score, result_status, pitch_id, competition_edition_id, notes, season_id, teams!fixtures_owning_team_id_fkey(display_name)"
    )
    .or(fixtureOrClauses.length > 0 ? fixtureOrClauses.join(",") : "owning_team_id.eq.00000000-0000-0000-0000-000000000000")
    .gte("kickoff_date", startIso)
    .lte("kickoff_date", endIso)
    .order("kickoff_date", { ascending: true })
  if (statusFilters.length > 0) fixturesQuery = fixturesQuery.in("status", statusFilters)
  if (ha === "home") fixturesQuery = fixturesQuery.eq("home_away", "Home")
  if (ha === "away") fixturesQuery = fixturesQuery.eq("home_away", "Away")
  const { data: fixtures } = kind === "training" ? { data: [] } : await fixturesQuery

  const fixturePitchIds = Array.from(new Set((fixtures ?? []).map((f) => f.pitch_id).filter((id): id is string => Boolean(id))))
  const { data: fixturePitches } =
    fixturePitchIds.length > 0 ? await supabase.from("club_pitches").select("id, display_name").in("id", fixturePitchIds) : { data: [] }
  const fixturePitchNameById = new Map((fixturePitches ?? []).map((p) => [p.id, p.display_name]))

  // FUTURE-SEASON FIXTURE OWNERSHIP: resolve each fixture's team labels
  // for THAT FIXTURE'S OWN season_id, never the team's current mutable
  // row -- see lib/mini-rugby/team-identity.server.ts. Legacy fixtures
  // with no season_id fall back to the live join exactly as before.
  const fixtureIdentityPairs = (fixtures ?? []).flatMap((f) =>
    f.season_id
      ? [{ teamId: f.owning_team_id, seasonId: f.season_id }, ...(f.opponent_team_id ? [{ teamId: f.opponent_team_id, seasonId: f.season_id }] : [])]
      : []
  )
  const fixtureTeamIdentities = await loadTeamIdentitiesForSeason(supabase, fixtureIdentityPairs)

  const trainingOrClauses = [
    teamIds.length > 0 ? `team_id.in.(${teamIds.join(",")})` : null,
    groupIds.length > 0 ? `scheduling_group_id.in.(${groupIds.join(",")})` : null,
  ].filter((c): c is string => Boolean(c))
  const { data: training } =
    kind === "fixture"
      ? { data: [] }
      : await supabase
          .from("training_sessions")
          .select("id, team_id, scheduling_group_id, session_date, start_time, notes, club_pitches(display_name)")
          .is("cancelled_at", null)
          .or(trainingOrClauses.length > 0 ? trainingOrClauses.join(",") : "team_id.eq.00000000-0000-0000-0000-000000000000")
          .gte("session_date", startIso)
          .lte("session_date", endIso)

  // Competition Directory dropdown -- active editions matching this
  // club's own rugby_code only (Section AO: never offer a Union edition
  // for a League club). Empty array (not an error) when the club has no
  // rugby_code resolved yet or no active editions exist.
  let competitionOptions: CompetitionOption[] = []
  if (clubRugbyCode) {
    const { data: editions } = await supabase
      .from("competition_editions")
      .select("id, competitions!inner(name, rugby_code, active)")
      .eq("active", true)
      .eq("rugby_code", clubRugbyCode)
      .eq("competitions.active", true)
    competitionOptions = (editions ?? []).map((e) => ({ id: e.id, label: e.competitions?.name ?? "Competition" }))
  }

  // Tournaments -- club_visible_tournaments already scopes to host-always /
  // participant-only-once-accepted (Section CF); this Calendar just needs
  // to know which of THIS club's lanes each visible tournament belongs to.
  const { data: tournamentRows } = await supabase
    .from("club_visible_tournaments")
    .select("id, host_club_id, host_team_id, host_directory_id, event_date, kickoff_time, pitch_id, venue_id, status")
    .gte("event_date", startIso)
    .lte("event_date", endIso)
  const tournamentIds = (tournamentRows ?? []).map((t) => t.id).filter((id): id is string => Boolean(id))
  const hostDirectoryIds = Array.from(new Set((tournamentRows ?? []).map((t) => t.host_directory_id).filter((id): id is string => Boolean(id))))
  const { data: tournamentHostDirectories } = hostDirectoryIds.length > 0 ? await supabase.from("club_directory").select("id, name").in("id", hostDirectoryIds) : { data: [] }
  const hostDirectoryNameById = new Map((tournamentHostDirectories ?? []).map((d) => [d.id, d.name]))
  // Tournament venue display: tournaments.venue_id points at the same
  // structured venues table fixture creation already uses -- resolve name
  // + address for whichever venues are actually referenced, reusing
  // WeekEntry.venueAddress (the same field an ordinary fixture's Google
  // Maps "Directions" link already reads) rather than a second field.
  const tournamentVenueIds = Array.from(new Set((tournamentRows ?? []).map((t) => t.venue_id).filter((id): id is string => Boolean(id))))
  const { data: tournamentVenueRows } = tournamentVenueIds.length > 0 ? await supabase.from("venues").select("id, name, address").in("id", tournamentVenueIds) : { data: [] }
  const tournamentVenueById = new Map((tournamentVenueRows ?? []).map((v) => [v.id, v]))
  const { data: tournamentParticipantRows } =
    tournamentIds.length > 0
      ? await supabase
          .from("tournament_participants")
          .select("id, tournament_id, club_directory_id, team_id, status, canonical_team_types(label)")
          .in("tournament_id", tournamentIds)
      : { data: [] }
  const participantDirectoryIds = Array.from(new Set((tournamentParticipantRows ?? []).map((p) => p.club_directory_id)))
  const { data: participantDirectories } =
    participantDirectoryIds.length > 0 ? await supabase.from("club_directory").select("id, name").in("id", participantDirectoryIds) : { data: [] }
  const directoryNameById = new Map((participantDirectories ?? []).map((d) => [d.id, d.name]))
  const participantsByTournamentId = new Map<string, TournamentParticipantView[]>()
  for (const p of tournamentParticipantRows ?? []) {
    const list = participantsByTournamentId.get(p.tournament_id) ?? []
    list.push({
      clubName: directoryNameById.get(p.club_directory_id) ?? "Club",
      teamTypeLabel: p.canonical_team_types?.label ?? "",
      status: p.status as TournamentParticipantView["status"],
      participantId: p.id,
    })
    participantsByTournamentId.set(p.tournament_id, list)
  }

  // Canonical, side-preserving participant resolution (Calendar
  // component-filtering pass): which side of a fixture row is mine, and
  // that side's OWN stored Mini-Rugby Group id, is resolved by ONE shared
  // function -- never inferred from a club's current live group
  // membership. baseLanes (buildCalendarLanes) reflects that live
  // membership; extendLanesWithReferencedGroups adds a real lane for any
  // group actually referenced on a fixture/training row that isn't
  // already covered (a structurally-overlapping second group, or a group
  // a team has since left) -- so a real fixture never fails to render or
  // be filterable just because a team's CURRENT group differs from the
  // group it actually played this fixture with.
  const mySides = (fixtures ?? []).map((f) => resolveMyFixtureSide(f, teamIds))
  const referencedGroupIds = [...mySides.map((s) => s.myGroupId), ...(training ?? []).map((t) => t.scheduling_group_id)]
  const { lanes: fullLanes, groupLabelById } = await extendLanesWithReferencedGroups(
    supabase,
    baseLanes,
    referencedGroupIds,
    hasClubFixtureAuthorityEarly,
    manageableTeamIdsEarly
  )
  const opponentGroupLabelById = await loadOpponentGroupLabels(
    supabase,
    (fixtures ?? []).map((f, i) => (mySides[i].iAmOpponent ? f.owning_scheduling_group_id : f.opponent_scheduling_group_id))
  )

  function laneIdFor(teamId: string | null, groupId: string | null): string | null {
    if (groupId) return `group:${groupId}`
    if (teamId) return `team:${teamId}`
    return null
  }

  const entries: WeekEntry[] = []
  for (const [i, f] of (fixtures ?? []).entries()) {
    // Master Fixture Registry: this ONE row is viewed from whichever side
    // is actually mine -- when my team is the opponent (I responded to
    // the request, never created it), everything the owning side's own
    // perspective wrote (raw_opposition_text, home_away) is describing
    // ME, not my opponent, and must be read/inverted accordingly. The
    // generated home_team_id/away_team_id pair make "am I home or away"
    // unambiguous regardless of which side created the row.
    const { myTeamId, myGroupId, iAmOpponent } = mySides[i]
    const laneId = laneIdFor(myTeamId, myGroupId)
    if (!laneId) continue
    if (teamFilter && laneId !== teamFilter) continue
    const homeAway = f.home_team_id === myTeamId ? "Home" : f.away_team_id === myTeamId ? "Away" : f.home_away
    // Display identity (Section 11): the ACTUAL participant, never
    // flattened by the active filter -- a group fixture always shows its
    // group's label (alias-aware), regardless of which single component
    // team the URL happens to be filtered to.
    const owningTeamLabel = (f.season_id && fixtureTeamIdentities.get(teamIdentityKey(f.owning_team_id, f.season_id))?.displayName) || f.teams?.display_name || "Team"
    const opponentTeamLabel = (f.opponent_team_id && f.season_id && fixtureTeamIdentities.get(teamIdentityKey(f.opponent_team_id, f.season_id))?.displayName) || "Team"
    const myLabel = myGroupId ? (groupLabelById.get(myGroupId) ?? (iAmOpponent ? opponentTeamLabel : owningTeamLabel)) : iAmOpponent ? opponentTeamLabel : owningTeamLabel
    const theirGroupId = iAmOpponent ? f.owning_scheduling_group_id : f.opponent_scheduling_group_id
    const theirLabel = theirGroupId
      ? (opponentGroupLabelById.get(theirGroupId) ?? (iAmOpponent ? owningTeamLabel : opponentTeamLabel))
      : iAmOpponent
        ? owningTeamLabel
        : opponentTeamLabel
    // Ordinary team-vs-team opposition text is unchanged (raw_opposition_
    // text, exactly as before this pass) -- only when the opponent side
    // is genuinely a Mini-Rugby Group do we prefer its real structured
    // label over the generic free text captured at request time.
    const opposition = iAmOpponent ? theirLabel : theirGroupId ? theirLabel : f.raw_opposition_text
    const canEdit = hasClubFixtureAuthorityEarly || (myTeamId !== null && manageableTeamIdsEarly.has(myTeamId))
    entries.push({
      id: f.id,
      laneId,
      kind: "fixture",
      date: f.kickoff_date,
      time: f.kickoff_time,
      title: `${homeAway === "Home" ? "H" : homeAway === "Away" ? "A" : "?"} vs ${opposition}`,
      teamDisplayName: myLabel,
      opposition,
      homeAway,
      venueAddress: f.venue_address,
      pitchName: f.pitch_id ? (fixturePitchNameById.get(f.pitch_id) ?? null) : null,
      status: f.status,
      statusClass: STATUS_STYLES[f.status] ?? "bg-ink/5 text-ink/60 border-ink/15",
      needsAction: ACTIONABLE_STATUSES.has(f.status),
      resultLabel: f.result_status === "confirmed" && f.home_score !== null && f.away_score !== null ? `${f.home_score}-${f.away_score}` : null,
      canEdit,
      owningTeamId: f.owning_team_id,
      opponentTeamId: f.opponent_team_id,
      opponentDirectoryId: f.opponent_directory_id,
      competitionEditionId: f.competition_edition_id,
      pitchId: f.pitch_id,
      notes: f.notes,
      tournamentHostName: null,
      tournamentParticipantCount: null,
      tournamentParticipants: null,
      tournamentMyParticipantId: null,
      tournamentMyStatus: null,
      tournamentIAmHost: false,
      tournamentHostTeamId: null,
      tournamentVenueId: null,
    })
  }
  for (const t of training ?? []) {
    const laneId = laneIdFor(t.team_id, t.scheduling_group_id)
    if (!laneId) continue
    if (teamFilter && laneId !== teamFilter) continue
    entries.push({
      id: t.id,
      laneId,
      kind: "training",
      date: t.session_date,
      time: t.start_time,
      title: "Training",
      teamDisplayName: "",
      opposition: "",
      homeAway: "",
      venueAddress: null,
      pitchName: t.club_pitches?.display_name ?? null,
      status: "Training",
      statusClass: "bg-forest-800/10 text-forest-900 border-forest-800/20",
      canEdit: false,
      owningTeamId: null,
      opponentTeamId: null,
      opponentDirectoryId: null,
      competitionEditionId: null,
      pitchId: null,
      notes: null,
      tournamentHostName: null,
      tournamentParticipantCount: null,
      tournamentParticipants: null,
      tournamentMyParticipantId: null,
      tournamentMyStatus: null,
      tournamentIAmHost: false,
      tournamentHostTeamId: null,
      tournamentVenueId: null,
      needsAction: false,
      resultLabel: null,
    })
  }
  for (const t of tournamentRows ?? []) {
    if (!t.id) continue
    // A tournament shows in the lane of whichever of MY teams is either
    // hosting or an ACCEPTED participant (Section CF) -- club_visible_
    // tournaments has already restricted the rows returned to exactly
    // that, so any host_team_id/accepted-participant team_id found among
    // my own scoped teams is a real lane to render it in.
    const myParticipant = (tournamentParticipantRows ?? []).find(
      (p) => p.tournament_id === t.id && p.team_id !== null && teamIds.includes(p.team_id)
    )
    const iAmHost = Boolean(t.host_team_id && teamIds.includes(t.host_team_id))
    const myTeamId = iAmHost ? t.host_team_id : (myParticipant?.team_id ?? null)
    const laneId = laneIdFor(myTeamId, null)
    if (!laneId) continue
    if (teamFilter && laneId !== teamFilter) continue
    const participants = participantsByTournamentId.get(t.id) ?? []
    const hostName = hostDirectoryNameById.get(t.host_directory_id ?? "") ?? "Host"
    const tournamentVenue = t.venue_id ? tournamentVenueById.get(t.venue_id) : null
    entries.push({
      id: t.id,
      laneId,
      kind: "tournament",
      date: t.event_date ?? "",
      time: t.kickoff_time,
      title: `Tournament · ${hostName}`,
      teamDisplayName: "",
      opposition: "",
      homeAway: "",
      venueAddress: tournamentVenue ? (tournamentVenue.address ?? tournamentVenue.name) : null,
      pitchName: t.pitch_id ? (fixturePitchNameById.get(t.pitch_id) ?? null) : null,
      status: t.status ?? "confirmed",
      statusClass: "bg-amber-500/10 text-amber-900 border-amber-500/30",
      needsAction: false,
      resultLabel: null,
      canEdit: false,
      owningTeamId: null,
      opponentTeamId: null,
      opponentDirectoryId: null,
      competitionEditionId: null,
      pitchId: t.pitch_id,
      notes: null,
      tournamentHostName: hostName,
      tournamentParticipantCount: participants.length,
      tournamentParticipants: participants,
      tournamentMyParticipantId: myParticipant?.id ?? null,
      tournamentMyStatus: (myParticipant?.status as TournamentParticipantView["status"] | undefined) ?? null,
      tournamentIAmHost: iAmHost,
      tournamentHostTeamId: t.host_team_id ?? null,
      tournamentVenueId: t.venue_id ?? null,
    })
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""))

  const visibleLanes = teamFilter ? fullLanes.filter((l) => l.id === teamFilter) : fullLanes

  const manageableTeamIds = manageableTeamIdsEarly
  const hasClubFixtureAuthority = hasClubFixtureAuthorityEarly
  // hasClubFixtureAuthority/manageableTeamIds are session-wide (every
  // authority this account holds anywhere), so gating on those alone let
  // Parent View offer "Schedule training" for the whole club -- a
  // live-confirmed leak. boardContext.kind === "team" still allows the
  // affordance for a genuine Coach/Team Admin viewing their own team, but
  // neither "parent" (Guardian/view-only) nor "player" ever does, matching
  // fixtures/page.tsx's activeContext.kind === "club" gate for the
  // club-wide case.
  // Schedule Training's real DB boundary (internal.can_manage_training) is
  // now routed through the canonical capability engine's fixture.create
  // (see supabase/migrations/20260924000000_training_capability_migration.sql),
  // so the club-wide leg of this button gate is checked the same way --
  // override-aware, not just role-default. The per-team leg stays on the
  // cheap session-derived manageableTeamIds (matches fixture.create's team
  // role-bundle exactly; making it override-aware too would mean one RPC
  // per lane on every Calendar load, a bad trade for a UI affordance when
  // the real boundary already enforces the override -- a disclosed,
  // deliberately-unfixed gap, same shape as Season Rollover's).
  const canScheduleTrainingClubWide = activeManageableClubEarly
    ? await hasCapability(supabase, "fixture.create", "club", { clubId: activeManageableClubEarly })
    : false
  const canScheduleTraining =
    boardContext.kind !== "parent" && boardContext.kind !== "player" && (canScheduleTrainingClubWide || manageableTeamIds.size > 0)

  // Pitch Allocation tab visibility -- Section 22-25: club-scoped
  // fixture.edit only (Club Admin/Fixture Secretary), never available
  // merely because someone can view Calendar, and never for a team-scoped
  // Team Admin/Coach's narrower grant (their fixture.edit is at team
  // scope, which this club-scope check does not satisfy).
  const canManagePitchAllocation = boardContext.kind === "club" && boardContext.id ? await hasCapability(supabase, "fixture.edit", "club", { clubId: boardContext.id }) : false

  let trainingTargets: TrainingTargetOption[] = []
  let trainingPitches: PitchOption[] = []
  let trainingClubId: string | null = null
  if (canScheduleTraining) {
    // Same activeManageableClubEarly used for the lane "+" gate above --
    // never `ctx.clubMemberships[0]`/`ctx.teamPermissions[0]`, which
    // resolved to whichever club/team happened to be first in the
    // session's full list rather than the one actually being viewed. A
    // "team" context (real Coach/Team Admin authority, not view-only)
    // still resolves the club a training session would belong to, but
    // from that team's OWN club, never an unrelated one.
    trainingClubId =
      activeManageableClubEarly ?? (boardContext.kind === "team" ? (ctx.teamPermissions.find((tp) => tp.teamId === boardContext.id)?.clubId ?? null) : null)
    if (trainingClubId) {
      const [{ data: clubTeams }, { data: clubGroups }, { data: clubPitches }] = await Promise.all([
        supabase.from("teams").select("id, display_name, category, age_group, gender, squad_designation").eq("club_id", trainingClubId).eq("active", true).order("display_name"),
        supabase.from("scheduling_groups").select("id, display_tag, alias").eq("club_id", trainingClubId).eq("active", true),
        supabase.from("club_pitches").select("id, display_name").eq("club_id", trainingClubId).eq("active", true).order("sort_order"),
      ])
      trainingTargets = [
        ...(clubTeams ?? []).map((t) => ({
          value: t.id,
          label: compactTeamLabel({ category: t.category, ageGroup: t.age_group, gender: t.gender, squadDesignation: t.squad_designation }),
          kind: "team" as const,
        })),
        ...(clubGroups ?? []).map((g) => ({ value: g.id, label: miniRugbyGroupLabel({ displayTag: g.display_tag, alias: g.alias }), kind: "group" as const })),
      ]
      // Club-wide authority sees every team in the club (existing
      // behaviour). Team-only authority (no real club-wide fixture role)
      // only ever sees the team(s) it genuinely manages -- not the whole
      // club roster, which a Coach assigned to a single team has no
      // business browsing just to schedule their own training.
      if (!activeManageableClubEarly) {
        trainingTargets = trainingTargets.filter((t) => manageableTeamIdsEarly.has(t.value))
      }
      trainingPitches = (clubPitches ?? []).map((p) => ({ id: p.id, displayName: p.display_name }))
    }
  }

  const weekLabel =
    view === "week" && weekDays.length === 7
      ? `${weekDays[0].toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${weekDays[6].toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
      : ""
  const monthLabel = view === "month" ? monthAnchor.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : ""
  const monthStartIso = view === "month" ? toIso(monthAnchor) : ""

  const baseParams = { team: teamFilter, view: view === "week" ? null : "month", season: seasonParam ?? null, phase: phaseParam ?? null, status: statusFilters[0], ha, kind }
  const prevWeekIso = toIso(addDays(rangeStart, -7))
  const nextWeekIso = toIso(addDays(rangeStart, 7))
  const currentMonthYm = `${monthAnchor.getFullYear()}-${String(monthAnchor.getMonth() + 1).padStart(2, "0")}`
  const prevMonthDate = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() - 1, 1)
  const nextMonthDate = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 1)
  const prevMonthYm = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`
  const nextMonthYm = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}`
  // Section 3: navigation stops at the boundary rather than merely
  // clamping past it invisibly -- once the currently-rendered period
  // already reaches the range's start/end, Previous/Next is disabled
  // instead of silently re-landing on the same clamped period.
  const canGoPrev = !range || (view === "week" ? startIso > range.start : currentMonthYm > range.start.slice(0, 7))
  const canGoNext = !range || (view === "week" ? endIso < range.end : currentMonthYm < range.end.slice(0, 7))

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">{boardContext.label}</p>
          <h1 className="mt-2 font-display text-display-l text-ink">Calendar</h1>
        </div>
        {canScheduleTraining && trainingTargets.length > 0 && trainingClubId && (
          <ScheduleTrainingDialog clubId={trainingClubId} targets={trainingTargets} pitches={trainingPitches} range={range} />
        )}
      </div>

      {/* Season-first header -- shared with Agenda, see season-phase-header.tsx */}
      <SeasonPhaseHeader
        basePath="/calendar"
        baseParams={baseParams}
        selectedSeason={selectedSeason}
        selectedPhase={selectedPhase}
        prevSeason={prevSeason}
        nextSeason={nextSeason}
      />

      {/* Simplified toolbar: Week / Month primary, Agenda subtle, Filter */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-ink/10 bg-white p-1">
          <Link
            href={`/calendar${qs({ ...baseParams, view: null })}`}
            className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors", view === "week" ? "bg-forest-950 text-white" : "text-ink/60 hover:bg-ink/5")}
          >
            Week
          </Link>
          <Link
            href={`/calendar${qs({ ...baseParams, view: "month" })}`}
            className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors", view === "month" ? "bg-forest-950 text-white" : "text-ink/60 hover:bg-ink/5")}
          >
            Month
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <FilterSheet
            activeStatuses={statusFilters}
            activeHomeAway={ha ?? null}
            activeKind={kind ?? null}
            activeTeam={teamFilter ?? null}
            activeWeek={weekParam ?? null}
            activeSeason={seasonParam ?? null}
            activePhase={phaseParam ?? null}
            activeView={viewParam ?? null}
          />
          <Link href="/calendar/agenda" className="text-sm font-medium text-ink/50 underline underline-offset-2 hover:text-ink">
            Agenda
          </Link>
          {canManagePitchAllocation && (
            <Link href="/calendar/pitch-allocation" className="text-sm font-medium text-ink/50 underline underline-offset-2 hover:text-ink">
              Pitch Allocation
            </Link>
          )}
        </div>
      </div>

      {/* Date navigation */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Link
            href={canGoPrev ? `/calendar${qs({ ...baseParams, week: view === "week" ? prevWeekIso : null, month: view === "month" ? prevMonthYm : null })}` : "#"}
            aria-disabled={!canGoPrev}
            tabIndex={canGoPrev ? undefined : -1}
            className={cn(
              "flex size-8 items-center justify-center rounded-md border border-ink/15 text-ink/60 outline-none hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-pitch-400",
              !canGoPrev && "pointer-events-none opacity-30"
            )}
            aria-label={view === "week" ? "Previous week" : "Previous month"}
          >
            <ChevronLeft className="size-4" />
          </Link>
          <p className="min-w-[11rem] text-center text-sm font-medium text-ink">{view === "week" ? weekLabel : monthLabel}</p>
          <Link
            href={canGoNext ? `/calendar${qs({ ...baseParams, week: view === "week" ? nextWeekIso : null, month: view === "month" ? nextMonthYm : null })}` : "#"}
            aria-disabled={!canGoNext}
            tabIndex={canGoNext ? undefined : -1}
            className={cn(
              "flex size-8 items-center justify-center rounded-md border border-ink/15 text-ink/60 outline-none hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-pitch-400",
              !canGoNext && "pointer-events-none opacity-30"
            )}
            aria-label={view === "week" ? "Next week" : "Next month"}
          >
            <ChevronRight className="size-4" />
          </Link>
        </div>
        {(weekParam || (monthParam && monthParam !== currentMonthYm)) && (
          <Link href={`/calendar${qs({ ...baseParams })}`} className="text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
            Back to today
          </Link>
        )}
      </div>

      {seasonConfigBroken ? (
        <SeasonConfigBrokenState phaseLabel={selectedPhase === "pre" ? "Pre-Season" : "Season"} canSeeDetail={hasClubFixtureAuthority} />
      ) : (
        <>
          {/* Pre-Season textual/semantic indicator (Section 8) -- the header
              pill already carries the toggle state, but this repeats it as
              plain, unambiguous text right above the grid itself, not
              relying on the dark header treatment alone. */}
          {selectedPhase === "pre" && (
            <p className="mt-4 text-xs font-medium tracking-[0.06em] text-forest-800 uppercase" role="status">
              Pre-Season &mdash; dates outside {selectedSeason!.seasonRef}&apos;s Pre-Season window are inactive
            </p>
          )}

          <TeamFilterBar lanes={fullLanes} activeTeam={teamFilter ?? null} baseParams={baseParams} />

          {/* Desktop: lanes/grid. Mobile: always the compact agenda list --
              never a squeezed grid or lanes board. Pre-Season gets a subtle
              tinted frame around the grid itself (Section 9: the two phases
              must not read as visually identical besides the toggle). */}
          <div className={cn("mt-6 hidden md:block", selectedPhase === "pre" && "rounded-xl border border-forest-950/10 bg-forest-950/[0.025] p-2")}>
            {visibleLanes.length === 0 ? (
              <EmptyCalendarState canScheduleTraining={canScheduleTraining} hasClubFixtureAuthority={hasClubFixtureAuthority} noTeams />
            ) : entries.length === 0 ? (
              <EmptyCalendarState canScheduleTraining={canScheduleTraining} hasClubFixtureAuthority={hasClubFixtureAuthority} />
            ) : view === "week" ? (
              <WeekBoard
                days={weekDays.map(toIso)}
                todayIso={todayIso}
                range={range}
                lanes={visibleLanes}
                allLanes={fullLanes}
                entries={entries}
                clubId={boardContext.kind === "club" ? boardContext.id : null}
                clubName={boardContext.label}
                rugbyCode={clubRugbyCode}
                season={selectedSeason ? { id: selectedSeason.id, label: selectedSeason.name } : null}
                competitions={competitionOptions}
                pitches={trainingPitches}
              />
            ) : (
              <MonthView
                gridDays={gridDays}
                monthStartIso={monthStartIso}
                todayIso={todayIso}
                range={range}
                lanes={visibleLanes}
                allLanes={fullLanes}
                entries={entries}
                clubId={boardContext.kind === "club" ? boardContext.id : null}
                clubName={boardContext.label}
                rugbyCode={clubRugbyCode}
                season={selectedSeason ? { id: selectedSeason.id, label: selectedSeason.name } : null}
                competitions={competitionOptions}
                pitches={trainingPitches}
              />
            )}
          </div>

          <div className="mt-6 md:hidden">
            <MobileAgenda
              entries={entries}
              lanes={visibleLanes}
              allLanes={fullLanes}
              canScheduleTraining={canScheduleTraining}
              hasClubFixtureAuthority={hasClubFixtureAuthority}
              clubId={boardContext.kind === "club" ? boardContext.id : null}
              clubName={boardContext.label}
              rugbyCode={clubRugbyCode}
              season={selectedSeason ? { id: selectedSeason.id, label: selectedSeason.name } : null}
              range={range}
              competitions={competitionOptions}
              pitches={trainingPitches}
            />
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Section 12: fail closed. A season row exists but its dates violate the
 * canonical ordering rule (lib/seasons/validation.ts), so there is no
 * real window to bound navigation to -- shown instead of the grid, never
 * as a fallback to unrestricted browsing. Administrators (real club
 * fixture authority) get the specific problem named so they can fix it;
 * everyone else gets a plain "not available right now" message, since
 * only an admin can act on it.
 */
function SeasonConfigBrokenState({ phaseLabel, canSeeDetail }: { phaseLabel: string; canSeeDetail: boolean }) {
  return (
    <div className="mt-6 flex flex-col items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-5 py-8" role="alert">
      <p className="text-sm font-medium text-amber-900">{phaseLabel} isn&apos;t available right now.</p>
      <p className="max-w-md text-sm text-amber-800/80">
        {canSeeDetail
          ? `This season's ${phaseLabel} dates are misconfigured (they don't satisfy Pre-Season Start before Main Season Start on/before Main Season End) -- fix them under Season Rollover before this period can be browsed.`
          : "This part of the calendar is temporarily unavailable. Please check back later or contact your club admin."}
      </p>
    </div>
  )
}

function EmptyCalendarState({ noTeams, canScheduleTraining, hasClubFixtureAuthority }: { noTeams?: boolean; canScheduleTraining: boolean; hasClubFixtureAuthority: boolean }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-ink/15 bg-white/60 px-5 py-8">
      <p className="text-sm font-medium text-ink">{noTeams ? "No teams to show for this view yet." : "No fixtures or training this period."}</p>
      {!noTeams && (
        <div className="flex flex-wrap gap-2">
          {hasClubFixtureAuthority && (
            <Link
              href="/fixtures/new"
              className="rounded-lg bg-forest-950 px-3.5 py-2 text-sm font-medium text-white outline-none hover:bg-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              Add fixture
            </Link>
          )}
          {canScheduleTraining && <p className="self-center text-xs text-ink/45">Use &ldquo;Schedule training&rdquo; above to add a session.</p>}
        </div>
      )}
    </div>
  )
}
