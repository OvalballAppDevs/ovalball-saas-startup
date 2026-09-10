import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { isPrimaryMirror } from "@/lib/fixtures/mirror-pair"
import { compactTeamLabel, fullTeamLabel } from "@/lib/teams/compact-label"
import { loadTeamIdentitiesForSeason, teamIdentityKey } from "@/lib/mini-rugby/team-identity.server"
import { effectiveFixtureParticipants } from "@/lib/mini-rugby/effective-teams"
import { loadGroupMemberTeamIds } from "@/lib/mini-rugby/effective-teams.server"
import { loadOpponentGroupLabels } from "@/lib/calendar/resolve-entry-participant"
import { resolveHomeAwayGroupIds } from "@/lib/fixtures/resolve-home-away-groups"
import { detectConflicts, partitionAllocation } from "@/lib/pitch-allocation/auto-allocate"
import { detectResourceConflicts, type TrainingConflict, type TrainingOccupancy } from "@/lib/pitch-allocation/training-conflicts"
import { detectTournamentConflicts, occupantsFromFixtures, occupantsFromSpans, type TournamentConflict } from "@/lib/pitch-allocation/tournament-conflicts"
import { DEFAULT_SCHEDULING_POLICY, type AllocationConflict, type AllocationFixture, type ClubSchedulingPolicy, type PitchOption, type TournamentSummary } from "@/lib/pitch-allocation/types"
import type { Database } from "@/types/database.types"

export interface PitchAllocationBoard {
  fixtures: AllocationFixture[]
  unallocated: AllocationFixture[]
  pitches: PitchOption[]
  policy: ClubSchedulingPolicy
  conflicts: AllocationConflict[]
  rugbyCode: "union" | "league" | null
  /** Section 79: confirmed tournaments this club is hosting today -- lives in its own table, never in `fixtures`, so it must be surfaced here explicitly rather than leaving the board silently blind to it. */
  tournaments: TournamentSummary[]
  /** Reservations that genuinely clash with something unrelated. Siblings of one occasion are never listed here. */
  tournamentConflicts: TournamentConflict[]
  /** SIDE PROJECT 2 -- Training Management (Section 32-38): read-only physical commitments sharing the same pitches as fixtures. Training is never converted into a fake fixture (Section 59) -- it is its own array, rendered as its own card type, and never counted in board.fixtures.length. */
  trainingSessions: TrainingOccupancy[]
  trainingConflicts: TrainingConflict[]
  fixtureConflictsFromTraining: { fixtureId: string; severity: "hard" | "warning"; reason: string }[]
  /**
   * Club events reserving a pitch today.
   *
   * READ FROM THE SAME RELATIONSHIP THE EVENT ITSELF OWNS -- public
   * .club_event_pitches -- so there is no second, hand-maintained allocation
   * copy to keep in step. Reserve a pitch on the event and it is occupied
   * here; remove it there and it is free here, with no secondary edit.
   *
   * Its own array and its own card type, exactly as training is: an event is
   * never converted into a fake fixture, and never counted in
   * board.fixtures.length.
   */
  clubEvents: EventOccupancy[]
  /**
   * Where the warm-up/pack-up in `policy` came from: this club's own setting,
   * or the platform default it inherits. Shown to an administrator so a value
   * is never in effect without a visible reason.
   */
  bufferSource: "club" | "platform"
}

/** A club event's physical claim on a pitch for the day being viewed. */
export interface EventOccupancy {
  eventId: string
  name: string
  pitchId: string
  startsOn: string
  endsOn: string
  startTime: string | null
  endTime: string | null
  isMultiDay: boolean
}

/**
 * CANONICAL FIXTURE SOURCE for the whole Pitch Allocation feature: reads
 * directly from public.fixtures (the same table Week/Month/Agenda/Fixture
 * Management/Fixture Detail all read), using the GENERATED home_team_id
 * column -- not `owning_team_id` alone -- so a fixture where this club is
 * the accepting/opponent side but genuinely playing at home is still
 * correctly included (Section 6's "home fixtures only" scope, matching
 * this codebase's own established Master Fixture Registry convention:
 * "my team on either side" for read scope, but here narrowed specifically
 * to the HOME side via the generated column rather than either side).
 * Nothing here is written back to a second table -- this is a read-only
 * projection; every mutation goes through actions.ts's allocateFixture(),
 * which calls the existing update_fixture_pitch/kickoff/venue RPCs.
 */
export async function getPitchAllocationBoard(supabase: SupabaseClient<Database>, clubId: string, dateIso: string): Promise<PitchAllocationBoard> {
  const { data: club } = await supabase.from("clubs").select("directory_id").eq("id", clubId).maybeSingle()
  const { data: directory } = club ? await supabase.from("club_directory").select("rugby_code").eq("id", club.directory_id).maybeSingle() : { data: null }
  const rugbyCode = (directory?.rugby_code as "union" | "league" | null) ?? null

  const { data: teamRows } = await supabase.from("teams").select("id").eq("club_id", clubId)
  const teamIds = (teamRows ?? []).map((t) => t.id)

  const { data: pitchRows } = await supabase
    .from("club_pitches")
    .select("id, display_name, active, venue_id, size_category, lane_count")
    .eq("club_id", clubId)
    .order("sort_order")
  const pitches: PitchOption[] = (pitchRows ?? []).map((p) => ({
    id: p.id,
    displayName: p.display_name,
    active: p.active,
    venueId: p.venue_id,
    sizeCategory: p.size_category as PitchOption["sizeCategory"],
    laneCount: p.lane_count,
  }))

  // THE SCHEDULING BUFFERS COME FROM THE ONE RESOLVER, never from the code
  // constant. Club override -> platform default, in the database, so this
  // page and every other reader inherit the same hierarchy and "not
  // configured" can never silently mean "no warm-up required" again.
  const { data: buffers } = await supabase.rpc("resolve_club_scheduling_buffers", { p_club_id: clubId }).maybeSingle()

  const { data: policyRow } = await supabase.from("club_scheduling_policy").select("*").eq("club_id", clubId).maybeSingle()
  const policy: ClubSchedulingPolicy = policyRow
    ? {
        weekdayEarliestKickoff: policyRow.weekday_earliest_kickoff,
        weekendYouthEarliest: policyRow.weekend_youth_earliest,
        weekendYouthLatest: policyRow.weekend_youth_latest,
        weekendSeniorEarliest: policyRow.weekend_senior_earliest,
        weekendSeniorLatest: policyRow.weekend_senior_latest,
        turnaroundMinutes: policyRow.turnaround_minutes,
        autoAllocateHomeFixtures: policyRow.auto_allocate_home_fixtures,
        // Resolved, never read straight off the row -- a club row whose
        // buffers are unset inherits the platform's.
        warmUpMinutes: buffers?.warm_up_minutes ?? 0,
        packUpMinutes: buffers?.pack_up_minutes ?? 0,
      }
    : { ...DEFAULT_SCHEDULING_POLICY, warmUpMinutes: buffers?.warm_up_minutes ?? 0, packUpMinutes: buffers?.pack_up_minutes ?? 0 }

  const bufferSource: "club" | "platform" = buffers?.source === "club" ? "club" : "platform"

  const { data: rules } = await supabase.from("fixture_scheduling_rules").select("rugby_code, age_group, half_minutes, min_pitch_size_category, confidence")

  // A TOURNAMENT'S REAL HOLD ON A PITCH.
  //
  // Read from public.tournament_pitches -- the relationship the tournament
  // itself owns -- so there is no second, hand-maintained allocation copy to
  // keep in step. Reserve a pitch on the tournament and it is occupied here;
  // release it there and it is free here, with no secondary edit. This
  // replaces an earlier approximation that treated a tournament's single
  // legacy pitch_id as booked for the WHOLE day: a festival that finishes at
  // 14:00 does not hold the pitch until midnight, and saying it does blocked
  // an evening that was in fact free.
  const { data: tournamentRows } = await supabase
    .from("tournament_pitches")
    .select("id, tournament_id, pitch_id, start_time, end_time, tournaments!inner(id, name, status, cancelled_at, host_club_id, venues(name)), club_pitches(display_name)")
    .eq("reserved_on", dateIso)
    .eq("tournaments.host_club_id", clubId)
    .is("tournaments.cancelled_at", null)

  // Which of this club's teams are attending, for the board card's own label.
  // One batched query for every tournament on the day -- never one per card.
  const tournamentIdsToday = Array.from(new Set((tournamentRows ?? []).map((r) => r.tournament_id)))
  const { data: tournamentEntryRows } = tournamentIdsToday.length > 0
    ? await supabase
        .from("tournament_team_entries")
        .select("tournament_id, teams(display_name)")
        .in("tournament_id", tournamentIdsToday)
    : { data: [] }
  const teamLabelsByTournament = new Map<string, string[]>()
  for (const row of tournamentEntryRows ?? []) {
    const list = teamLabelsByTournament.get(row.tournament_id) ?? []
    if (row.teams?.display_name) list.push(row.teams.display_name)
    teamLabelsByTournament.set(row.tournament_id, list)
  }

  const tournaments: TournamentSummary[] = (tournamentRows ?? []).map((r) => ({
    id: r.id,
    tournamentId: r.tournament_id,
    tournamentName: r.tournaments?.name ?? "Tournament",
    teamLabels: (teamLabelsByTournament.get(r.tournament_id) ?? []).sort(),
    pitchId: r.pitch_id,
    pitchDisplayName: r.club_pitches?.display_name ?? null,
    venueName: r.tournaments?.venues?.name ?? null,
    startTime: r.start_time as string,
    endTime: r.end_time as string,
    status: r.tournaments?.status ?? "confirmed",
  }))

  // SIDE PROJECT 2 -- Training Management: batched, one query, joined to
  // teams/team_aliases for the label (Section 54 -- no per-card N+1).
  // Reads the SAME canonical public.training_sessions table Training
  // Management and Team Admin also read -- never a second source.
  const { data: trainingRows } = teamIds.length > 0
    ? await supabase
        .from("training_sessions")
        .select("id, team_id, occurrence_date, start_time, duration_minutes, venue_id, pitch_id, status, source, teams(display_name, rugby_code, category, age_group, gender, squad_designation)")
        .in("team_id", teamIds)
        .eq("occurrence_date", dateIso)
    : { data: [] }
  const trainingTeamIds = Array.from(new Set((trainingRows ?? []).map((t) => t.team_id).filter((id): id is string => Boolean(id))))
  const { data: trainingAliasRows } = trainingTeamIds.length > 0 ? await supabase.from("team_aliases").select("team_id, alias").in("team_id", trainingTeamIds) : { data: [] }
  const trainingAliasByTeamId = new Map((trainingAliasRows ?? []).map((a) => [a.team_id, a.alias]))
  const trainingSessions: TrainingOccupancy[] = (trainingRows ?? []).map((t) => {
    const alias = t.team_id ? trainingAliasByTeamId.get(t.team_id) : null
    const label = t.teams ? fullTeamLabel({ category: t.teams.category ?? "youth", ageGroup: t.teams.age_group, gender: t.teams.gender, squadDesignation: t.teams.squad_designation, rugbyCode: t.teams.rugby_code, alias }) : "Team"
    return {
      trainingSessionId: t.id,
      teamLabel: label,
      venueId: t.venue_id,
      pitchId: t.pitch_id,
      sessionDate: t.occurrence_date ?? dateIso,
      startTime: t.start_time,
      durationMinutes: t.duration_minutes,
      status: t.status as "PLANNED" | "CANCELLED",
      source: t.source as "MANUAL" | "AUTOMATIC_PLAN",
    }
  })

  // CLUB EVENTS occupying a pitch on this date. The overlap test is the span
  // test, not an equality test: a centenary weekend booked Friday to Sunday
  // occupies its pitches on the Saturday too, and a `starts_on = today` filter
  // would have shown that Saturday as free.
  const { data: eventRows } = await supabase
    .from("club_events")
    .select("id, name, starts_on, ends_on, start_time, end_time, status, club_event_pitches(pitch_id)")
    .eq("club_id", clubId)
    .lte("starts_on", dateIso)
    .gte("ends_on", dateIso)
  const clubEvents: EventOccupancy[] = (eventRows ?? [])
    .filter((e) => e.status !== "CANCELLED")
    .flatMap((e) =>
      (e.club_event_pitches ?? [])
        .map((p) => p.pitch_id)
        .filter((id): id is string => Boolean(id))
        .map((pitchId) => ({
          eventId: e.id,
          name: e.name,
          pitchId,
          startsOn: e.starts_on,
          endsOn: e.ends_on,
          startTime: e.start_time,
          endTime: e.end_time,
          isMultiDay: e.ends_on > e.starts_on,
        }))
    )

  if (teamIds.length === 0) {
    return { fixtures: [], unallocated: [], pitches, policy, conflicts: [], rugbyCode, tournaments, tournamentConflicts: [], trainingSessions, trainingConflicts: [], fixtureConflictsFromTraining: [], clubEvents, bufferSource }
  }

  const { data: rawFixtureRows } = await supabase
    .from("fixtures")
    .select(
      "id, owning_team_id, opponent_team_id, home_team_id, away_team_id, status, kickoff_date, kickoff_time, venue_id, pitch_id, raw_opposition_text, owning_scheduling_group_id, opponent_scheduling_group_id, home_away, mirror_fixture_id, season_id, teams!fixtures_owning_team_id_fkey(display_name, rugby_code, category, age_group, gender, squad_designation, club_id), opponent:teams!fixtures_opponent_team_id_fkey(display_name, club_id)"
    )
    .in("home_team_id", teamIds)
    .eq("kickoff_date", dateIso)
    .neq("status", "Cancelled")
    // Section F/I: an archived (soft-deleted) fixture must stop occupying
    // pitch capacity exactly like a cancelled one already does -- the two
    // are orthogonal (Section G), so this needs its own explicit filter.
    .is("archived_at", null)

  /**
   * Section 1 root cause (live-reproduced on 2026-08-31, Burnley U12 v
   * Rossendale RUFC): a legacy mirror pair -- one row owned by each club,
   * both created together for the same real-world match -- both satisfy
   * `home_team_id = <this club's team>` once home_team_id is generated
   * from home_away, because the Away-side row's generated home_team_id
   * resolves to the *opponent_team_id*, which is this club's own team.
   * Left undeduped, the same fixture rendered TWICE on the board (as two
   * separate cards, "Under 12 v Rossendale RUFC" and "Team v U12").
   * admin_fixture_overview (Fixture Management's own source) already
   * solves this with a computed `is_primary_mirror` column defined as
   * `mirror_fixture_id IS NULL OR id < mirror_fixture_id`
   * (app/(app)/admin/fixtures/query.ts, "Reconciliation complaint 32") --
   * replicated here exactly so Pitch Allocation shows precisely the one
   * row Fixture Management treats as canonical, never a second one.
   */
  // Both halves of a pair ALWAYS arrive here (see the note above: the generated
  // home_team_id resolves to this club's team for both rows), so the database's
  // own is_primary_mirror rule applies exactly. lib/fixtures/mirror-pair.ts
  // holds it once, shared with Fixture Management's view definition.
  const fixtureRows = (rawFixtureRows ?? []).filter(isPrimaryMirror)

  const homeTeamIds = Array.from(new Set((fixtureRows ?? []).map((f) => f.home_team_id).filter((id): id is string => Boolean(id))))
  const { data: aliasRows } = homeTeamIds.length > 0 ? await supabase.from("team_aliases").select("team_id, alias").in("team_id", homeTeamIds) : { data: [] }
  const aliasByTeamId = new Map((aliasRows ?? []).map((a) => [a.team_id, a.alias]))

  const opponentClubIds = Array.from(new Set((fixtureRows ?? []).map((f) => f.opponent?.club_id).filter((id): id is string => Boolean(id))))
  const { data: opponentClubs } = opponentClubIds.length > 0 ? await supabase.from("clubs").select("id, status").in("id", opponentClubIds) : { data: [] }
  const activeOpponentClubIds = new Set((opponentClubs ?? []).filter((c) => c.status === "active").map((c) => c.id))

  // GROUP-VS-GROUP: resolve each side's real Mini-Rugby Group (never just
  // owning_scheduling_group_id -- a fixture's HOME side is the OPPONENT
  // column half the time, per the Master Fixture Registry's own "either
  // side may be home" model this file already documents above) via the
  // ONE shared predicate (resolveHomeAwayGroupIds), then batch-resolve
  // labels and real component team_ids through the same canonical
  // resolver/loaders the Calendar and group-vs-group passes established
  // -- never a second Mini-Rugby participant representation.
  const referencedGroupIds = (fixtureRows ?? []).flatMap((f) => {
    const { homeGroupId, awayGroupId } = resolveHomeAwayGroupIds(f)
    return [homeGroupId, awayGroupId]
  })
  const [groupLabelById, groupMemberTeamIds] = await Promise.all([
    loadOpponentGroupLabels(supabase, referencedGroupIds),
    loadGroupMemberTeamIds(supabase, referencedGroupIds.filter((id): id is string => Boolean(id))),
  ])

  // FUTURE-SEASON FIXTURE OWNERSHIP: age_group here isn't just a label --
  // resolveRule() below uses it to pick this fixture's real
  // duration/pitch-size rule, and auto-allocate.ts's age-preference
  // banding reads it too. Both must reflect the age this team WAS/WILL
  // BE for this fixture's own season, never today's live teams row.
  const pitchAllocationIdentityPairs = (fixtureRows ?? []).flatMap((f) => (f.season_id ? [{ teamId: f.owning_team_id, seasonId: f.season_id }] : []))
  const pitchAllocationTeamIdentities = await loadTeamIdentitiesForSeason(supabase, pitchAllocationIdentityPairs)

  function resolveRule(ageGroup: string | null): { durationMinutes: number | null; confidence: "confirmed" | "unresolved" | null; requiredPitchSize: PitchOption["sizeCategory"] } {
    if (!rugbyCode) return { durationMinutes: null, confidence: null, requiredPitchSize: null }
    const specific = (rules ?? []).find((r) => r.rugby_code === rugbyCode && r.age_group === ageGroup)
    const fallback = (rules ?? []).find((r) => r.rugby_code === rugbyCode && r.age_group === null)
    const rule = specific ?? fallback
    if (!rule) return { durationMinutes: null, confidence: null, requiredPitchSize: null }
    return {
      durationMinutes: rule.half_minutes * 2,
      confidence: rule.confidence as "confirmed" | "unresolved",
      requiredPitchSize: rule.min_pitch_size_category as PitchOption["sizeCategory"],
    }
  }

  const allocationFixtures: AllocationFixture[] = (fixtureRows ?? []).map((f) => {
    // "My side" is whichever of owning/opponent equals home_team_id -- this
    // fixture may have been created by either club (Master Fixture Registry:
    // one row, viewed from whichever side is genuinely home here).
    const { homeGroupId, awayGroupId, homeIsOwning } = resolveHomeAwayGroupIds(f)
    const seasonIdentity = homeIsOwning && f.season_id ? pitchAllocationTeamIdentities.get(teamIdentityKey(f.owning_team_id, f.season_id)) : undefined
    const homeTeam = {
      category: homeIsOwning ? seasonIdentity?.category ?? f.teams?.category ?? "youth" : "youth", // opponent-side rows don't carry full structured metadata in this query; category only affects scheduling-window preference and defaults sensibly
      ageGroup: homeIsOwning ? seasonIdentity?.ageGroup ?? f.teams?.age_group ?? null : null,
      gender: homeIsOwning ? seasonIdentity?.gender ?? f.teams?.gender ?? null : null,
      squadDesignation: homeIsOwning ? seasonIdentity?.squadDesignation ?? f.teams?.squad_designation ?? null : null,
    }
    const alias = f.home_team_id ? aliasByTeamId.get(f.home_team_id) ?? null : null
    // Card identity (Section 6): a Mini-Rugby Group home side always shows
    // its own real group label ("U7/U8 Falcons"), never the single anchor
    // team's compact label -- the anchor is only ever a stable id, never a
    // display identity, once a group is involved.
    const homeTeamLabel = homeGroupId
      ? (groupLabelById.get(homeGroupId) ?? fullTeamLabel(homeTeam))
      : alias
        ? `${compactTeamLabel({ ...homeTeam, alias: null })
            .replace(/\s+(B|C)$/, "")
            .trim()} ${alias}`
        : fullTeamLabel(homeTeam)
    const opponentSeasonIdentity = !homeIsOwning && f.season_id ? pitchAllocationTeamIdentities.get(teamIdentityKey(f.owning_team_id, f.season_id)) : undefined
    // Ordinary opposition text is unchanged (raw_opposition_text exactly as
    // before) -- only when the AWAY side is genuinely a Mini-Rugby Group do
    // we prefer its real structured label over the generic free text/single
    // team name.
    const opponentLabel = awayGroupId
      ? (groupLabelById.get(awayGroupId) ?? null)
      : homeIsOwning
        ? f.raw_opposition_text
        : (opponentSeasonIdentity?.displayName ?? f.teams?.display_name ?? null)
    const rule = resolveRule(homeTeam.ageGroup)
    const requiresOpponentAgreement = Boolean(f.opponent_team_id) && (f.opponent?.club_id ? activeOpponentClubIds.has(f.opponent.club_id) : false)

    // Effective involved team_ids (Section 4/34): the canonical, tested
    // resolver from the group-vs-group pass -- exposed on the DTO for any
    // future commitment/capacity/Side-Project-1 consumer, never
    // re-expanded ad hoc here. detectConflicts itself needs only pitch/time
    // overlap (team-identity-agnostic), so this is additive, not a
    // behavior change to conflict detection.
    const participants = effectiveFixtureParticipants(
      {
        homeAway: f.home_away as "Home" | "Away" | "TBD" | "Not Applicable",
        owningTeamId: f.owning_team_id,
        owningSchedulingGroupId: f.owning_scheduling_group_id,
        opponentTeamId: f.opponent_team_id,
        opponentSchedulingGroupId: f.opponent_scheduling_group_id,
      },
      groupMemberTeamIds
    )

    return {
      fixtureId: f.id,
      homeTeamId: f.home_team_id!,
      homeTeamLabel,
      opponentLabel: opponentLabel || "Opponent",
      category: homeTeam.category,
      ageGroup: homeTeam.ageGroup,
      gender: homeTeam.gender,
      status: f.status,
      kickoffDate: f.kickoff_date,
      kickoffTime: f.kickoff_time,
      venueId: f.venue_id,
      pitchId: f.pitch_id,
      durationMinutes: rule.durationMinutes,
      durationConfidence: rule.confidence,
      requiredPitchSize: rule.requiredPitchSize,
      requiresOpponentAgreement,
      isSharedGroup: Boolean(homeGroupId),
      schedulingGroupId: homeGroupId,
      awaySchedulingGroupId: awayGroupId,
      effectiveHomeTeamIds: participants.homeTeamIds,
      effectiveAwayTeamIds: participants.awayTeamIds,
    }
  })

  const { allocated, unallocated } = partitionAllocation(allocationFixtures)
  const conflicts = detectConflicts(allocated, pitches, { warmUpMinutes: policy.warmUpMinutes, packUpMinutes: policy.packUpMinutes })


  // Section 35: pitch conflicts consider BOTH fixture and training
  // occupancy together -- a separate call from the fixture-only
  // detectConflicts above, so that function's own existing behaviour and
  // regression suite are completely unaffected by Training's existence.
  const { fixtureConflicts: fixtureConflictsFromTraining, trainingConflicts } = detectResourceConflicts(allocated, trainingSessions, pitches, {
    warmUpMinutes: policy.warmUpMinutes,
    packUpMinutes: policy.packUpMinutes,
  })

  // A TOURNAMENT AGAINST EVERYTHING ELSE ON THE DAY. Two reservations of the
  // same occasion are deliberately not compared -- a festival on three pitches
  // is not conflicting with itself -- while a reservation against a fixture,
  // training session, club event or a DIFFERENT tournament conflicts exactly
  // as any other pair would.
  const { tournamentConflicts, fixtureConflicts: fixtureConflictsFromTournament } = detectTournamentConflicts(
    tournaments.map((t) => ({
      id: t.id,
      tournamentId: t.tournamentId,
      tournamentName: t.tournamentName,
      pitchId: t.pitchId,
      startTime: t.startTime,
      endTime: t.endTime,
    })),
    [
      ...occupantsFromFixtures(allocated, { warmUpMinutes: policy.warmUpMinutes, packUpMinutes: policy.packUpMinutes }),
      ...occupantsFromSpans(
        "training",
        trainingSessions
          .filter((t) => t.status !== "CANCELLED")
          .map((t) => ({ id: t.trainingSessionId, label: `${t.teamLabel} — Planned Training`, pitchId: t.pitchId, startTime: t.startTime, durationMinutes: t.durationMinutes }))
      ),
      ...occupantsFromSpans(
        "event",
        clubEvents.map((e) => ({ id: e.eventId, label: e.name, pitchId: e.pitchId, startTime: e.startTime, endTime: e.endTime }))
      ),
    ]
  )
  for (const c of fixtureConflictsFromTournament) {
    if (!conflicts.some((existing) => existing.fixtureId === c.fixtureId)) conflicts.push(c)
  }

  return { fixtures: allocated, unallocated, pitches, policy, conflicts, rugbyCode, tournaments, tournamentConflicts, trainingSessions, trainingConflicts, fixtureConflictsFromTraining, clubEvents, bufferSource }
}
