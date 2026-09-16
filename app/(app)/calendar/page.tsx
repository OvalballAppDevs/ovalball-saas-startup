import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, isFamilyFacingContext, resolveActiveContext, type SwitchableContext } from "@/lib/app-context/active-context"
import { DIAGNOSTIC_SESSION_COOKIE, resolveDiagnosticClub } from "@/lib/app-context/diagnostic-access"
import { getTeamsForActiveContext } from "@/lib/app-context/my-teams"
import { getSessionContext } from "@/lib/app-context/session-context"
import { resolveCalendarSeasonContext, clampIsoToRange } from "@/lib/calendar/season-context"
import { buildCalendarLanes } from "@/lib/calendar/build-lanes"
import { extendLanesWithReferencedGroups, loadOpponentGroupLabels, resolveMyFixtureSide } from "@/lib/calendar/resolve-entry-participant"
import { miniRugbyGroupLabel } from "@/lib/mini-rugby/group-label"
import { loadTeamIdentitiesForSeason, teamIdentityKey } from "@/lib/mini-rugby/team-identity.server"
import { hasCapability } from "@/lib/permissions/has-capability"
import { compactTeamLabel, fullTeamLabel } from "@/lib/teams/compact-label"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

import type { CompetitionOption } from "./create-fixture-dialog"
import { FilterSheet } from "./filter-sheet"
import { MobileAgenda } from "./mobile-agenda"
import { CalendarHeart, Dumbbell, MapPin, Settings2, X } from "lucide-react"

import { SeasonGrid, SeasonSummary } from "@/components/calendar/season-grid"
import { WeekDetailDialog } from "@/components/calendar/week-detail-dialog"
import { buildSeasonGrid, type SeasonGridEvent } from "@/lib/calendar/season-grid"
import { MonthView } from "./month-view"
import { ScheduleTrainingDialog, type PitchOption, type TrainingTargetOption } from "./schedule-training-dialog"
import { SeasonPhaseHeader } from "./season-phase-header"
import { TeamFilterBar } from "./team-filter-bar"
import { formatEventDateRange } from "@/lib/app-context/event-centre-data"
import { qs } from "@/lib/calendar/query-string"
import { WeekBoard, type TournamentParticipantView, type WeekEntry } from "./week-board"

export const metadata = { title: "Calendar" }

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
  Cancelled: "bg-destructive/10 text-destructive-text border-destructive/30",
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
    /** Family-facing only (Guardian/Player contexts) -- see the filter block below. */
    venue?: string
    attendance?: string
  }>
}) {
  const {
    week: weekParam,
    month: monthParam,
    team: teamFilter,
    view: viewParam,
    season: seasonParam,
    phase: phaseParam,
    status,
    ha,
    kind,
    venue: venueParam,
    attendance: attendanceParam,
  } = await searchParams
  const statusFilters = status ? (Array.isArray(status) ? status : [status]) : []
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)

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
  // ---- The viewer's rugby code. THIS IS AN ISOLATION BOUNDARY, NOT A HINT.
  //
  // Union and League are strictly isolated: a Union club is never shown League
  // data, and never the reverse. The season register holds both codes, so the
  // code passed to the resolver is the only thing standing between a Union
  // viewer and a League season window.
  //
  // It used to be read ONLY from a club board context, which meant every
  // player, guardian and team-scoped viewer resolved their season with no code
  // at all -- the resolver then picked whichever season merely contained
  // today's date. That went unnoticed only because both seeded seasons happened
  // to share identical dates; the moment the League season was corrected to its
  // real February-October shape, a Men's 1st Team player at a Union club opened
  // Calendar and was shown "2026", starting in January. Fixtures from one code
  // inside the other code's date boundaries is precisely the cross-code leak
  // the Team Directory rules forbid.
  //
  // The code is therefore derived from the viewer's actual scope: the club when
  // there is one, otherwise the teams they can see, which carry rugby_code
  // canonically. Both routes read a stored column; neither infers a code from a
  // season label, a name or a date.
  let clubRugbyCode: string | null = null
  if (boardContext.kind === "club" && boardContext.id) {
    const { data: club } = await supabase.from("clubs").select("directory_id").eq("id", boardContext.id).maybeSingle()
    if (club) {
      const { data: directory } = await supabase.from("club_directory").select("rugby_code").eq("id", club.directory_id).maybeSingle()
      clubRugbyCode = directory?.rugby_code ?? null
    }
  }
  // ---- Which club's events this viewer is looking at.
  //
  // Resolved the same way the rugby code is, and for the same reason: a club
  // board context knows its own club, and a player, guardian or team-scoped
  // viewer knows it through the teams they can see. Deriving it from
  // boardContext alone would have left every family-facing viewer with no club
  // events at all -- the same shape as the cross-code defect fixed earlier.
  let activeClubIdForEvents: string | null = boardContext.kind === "club" ? (boardContext.id ?? null) : null
  if (!activeClubIdForEvents && teamIds.length > 0) {
    const { data: teamClubs } = await supabase.from("teams").select("club_id").in("id", teamIds)
    const clubIds = new Set((teamClubs ?? []).map((t) => t.club_id).filter((c): c is string => Boolean(c)))
    // One club is the ordinary case. A family spanning two clubs has no single
    // club calendar, and picking one would assert something false about the
    // other, so it gets none rather than half.
    if (clubIds.size === 1) activeClubIdForEvents = [...clubIds][0]
  }

  if (!clubRugbyCode) {
    // A team, family or player scope. Every team in scope carries its own
    // canonical code; one distinct value is the viewer's code.
    //
    // If a viewer somehow spans BOTH codes -- a family with children at a
    // union club and a league club -- there is no single right answer, and
    // choosing one would assert something false about the other. That case
    // is left unscoped deliberately rather than guessed; it cannot arise from
    // a single club's own members, which is every real viewer here.
    const codes = new Set(scopedTeams.map((t) => t.rugbyCode).filter((c): c is string => Boolean(c)))
    if (codes.size === 1) clubRugbyCode = [...codes][0]
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

  // THREE VIEWS, ONE CALENDAR. Season is not twelve small months: it is a
  // week-grained view of the whole canonical season window, which is why its
  // range comes from the season resolver rather than from a date anchor.
  const view = viewParam === "month" ? "month" : viewParam === "season" ? "season" : "week"

  // ---- Date range for the active view -- bounded, never the whole season. ----
  const todayIso = toIso(new Date())
  let rangeStart: Date
  let rangeEnd: Date
  let gridDays: string[] = []
  let weekDays: Date[] = []
  let monthAnchor: Date = new Date(`${todayIso}T00:00:00`)
  if (view === "season") {
    // BOUNDED BY THE CANONICAL SEASON, never "everything". Section 35 permits
    // exactly this: one bounded read of the selected season's authorised
    // events. With no resolvable range we fail closed to today's week rather
    // than fetching an open-ended window.
    const seasonStart = range?.start ?? todayIso
    const seasonEnd = range?.end ?? todayIso
    rangeStart = startOfWeek(new Date(`${seasonStart}T00:00:00`))
    rangeEnd = new Date(`${seasonEnd}T00:00:00`)
    weekDays = []
  } else if (view === "week") {
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
  // Section I/N: an archived (soft-deleted) fixture never appears in a
  // normal Calendar query for ANYONE, staff included -- only Deleted
  // Calendar Events reads it. A cancelled fixture stays visible to every
  // staff/back-office context (Section E/M); only a genuine Parent/Player
  // View (the existing, canonical "parent"/"player" ActiveContextKind --
  // never a role string re-derived here) must never see it at all
  // (Section N: it must stop reading as an upcoming commitment).
  const isParentPlayerView = isFamilyFacingContext(boardContext.kind)
  let fixturesQuery = supabase
    .from("fixtures")
    .select(
      "id, owning_team_id, opponent_team_id, opponent_directory_id, home_team_id, away_team_id, owning_scheduling_group_id, opponent_scheduling_group_id, kickoff_date, kickoff_time, home_away, status, raw_opposition_text, venue_address, venue_id, home_score, away_score, result_status, pitch_id, competition_edition_id, notes, season_id, cancelled_at, cancelled_by, cancellation_reason, teams!fixtures_owning_team_id_fkey(display_name)"
    )
    .or(fixtureOrClauses.length > 0 ? fixtureOrClauses.join(",") : "owning_team_id.eq.00000000-0000-0000-0000-000000000000")
    .gte("kickoff_date", startIso)
    .lte("kickoff_date", endIso)
    .is("archived_at", null)
    .order("kickoff_date", { ascending: true })
  if (isParentPlayerView) fixturesQuery = fixturesQuery.neq("status", "Cancelled")
  if (statusFilters.length > 0) fixturesQuery = fixturesQuery.in("status", statusFilters)
  if (ha === "home") fixturesQuery = fixturesQuery.eq("home_away", "Home")
  if (ha === "away") fixturesQuery = fixturesQuery.eq("home_away", "Away")
  const { data: fixtures } = kind === "training" ? { data: [] } : await fixturesQuery

  // Section D/O: Message Club eligibility -- opponent_team_id resolved
  // (only possible for a claimed club, since teams only exist under
  // claimed clubs) AND that club is currently active. Same
  // clubs.status === 'active' signal Pitch Allocation already uses for
  // its own "activeOpponentClubIds" set -- never inferred from a name.
  const opponentTeamIds = Array.from(new Set((fixtures ?? []).map((f) => f.opponent_team_id).filter((id): id is string => Boolean(id))))
  const { data: opponentTeamClubRows } =
    opponentTeamIds.length > 0 ? await supabase.from("teams").select("id, club_id").in("id", opponentTeamIds) : { data: [] }
  const opponentClubIdByTeamId = new Map((opponentTeamClubRows ?? []).map((t) => [t.id, t.club_id]))
  const opponentClubIds = Array.from(new Set(Array.from(opponentClubIdByTeamId.values())))
  const { data: opponentClubRows } = opponentClubIds.length > 0 ? await supabase.from("clubs").select("id, status").in("id", opponentClubIds) : { data: [] }
  const activeOpponentClubIds = new Set((opponentClubRows ?? []).filter((c) => c.status === "active").map((c) => c.id))

  // Cancellation detail (Section E's info dialog): resolve cancelled_by's
  // real display name, same "never a raw auth id" convention Training's
  // own get_training_session_card already established.
  const cancelledByIds = Array.from(new Set((fixtures ?? []).map((f) => f.cancelled_by).filter((id): id is string => Boolean(id))))
  const { data: cancelledByProfiles } =
    cancelledByIds.length > 0 ? await supabase.from("profiles").select("id, first_name, surname").in("id", cancelledByIds) : { data: [] }
  const cancelledByNameById = new Map((cancelledByProfiles ?? []).map((p) => [p.id, [p.first_name, p.surname].filter(Boolean).join(" ") || "Unknown"]))

  const fixturePitchIds = Array.from(new Set((fixtures ?? []).map((f) => f.pitch_id).filter((id): id is string => Boolean(id))))
  const { data: fixturePitches } =
    fixturePitchIds.length > 0 ? await supabase.from("club_pitches").select("id, display_name").in("id", fixturePitchIds) : { data: [] }
  const fixturePitchNameById = new Map((fixturePitches ?? []).map((p) => [p.id, p.display_name]))

  // A fixture's structured venue_id (the same venues table Training's own
  // canonical card resolves) is a more useful "Venue" than free-text
  // venue_address when the latter is blank -- prefer the real name over
  // showing nothing.
  const fixtureVenueIds = Array.from(new Set((fixtures ?? []).map((f) => f.venue_id).filter((id): id is string => Boolean(id))))
  const { data: fixtureVenues } = fixtureVenueIds.length > 0 ? await supabase.from("venues").select("id, name").in("id", fixtureVenueIds) : { data: [] }
  const fixtureVenueNameById = new Map((fixtureVenues ?? []).map((v) => [v.id, v.name]))

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
          .select("id, team_id, scheduling_group_id, session_date, start_time, notes, club_pitches(display_name), teams(display_name, rugby_code, category, age_group, gender, squad_designation)")
          .is("cancelled_at", null)
          .or(trainingOrClauses.length > 0 ? trainingOrClauses.join(",") : "team_id.eq.00000000-0000-0000-0000-000000000000")
          .gte("session_date", startIso)
          .lte("session_date", endIso)

  // ---- CLUB EVENTS.
  //
  // ONE BOUNDED QUERY FOR THE WHOLE WINDOW, and one row per event however many
  // days it spans -- the span is projected onto days below, in memory. A
  // query per day, or a stored row per day, would both make a seven-day
  // centenary weekend cost seven of something.
  //
  // The overlap test is deliberately `starts_on <= windowEnd AND ends_on >=
  // windowStart`, not `starts_on between ...`: an event that began last week
  // and runs through this one is on this week's calendar, and a start-date
  // filter would silently drop exactly the multi-day events this model exists
  // to support.
  //
  // RLS does the authorisation. This query states the window and the club; who
  // may see which event is internal.club_event_visible_row's answer, and it is
  // the same answer Event Centre gets.
  const { data: clubEvents } =
    kind === "fixture" || kind === "training" || !activeClubIdForEvents
      ? { data: [] }
      : await supabase
          .from("club_events")
          .select(
            "id, club_id, name, starts_on, start_time, ends_on, end_time, is_club_wide, status, cancelled_at, venue_id, external_location_name, venues(name), club_event_teams(team_id), club_event_pitches(pitch_id)"
          )
          .eq("club_id", activeClubIdForEvents)
          .lte("starts_on", endIso)
          .gte("ends_on", startIso)

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
    .select("id, name, host_club_id, host_team_id, host_directory_id, event_date, ends_on, kickoff_time, pitch_id, venue_id, status")
    // The same overlap test the club-event read uses: a multi-day festival
    // that began before this window is still running inside it.
    .lte("event_date", endIso)
    .gte("ends_on", startIso)
  const tournamentIds = (tournamentRows ?? []).map((t) => t.id).filter((id): id is string => Boolean(id))

  // WHICH OF OUR TEAMS IS GOING. This is what makes one occasion appear in
  // several team lanes without becoming several tournaments: one row per
  // (tournament, our team), all pointing at the same tournament_id.
  const { data: tournamentEntryRows } =
    tournamentIds.length > 0
      ? await supabase.from("tournament_team_entries").select("id, tournament_id, team_id").in("tournament_id", tournamentIds)
      : { data: [] }
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
    // Section G/M: Delete is narrower than Edit/Cancel -- only this exact
    // row's own OWNING club's Club Admin/Fixtures Secretary, never the
    // opponent side and never a Team Admin/Coach/Manager by default.
    const canDelete = !iAmOpponent && hasClubFixtureAuthorityEarly
    const opponentClubId = f.opponent_team_id ? (opponentClubIdByTeamId.get(f.opponent_team_id) ?? null) : null
    const canMessageClub = Boolean(f.opponent_team_id && opponentClubId && activeOpponentClubIds.has(opponentClubId))
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
      venueAddress: f.venue_address || (f.venue_id ? (fixtureVenueNameById.get(f.venue_id) ?? null) : null),
      pitchName: f.pitch_id ? (fixturePitchNameById.get(f.pitch_id) ?? null) : null,
      status: f.status,
      statusClass: STATUS_STYLES[f.status] ?? "bg-ink/5 text-ink/60 border-ink/15",
      needsAction: ACTIONABLE_STATUSES.has(f.status),
      resultLabel: f.result_status === "confirmed" && f.home_score !== null && f.away_score !== null ? `${f.home_score}-${f.away_score}` : null,
      canEdit,
      canDelete,
      canMessageClub,
      cancelledAt: f.cancelled_at,
      cancelledByName: f.cancelled_by ? (cancelledByNameById.get(f.cancelled_by) ?? "Unknown") : null,
      cancellationReason: f.cancellation_reason,
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
      tournamentId: null,
      tournamentEntryId: null,
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
      // Section 28: the Calendar card itself carries the real team label,
      // not just its lane -- a Mini-Rugby Group's shared session has no
      // single team here (t.teams is null for a scheduling_group_id-owned
      // session), so it falls back to the lane's own label at render time.
      title: "Planned Training",
      // THE DISPLAY FORM, exactly as a fixture on the same list uses. The
      // canonical directory has two forms and one source: compact ("U13",
      // "Girls U12") is for dense surfaces -- Calendar lanes and filter chips
      // -- and the display form ("Under 13 Boys") is what a team is called
      // everywhere else. An event list is one of those everywhere-elses, and
      // using the compact form here put two naming conventions in a single
      // list: "Under 11 Mixed v Rossendale RUFC" directly above "Girls U12".
      teamDisplayName: t.teams ? fullTeamLabel({ category: t.teams.category as "senior" | "youth" | "colts", ageGroup: t.teams.age_group, gender: t.teams.gender, squadDesignation: t.teams.squad_designation, rugbyCode: t.teams.rugby_code }) : "",
      opposition: "",
      homeAway: "",
      venueAddress: null,
      pitchName: t.club_pitches?.display_name ?? null,
      status: "Training",
      statusClass: "bg-forest-800/10 text-forest-900 border-forest-800/20",
      canEdit: false,
      canDelete: false,
      canMessageClub: false,
      cancelledAt: null,
      cancelledByName: null,
      cancellationReason: null,
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
      tournamentId: null,
      tournamentEntryId: null,
      needsAction: false,
      resultLabel: null,
    })
  }

  // ---- CLUB EVENTS, PROJECTED ONTO THE DAYS THEY COVER.
  //
  // One stored row becomes one entry per (day in the window, affected lane).
  // The EVENT ID is carried on every one of them, so a seven-day centenary
  // weekend across three teams is still one event to open, one event to edit
  // and one event to cancel -- the multiplication is presentation, and it
  // stops at the screen.
  //
  // A club-wide event affects every lane the viewer can see; a scoped event
  // affects only the lanes whose team is named on it.
  for (const ev of clubEvents ?? []) {
    // A CANCELLED EVENT STAYS ON THE CALENDAR.
    //
    // This is the convention fixtures already follow -- a cancelled fixture
    // carries cancelled_at through and renders struck through in the reserved
    // destructive tone, rather than vanishing. Silently removing it is the
    // worse failure: a family who has already made plans looks at the calendar,
    // sees nothing, and concludes they misremembered rather than that it was
    // called off. It is marked, not deleted.
    if (!ev.id) continue
    const eventTeamIds = new Set((ev.club_event_teams ?? []).map((r) => r.team_id).filter((t): t is string => Boolean(t)))
    const affectedLanes = ev.is_club_wide
      ? fullLanes.map((l) => l.id)
      : fullLanes.filter((l) => l.memberTeamIds.some((tid: string) => eventTeamIds.has(tid))).map((l) => l.id)
    if (affectedLanes.length === 0) continue

    const spanStart = ev.starts_on > startIso ? ev.starts_on : startIso
    const spanEnd = ev.ends_on < endIso ? ev.ends_on : endIso
    const locationLabel = ev.venues?.name ?? ev.external_location_name ?? null

    for (let d = spanStart; d <= spanEnd; d = toIso(addDays(new Date(`${d}T00:00:00`), 1))) {
      const position: "starts" | "continues" | "ends" =
        d === ev.starts_on ? "starts" : d === ev.ends_on ? "ends" : "continues"
      for (const laneId of affectedLanes) {
        if (teamFilter && laneId !== teamFilter) continue
        entries.push({
          // Unique per rendered cell, so React keys are stable; `eventId` is
          // the canonical identity every route and dedupe uses.
          id: `event-${ev.id}-${laneId}-${d}`,
          eventId: ev.id,
          laneId,
          kind: "event",
          date: d,
          // Only the first day of a run carries the start time.
          time: position === "starts" ? ev.start_time : null,
          spanPosition: ev.starts_on === ev.ends_on ? null : position,
          spanNote: ev.starts_on === ev.ends_on ? null : formatEventDateRange(ev.starts_on, ev.ends_on),
          title: ev.name,
          teamDisplayName: "",
          opposition: "",
          homeAway: "",
          venueAddress: locationLabel,
          pitchName: null,
          status: ev.status === "CANCELLED" ? "Cancelled" : "Event",
          // The one cancelled treatment Ovalball already reserves, not an
          // Event-only cancellation language.
          statusClass:
            ev.status === "CANCELLED"
              ? "bg-destructive/10 text-destructive-text border-destructive/20"
              : "bg-[#6d3b5d]/10 text-[#6d3b5d] border-[#6d3b5d]/20",
          canEdit: false,
          canDelete: false,
          canMessageClub: false,
          cancelledAt: ev.cancelled_at,
          cancelledByName: null,
          cancellationReason: null,
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
          tournamentId: null,
          tournamentEntryId: null,
          needsAction: false,
          resultLabel: null,
        })
      }
    }
  }

  for (const t of tournamentRows ?? []) {
    if (!t.id) continue
    // A tournament shows in the lane of every one of MY teams that is going.
    //
    // ONE OCCASION, SEVERAL LANES. A club taking U12 and U13 to the same
    // festival gets a row in each team's lane -- both carrying the SAME
    // tournament id, so opening either one lands on the same Tournament
    // Centre with that team already selected. There is never a second
    // tournament record, and never a second name to keep in step.
    const myEntries = (tournamentEntryRows ?? []).filter((e) => e.tournament_id === t.id && teamIds.includes(e.team_id))
    const myParticipant = (tournamentParticipantRows ?? []).find(
      (p) => p.tournament_id === t.id && p.team_id !== null && teamIds.includes(p.team_id)
    )
    const iAmHost = Boolean(t.host_team_id && teamIds.includes(t.host_team_id))
    // Legacy host-and-invite tournaments carry no entries; they still show in
    // the lane of the host team or the accepted participant, exactly as before.
    const lanes: { teamId: string | null; entryId: string | null }[] =
      myEntries.length > 0
        ? myEntries.map((e) => ({ teamId: e.team_id, entryId: e.id }))
        : [{ teamId: iAmHost ? (t.host_team_id ?? null) : (myParticipant?.team_id ?? null), entryId: null }]

    const startsOn = t.event_date ?? ""
    const endsOn = t.ends_on ?? startsOn
    const spanStart = startsOn > startIso ? startsOn : startIso
    const spanEnd = endsOn < endIso ? endsOn : endIso

    for (const lane of lanes) {
    const laneId = laneIdFor(lane.teamId, null)
    if (!laneId) continue
    if (teamFilter && laneId !== teamFilter) continue
    const participants = participantsByTournamentId.get(t.id) ?? []
    const hostName = hostDirectoryNameById.get(t.host_directory_id ?? "") ?? "Host"
    const tournamentVenue = t.venue_id ? tournamentVenueById.get(t.venue_id) : null
    // A multi-day festival is ONE tournament rendered across the days it runs
    // -- the same span treatment a multi-day club event already gets, and the
    // same tournamentId on every cell.
    for (let d = spanStart; d <= spanEnd; d = toIso(addDays(new Date(`${d}T00:00:00`), 1))) {
    const position: "starts" | "continues" | "ends" = d === startsOn ? "starts" : d === endsOn ? "ends" : "continues"
    entries.push({
      // Unique per lane and day so React and the day grouping stay honest,
      // while tournamentId remains the one stable identity everything links by.
      id: `tournament-${t.id}-${lane.entryId ?? "host"}-${d}`,
      tournamentId: t.id,
      tournamentEntryId: lane.entryId,
      laneId,
      kind: "tournament",
      date: d,
      time: position === "starts" ? t.kickoff_time : null,
      spanPosition: startsOn === endsOn ? null : position,
      spanNote: startsOn === endsOn ? null : formatEventDateRange(startsOn, endsOn),
      title: t.name ?? `Tournament · ${hostName}`,
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
      canDelete: false,
      canMessageClub: false,
      cancelledAt: null,
      cancelledByName: null,
      cancellationReason: null,
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
    }
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""))

  // ---- Family-facing Venue and Attendance filters ----------------------
  //
  // Only in a Guardian/Player context, and only there because attendance is
  // per-PLAYER: in a club or team context there is no single "my response"
  // to filter on, and offering the control would promise something the data
  // cannot answer.
  //
  // Two children with different answers to the same fixture are never
  // collapsed into one family status. The entry survives the filter if ANY
  // child in scope matches it, which keeps a shared fixture visible to a
  // parent filtering on "Attending" without inventing a status for the
  // sibling who said no.
  const venueFilter = venueParam && venueParam.length > 0 ? venueParam : null
  const attendanceFilter = attendanceParam && attendanceParam.length > 0 ? attendanceParam : null
  const familyFacing = isFamilyFacingContext(boardContext.kind)

  const venueOptionsForFilter = familyFacing
    ? Array.from(new Set(entries.map((e) => e.venueAddress ?? e.pitchName).filter((v): v is string => Boolean(v)))).sort((a, b) => a.localeCompare(b))
    : []

  let calendarEntries = entries
  if (familyFacing && (venueFilter || attendanceFilter)) {
    let responseKeys: Set<string> | null = null
    if (attendanceFilter) {
      const scopedPlayerIds = Array.from(
        new Set([...ctx.guardianRelationships.map((g) => g.playerId), ...ctx.linkedPlayerTeams.map((p) => p.playerId)])
      )
      const { data: responses } = scopedPlayerIds.length
        ? await supabase.from("player_fixture_attendance").select("fixture_id, training_session_id, player_id, status").in("player_id", scopedPlayerIds)
        : { data: [] }
      if (attendanceFilter === "needs_response") {
        // Answered events, so the filter can keep everything that is NOT here.
        responseKeys = new Set((responses ?? []).map((r) => `${r.fixture_id ?? r.training_session_id}`))
      } else {
        responseKeys = new Set((responses ?? []).filter((r) => r.status === attendanceFilter).map((r) => `${r.fixture_id ?? r.training_session_id}`))
      }
    }

    calendarEntries = entries.filter((e) => {
      if (venueFilter && (e.venueAddress ?? e.pitchName) !== venueFilter) return false
      if (responseKeys) {
        // Tournaments carry no per-player attendance, so an attendance
        // filter simply does not describe them.
        if (e.kind === "tournament") return false
        const answered = responseKeys.has(e.id)
        if (attendanceFilter === "needs_response" ? answered : !answered) return false
      }
      return true
    })
  }

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
    !isFamilyFacingContext(boardContext.kind) && (canScheduleTrainingClubWide || manageableTeamIds.size > 0)

  // Pitch Allocation tab visibility -- Section 22-25: club-scoped
  // fixture.edit only (Club Admin/Fixture Secretary), never available
  // merely because someone can view Calendar, and never for a team-scoped
  // Team Admin/Coach's narrower grant (their fixture.edit is at team
  // scope, which this club-scope check does not satisfy).
  const canManagePitchAllocation = boardContext.kind === "club" && boardContext.id ? await hasCapability(supabase, "fixture.edit", "club", { clubId: boardContext.id }) : false
  // Creating a tournament commits the club's teams and its Saturday, so it is
  // club-scope tournament authority -- the same capability save_tournament
  // re-checks in the database. Slice 4D moved this off the deprecated
  // calendar.manage key onto tournament.tournament.manage, which is the key the
  // catalogue actually defines for the occasion (design J.8 line 490).
  const canCreateTournament = boardContext.kind === "club" && boardContext.id ? await hasCapability(supabase, "tournament.tournament.manage", "club", { clubId: boardContext.id }) : false

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
        supabase.from("teams").select("id, display_name, rugby_code, category, age_group, gender, squad_designation").eq("club_id", trainingClubId).eq("active", true).order("display_name"),
        supabase.from("scheduling_groups").select("id, display_tag, alias").eq("club_id", trainingClubId).eq("active", true),
        supabase.from("club_pitches").select("id, display_name").eq("club_id", trainingClubId).eq("active", true).order("sort_order"),
      ])
      trainingTargets = [
        ...(clubTeams ?? []).map((t) => ({
          value: t.id,
          label: compactTeamLabel({ category: t.category, ageGroup: t.age_group, gender: t.gender, squadDesignation: t.squad_designation, rugbyCode: t.rugby_code }),
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
  // ---- SEASON GRID. A pure arrangement of the events already authorised
  // and fetched above -- it performs no query of its own, so it cannot widen
  // anything. Weeks come from the canonical range; the expanded week comes
  // from the URL, so back/forward and a shared link both work. ----
  const seasonMonths =
    view === "season"
      ? buildSeasonGrid(
          // The CANONICAL season start, not the Monday the read window was
          // widened back to. The query deliberately reaches back to the start
          // of that week so the season's opening days are not missed; the grid
          // must still be told when the season actually begins, or it files
          // the opening week under the previous month and draws a month header
          // for a month the season does not contain. buildSeasonGrid aligns to
          // Monday itself.
          range?.start ?? toIso(rangeStart),
          toIso(rangeEnd),
          calendarEntries.map(
            (e): SeasonGridEvent => ({
              // An event's canonical id, so the same event projected across
              // several days and lanes counts once per week rather than once
              // per square it happens to touch.
              id: e.kind === "event" ? (e.eventId ?? e.id) : e.id,
              kind: e.kind === "training" ? "training" : e.kind === "event" ? "event" : "fixture",
              date: e.date,
              time: e.time,
              homeAway: e.homeAway ?? "",
              // An event's identity is its NAME, not a team -- it may belong
              // to several teams or to the whole club.
              teamDisplayName: e.kind === "event" ? e.title : e.teamDisplayName,
              opposition: e.opposition,
              laneId: e.laneId,
              status: e.status,
              venue: e.pitchName ?? e.venueAddress ?? null,
              spanNote: e.spanNote ?? null,
              canEdit: Boolean(e.canEdit),
            })
          )
        )
      : []
  // ---- The week whose detail panel is open. Resolved by looking the anchor
  // up in the grid the viewer can actually see, so a hand-edited ?week= that
  // is out of range, malformed, or filtered away simply opens nothing. ----
  const selectedSeasonWeekRow =
    view === "season" && weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam)
      ? (seasonMonths.flatMap((m) => m.weeks).find((w) => w.startIso === weekParam) ?? null)
      : null
  const selectedSeasonWeek = selectedSeasonWeekRow?.startIso ?? null
  // The weeks either side, taken from the same flattened grid the tiles are
  // drawn from, so stepping can never reach a week the grid does not show.
  const seasonWeekList = view === "season" ? seasonMonths.flatMap((m) => m.weeks) : []
  const selectedWeekIndex = selectedSeasonWeek ? seasonWeekList.findIndex((w) => w.startIso === selectedSeasonWeek) : -1
  const prevSeasonWeekIso = selectedWeekIndex > 0 ? seasonWeekList[selectedWeekIndex - 1].startIso : null
  const nextSeasonWeekIso =
    selectedWeekIndex >= 0 && selectedWeekIndex < seasonWeekList.length - 1 ? seasonWeekList[selectedWeekIndex + 1].startIso : null
  const selectedWeekEntries = collapseMultiDay(selectedSeasonWeekRow?.events ?? [])
  const selectedWeekTitle = selectedSeasonWeekRow ? `Week ${selectedSeasonWeekRow.weekNumber}` : ""
  // "Mon 7 Sept – Sun 13 Sept 2026". Assembled rather than taken straight from
  // toLocaleDateString, which punctuates the two ends differently once a year
  // is added to only one of them ("Mon 7 Sept – Sun, 13 Sept 2026").
  const weekBound = (iso: string, withYear: boolean) => {
    const d = new Date(`${iso}T00:00:00`)
    const weekday = d.toLocaleDateString("en-GB", { weekday: "short" })
    const day = d.getDate()
    const month = d.toLocaleDateString("en-GB", { month: "short" })
    return `${weekday} ${day} ${month}${withYear ? ` ${d.getFullYear()}` : ""}`
  }
  const selectedWeekSubtitle = selectedSeasonWeekRow
    ? `${weekBound(selectedSeasonWeekRow.startIso, false)} – ${weekBound(selectedSeasonWeekRow.endIso, true)}`
    : ""
  const selectedWeekCountLabel =
    selectedWeekEntries.length > 0 ? `${selectedWeekEntries.length} ${selectedWeekEntries.length === 1 ? "Event" : "Events"}` : ""

  const monthLabel = view === "month" ? monthAnchor.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : ""
  const monthStartIso = view === "month" ? toIso(monthAnchor) : ""

  const baseParams = { team: teamFilter, view: view === "week" ? null : view, season: seasonParam ?? null, phase: phaseParam ?? null, status: statusFilters[0], ha, kind }
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

  // ---- Filter-bar state.
  //
  // "More Filters" is offered only where it holds something the visible
  // controls do not. Event type, match location and team are all on the
  // surface now, so for most viewers the sheet would be a second door into
  // the same room -- which is precisely the confusion worth removing. Venue
  // and attendance exist only for family-facing viewers, and status only
  // where a status is already applied, so those are the cases that keep it.
  const showMoreFilters = familyFacing || statusFilters.length > 0
  const hasActiveFilters = Boolean(kind || ha || teamFilter || venueFilter || attendanceFilter || statusFilters.length > 0)

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
        contextLabel={boardContext.label}
        selectedSeason={selectedSeason}
        selectedPhase={selectedPhase}
        prevSeason={prevSeason}
        nextSeason={nextSeason}
      />

      {/* ---- VIEW, then FILTERS. Two jobs, two blocks.

           These used to sit on one line with the Agenda and Pitch Allocation
           links, so choosing how to look at the season, narrowing what is
           shown, and leaving for another surface entirely all had the same
           visual weight. They are separated here, and the two navigation
           links are demoted to a secondary area on the right: Agenda is an
           adjacent planning surface and Pitch Allocation is a management one,
           and neither is a Calendar view. ---- */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="Calendar View"
          size="lg"
          options={[
            { value: null, label: "Week" },
            { value: "month", label: "Month" },
            // SEASON. Offered only where a canonical season window actually
            // resolves -- a view whose whole premise is "the shape of the
            // year" has nothing to draw without one, and offering a dead tab
            // would be worse than not offering it.
            ...(range ? [{ value: "season", label: "Season" }] : []),
          ]}
          active={view === "week" ? null : view}
          hrefFor={(v) => `/calendar${qs({ ...baseParams, view: v, week: null, month: null })}`}
        />

        <div className="flex items-center gap-1 text-sm">
          <Link
            href="/calendar/agenda"
            className="inline-flex min-h-11 items-center rounded-lg px-3 font-medium text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none sm:min-h-9"
          >
            Agenda
          </Link>
          {canManagePitchAllocation && (
            <>
              <span aria-hidden="true" className="h-4 w-px bg-ink/12" />
              <Link
                href="/calendar/pitch-allocation"
                className="inline-flex min-h-11 items-center rounded-lg px-3 font-medium text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none sm:min-h-9"
              >
                Pitch Allocation
              </Link>
            </>
          )}
          {/* A tournament is created from the Calendar, because that is where
              an organiser is when they realise the club is going to one. Same
              club-scope authority the RPC re-checks. */}
          {canCreateTournament && (
            <>
              <span aria-hidden="true" className="h-4 w-px bg-ink/12" />
              <Link
                href="/tournaments/new"
                className="inline-flex min-h-11 items-center rounded-lg px-3 font-medium text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none sm:min-h-9"
              >
                New Tournament
              </Link>
            </>
          )}
        </div>
      </div>

      {/* ---- THE FILTER BAR. One container, so "what am I looking at" reads
           as a single question rather than as four unrelated controls.

           Event Type and Match Location were already honoured by the queries
           and had no visible control at all outside the sheet, so a Calendar
           could be filtered with nothing on screen saying so.

           Match Location is offered only when matches are in scope: a
           training session has no home or away, and offering the choice
           beside "Training" would invite a filter that can only ever empty
           the page.

           More Filters survives only where it holds something these controls
           do not -- venue and attendance, which exist for family-facing
           viewers. Where it would merely repeat what is already on screen it
           is not rendered, because two controls for one job is the confusion
           worth removing. ---- */}
      <div className="mt-3 rounded-2xl border border-ink/8 bg-white p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <SegmentedControl
            label="Event Type"
            options={[
              { value: null, label: "All Events" },
              { value: "fixture", label: "Matches" },
              { value: "training", label: "Training" },
            ]}
            active={kind ?? null}
            hrefFor={(v) => `/calendar${qs({ ...baseParams, kind: v, ha: v === "training" ? null : (ha ?? null) })}`}
          />
          {kind !== "training" && (
            <SegmentedControl
              label="Match Location"
              options={[
                { value: null, label: "All Locations" },
                { value: "home", label: "Home" },
                { value: "away", label: "Away" },
              ]}
              active={ha ?? null}
              hrefFor={(v) => `/calendar${qs({ ...baseParams, ha: v })}`}
            />
          )}

          {/* THE TEAM CHOICE, only where there is genuinely a choice. A
              viewer with one team is not offered a picker containing it. */}
          {fullLanes.length > 1 && (
            <TeamFilterBar lanes={fullLanes} activeTeam={teamFilter ?? null} baseParams={baseParams} />
          )}

          <div className="ml-auto flex items-center gap-2">
            {showMoreFilters && (
              <FilterSheet
                activeStatuses={statusFilters}
                activeHomeAway={ha ?? null}
                activeKind={kind ?? null}
                activeTeam={teamFilter ?? null}
                activeWeek={weekParam ?? null}
                activeSeason={seasonParam ?? null}
                activePhase={phaseParam ?? null}
                activeView={viewParam ?? null}
                activeVenue={venueFilter}
                activeAttendance={attendanceFilter}
                venueOptions={venueOptionsForFilter}
                showFamilyFilters={familyFacing}
              />
            )}
            {hasActiveFilters && (
              <Link
                href={`/calendar${qs({ ...baseParams, kind: null, ha: null, status: null, team: null, venue: null, attendance: null })}`}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-forest-800 transition-colors hover:bg-forest-950/6 hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none sm:min-h-9"
              >
                <X className="size-3.5" aria-hidden="true" />
                Clear Filters
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Date navigation -- Week and Month only.

          SEASON HAS NO PERIOD TO STEP THROUGH. Its range IS the canonical
          season window, so a previous/next control here had nothing to move:
          both arrows resolved to the URL already open, and the label repeated
          the season name the header above states. Two dead arrows flanking a
          duplicate label is worse than no control, and stepping between
          SEASONS is what the header's own stepper already does. */}
      {view !== "season" && (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Link
            href={canGoPrev ? `/calendar${qs({ ...baseParams, week: view === "week" ? prevWeekIso : null, month: view === "month" ? prevMonthYm : null })}` : "#"}
            aria-disabled={!canGoPrev}
            tabIndex={canGoPrev ? undefined : -1}
            className={cn(
              "flex size-11 items-center justify-center rounded-md border border-ink/15 text-ink/60 outline-none hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-pitch-400 sm:size-8",
              !canGoPrev && "pointer-events-none opacity-30"
            )}
            aria-label={view === "week" ? "Previous week" : "Previous month"}
          >
            <ChevronLeft className="size-4" />
          </Link>
          <p className="min-w-[11rem] text-center text-sm font-medium text-ink">
            {view === "week" ? weekLabel : view === "month" ? monthLabel : (selectedSeason?.name ?? "Season")}
          </p>
          <Link
            href={canGoNext ? `/calendar${qs({ ...baseParams, week: view === "week" ? nextWeekIso : null, month: view === "month" ? nextMonthYm : null })}` : "#"}
            aria-disabled={!canGoNext}
            tabIndex={canGoNext ? undefined : -1}
            className={cn(
              "flex size-11 items-center justify-center rounded-md border border-ink/15 text-ink/60 outline-none hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-pitch-400 sm:size-8",
              !canGoNext && "pointer-events-none opacity-30"
            )}
            aria-label={view === "week" ? "Next week" : "Next month"}
          >
            <ChevronRight className="size-4" />
          </Link>
        </div>
        {(weekParam || (monthParam && monthParam !== currentMonthYm)) && (
          <Link href={`/calendar${qs({ ...baseParams })}`} className="inline-flex min-h-11 items-center text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950">
            Back to Today
          </Link>
        )}
      </div>
      )}

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

          {/* The team choice lives in the filter bar above, once. It used to
              be rendered here as well, so a club saw the same eighteen chips
              twice on one screen. */}

          {/* Desktop: lanes/grid. Mobile: always the compact agenda list --
              never a squeezed grid or lanes board. Pre-Season gets a subtle
              tinted frame around the grid itself (Section 9: the two phases
              must not read as visually identical besides the toggle). */}
          {view === "season" ? (
            /* SEASON. One layout, both widths -- the week tiles re-flow from
               three columns to one rather than shrinking a desktop grid into
               unreadability, so this deliberately sits outside the
               desktop-only wrapper below. */
            <div className={cn("mt-6 flex flex-col gap-3", selectedPhase === "pre" && "rounded-xl border border-forest-950/10 bg-forest-950/[0.025] p-2")}>
              <SeasonSummary months={seasonMonths} filtered={hasActiveFilters} />
              <SeasonGrid
                months={seasonMonths}
                todayIso={todayIso}
                selectedWeek={selectedSeasonWeek}
                weekHref={(startIso) => `/calendar${qs({ ...baseParams, week: startIso })}`}
                seasonStartsOnIso={selectedSeason?.startsOn ?? null}
                periodStartIso={range?.start ?? todayIso}
                periodEndIso={range?.end ?? todayIso}
                periodNoun={selectedPhase === "pre" ? "pre-season" : "this season"}
              />
              {/* The week panel. Its contents are rendered here, on the
                  server, from the same authorised entries the grid counts --
                  the dialog is a presentation shell and decides nothing. */}
              <WeekDetailDialog
                open={selectedSeasonWeek !== null}
                closeHref={`/calendar${qs({ ...baseParams, week: null })}`}
                title={selectedWeekTitle}
                subtitle={selectedWeekSubtitle}
                countLabel={selectedWeekCountLabel}
                prevWeekHref={prevSeasonWeekIso ? `/calendar${qs({ ...baseParams, week: prevSeasonWeekIso })}` : null}
                nextWeekHref={nextSeasonWeekIso ? `/calendar${qs({ ...baseParams, week: nextSeasonWeekIso })}` : null}
              >
                {selectedWeekEntries.length === 0 ? (
                  <p className="px-1 py-3 text-sm text-ink-muted">Nothing is scheduled this week.</p>
                ) : (
                  /* GROUPED BY DAY. A rugby week is lived a day at a time --
                     "what have we got Saturday" -- and a flat list of nine
                     rows makes the reader parse a date column to find out.
                     The days are already in order from the grid builder. */
                  <div className="flex flex-col gap-4">
                    {groupEntriesByDay(selectedWeekEntries).map((day) => (
                      <section key={day.iso} aria-label={day.label}>
                        <h4 className="px-1 text-[11px] font-semibold tracking-[0.08em] text-ink-subtle uppercase">{day.label}</h4>
                        <ul className="mt-1.5 flex flex-col gap-1.5">
                          {day.entries.map((e) => (
                            <li key={`${e.kind}-${e.id}`}>
                              <SeasonWeekEvent entry={e} />
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                )}
              </WeekDetailDialog>
            </div>
          ) : null}

          <div className={cn("mt-6 hidden md:block", view === "season" && "md:hidden", selectedPhase === "pre" && "rounded-xl border border-forest-950/10 bg-forest-950/[0.025] p-2")}>
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
                entries={calendarEntries}
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
                entries={calendarEntries}
                clubId={boardContext.kind === "club" ? boardContext.id : null}
                clubName={boardContext.label}
                rugbyCode={clubRugbyCode}
                season={selectedSeason ? { id: selectedSeason.id, label: selectedSeason.name } : null}
                competitions={competitionOptions}
                pitches={trainingPitches}
              />
            )}
          </div>

          <div className={cn("mt-6 md:hidden", view === "season" && "hidden")}>
            <MobileAgenda
              entries={calendarEntries}
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
          : "This part of the calendar is temporarily unavailable. Please check back later or contact your Club Admin."}
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
              Add Fixture
            </Link>
          )}
          {canScheduleTraining && <p className="self-center text-xs text-ink-muted">Use &ldquo;Schedule Training&rdquo; above to add a session.</p>}
        </div>
      )}
    </div>
  )
}

/**
 * ONE SEGMENTED CONTROL, used for every mutually-exclusive choice on this page
 * -- the view, the event type, the match location.
 *
 * Sharing it is the point: three controls that do the same kind of job used to
 * be three slightly different sets of classes, which is how a toolbar starts
 * looking assembled rather than designed. The active option is STATED rather
 * than implied -- `aria-current` for a screen reader, a filled pill visually --
 * so "All Events" being selected is never something the reader has to infer
 * from the absence of a highlight elsewhere.
 *
 * `size="lg"` is the view switcher, which is a navigation choice and outranks
 * the filters beneath it; everything else takes the quieter default.
 */
function SegmentedControl({
  label,
  options,
  active,
  hrefFor,
  size = "md",
}: {
  label: string
  options: { value: string | null; label: string }[]
  active: string | null
  hrefFor: (value: string | null) => string
  size?: "md" | "lg"
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-xl p-1",
        size === "lg" ? "border border-ink/10 bg-white shadow-[0_1px_2px_rgba(16,21,18,0.04)]" : "bg-chalk"
      )}
    >
      {options.map((o) => {
        const isActive = (o.value ?? null) === active
        return (
          <Link
            key={o.label}
            href={hrefFor(o.value)}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "inline-flex items-center rounded-lg font-medium transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none",
              size === "lg" ? "min-h-11 px-4 text-sm sm:min-h-9" : "min-h-11 px-3 text-[13px] sm:min-h-8",
              isActive ? "bg-forest-950 text-white shadow-sm" : "text-ink-muted hover:bg-white hover:text-ink"
            )}
          >
            {o.label}
          </Link>
        )
      })}
    </div>
  )
}

/**
 * One event inside an expanded Season week.
 *
 * WHERE AN EVENT OPENS DEPENDS ON WHAT THE VIEWER CAME TO DO.
 *
 * A parent, player or guardian opens the event itself: a fixture goes to Match
 * Centre, a training session to Training Centre. They are never routed into
 * Fixture Management or the Training Scheduler, which are not theirs.
 *
 * A viewer who holds operational edit authority over THIS event opened Calendar
 * to run the season, and the management surface is the answer to what they
 * came for -- so it leads, and the shared viewing surface is offered beside it
 * as a named action rather than assumed to be the destination. Both routes are
 * always reachable; only their order changes.
 *
 * Authority comes from the entry's own `canEdit`, computed upstream by the
 * capability engine per event -- never from a role name read here, and never
 * recomputed. Every destination is a canonical route: the Calendar routes to
 * Match Centre, Training Centre and the management surfaces, and clones none
 * of them.
 */
function SeasonWeekEvent({ entry }: { entry: SeasonGridEvent }) {
  const isFixture = entry.kind === "fixture"
  const isEvent = entry.kind === "event"
  // The same rule for all three kinds: a participant opens the Centre; a
  // viewer with management authority is routed to the canonical editor first
  // and offered the Centre beside it. No Calendar-local editor for any of them.
  const centreHref = isEvent ? `/events/${entry.id}` : isFixture ? `/fixtures/${entry.id}` : `/training/${entry.id}`
  const manageHref = isEvent ? `/club/events?event=${entry.id}` : isFixture ? `/admin/fixtures/${entry.id}` : "/club/training"
  const centreLabel = isEvent ? "View Event Centre" : isFixture ? "View Match Centre" : "View Training Centre"
  const manageLabel = isEvent ? "Manage Event" : isFixture ? "Manage Fixture" : "Manage Training"

  // A multi-day event has no single time to state, and an event with no start
  // time recorded is all-day -- neither is "Time TBC", which claims a time
  // exists and has not been decided.
  const time = entry.spanNote ? "Runs" : entry.time ? String(entry.time).slice(0, 5) : isEvent ? "All day" : "Time TBC"
  const title = isEvent
    ? entry.teamDisplayName || "Club Event"
    : isFixture
      ? `${entry.teamDisplayName} v ${entry.opposition || "Opposition to be confirmed"}`
      : entry.teamDisplayName || "Training"
  const isAway = entry.homeAway === "Away"
  const isHome = entry.homeAway === "Home"

  const card = (
    <>
      {/* Time leads: it is the first thing anyone wants off a week's list. */}
      <span className="flex w-12 shrink-0 flex-col items-start pt-0.5">
        <span className="text-sm leading-none font-semibold text-ink tabular-nums">{time}</span>
      </span>

      <span
        aria-hidden="true"
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg",
          isEvent ? "bg-[#6d3b5d]/10 text-[#6d3b5d]" : isFixture ? "bg-forest-800/10 text-forest-900" : "bg-ink/6 text-ink-muted"
        )}
      >
        {isEvent ? <CalendarHeart className="size-3.5" /> : isFixture ? <MapPin className="size-3.5" /> : <Dumbbell className="size-3.5" />}
      </span>

      <span className="min-w-0 flex-1">
        {/* Wraps rather than truncates: "Under 12 Girls v Rossen..." tells a
            parent almost nothing, and the panel has the width to spare. */}
        <span className="block text-sm leading-snug font-medium text-ink">{title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-muted">
          {/* Type and side as words, never as colour alone. */}
          <span className={cn("font-medium", isEvent ? "text-[#6d3b5d]" : isFixture ? "text-forest-900" : "text-ink-muted")}>
            {isEvent ? "Club Event" : isFixture ? (isHome ? "Home" : isAway ? "Away" : "Venue TBC") : "Training"}
          </span>
          {entry.spanNote && (
            <>
              <span aria-hidden="true" className="text-ink/25">
                &middot;
              </span>
              <span className="min-w-0">{entry.spanNote}</span>
            </>
          )}
          {entry.venue && (
            <>
              <span aria-hidden="true" className="text-ink/25">
                &middot;
              </span>
              <span className="min-w-0 truncate">{entry.venue}</span>
            </>
          )}
        </span>
      </span>
    </>
  )

  const cardClass =
    "flex min-h-11 w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-chalk focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none focus-visible:ring-inset"

  // A viewer with no edit authority gets the one destination that is theirs,
  // and no second control competing with it.
  if (!entry.canEdit) {
    return (
      <Link href={centreHref} className={cn(cardClass, "rounded-xl border border-ink/10 bg-white hover:border-ink/20")}>
        {card}
        <ChevronRight className="mt-1 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
      </Link>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
      <Link href={manageHref} className={cardClass} aria-label={`${manageLabel}: ${title}`}>
        {card}
        <Settings2 className="mt-1 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
      </Link>
      {/* The shared surface, named rather than implied. Same event, same
          canonical route every other viewer uses -- Match Centre and Training
          Centre are one surface each, and this is a way in, not a variant. */}
      <div className="border-t border-ink/8 bg-chalk/60 px-3">
        <Link
          href={centreHref}
          className="inline-flex min-h-11 items-center text-xs font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
        >
          {centreLabel}
        </Link>
      </div>
    </div>
  )
}

/**
 * ONE ROW PER EVENT, however many of the week's days it covers.
 *
 * The grid deliberately projects a multi-day event onto every day it touches,
 * because that is what makes the shape of a week honest. A LIST is a different
 * job: repeating "Centenary Week" seven times under seven day headings turned
 * two things happening into eight rows and made the panel's own count wrong.
 * Here it appears once, on its first day inside this week, carrying its span.
 */
function collapseMultiDay(entries: SeasonGridEvent[]): SeasonGridEvent[] {
  const seen = new Set<string>()
  return entries.filter((e) => {
    if (e.kind !== "event") return true
    if (seen.has(e.id)) return false
    seen.add(e.id)
    return true
  })
}

/**
 * A week's events, grouped into the days they fall on.
 *
 * The grid builder already ordered them by date then time, so this only has to
 * cut the run into days -- no re-sorting, and therefore no chance of the panel
 * disagreeing with the order the grid counted them in.
 */
function groupEntriesByDay(entries: SeasonGridEvent[]): { iso: string; label: string; entries: SeasonGridEvent[] }[] {
  const days: { iso: string; label: string; entries: SeasonGridEvent[] }[] = []
  for (const e of entries) {
    const last = days[days.length - 1]
    if (last && last.iso === e.date) {
      last.entries.push(e)
      continue
    }
    days.push({
      iso: e.date,
      label: new Date(`${e.date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }),
      entries: [e],
    })
  }
  return days
}
