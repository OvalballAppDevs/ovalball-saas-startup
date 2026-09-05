import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { compactTeamLabel, fullTeamLabel } from "@/lib/teams/compact-label"
import { loadTeamIdentitiesForSeason, teamIdentityKey } from "@/lib/mini-rugby/team-identity.server"
import { effectiveFixtureParticipants } from "@/lib/mini-rugby/effective-teams"
import { loadGroupMemberTeamIds } from "@/lib/mini-rugby/effective-teams.server"
import { loadOpponentGroupLabels } from "@/lib/calendar/resolve-entry-participant"
import { resolveHomeAwayGroupIds } from "@/lib/fixtures/resolve-home-away-groups"
import { detectConflicts, partitionAllocation } from "@/lib/pitch-allocation/auto-allocate"
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
        warmUpMinutes: policyRow.warm_up_minutes,
        packUpMinutes: policyRow.pack_up_minutes,
      }
    : DEFAULT_SCHEDULING_POLICY

  const { data: rules } = await supabase.from("fixture_scheduling_rules").select("rugby_code, age_group, half_minutes, min_pitch_size_category, confidence")

  // Section 79: tournaments are a SEPARATE table from fixtures -- a
  // confirmed one hosted by this club today occupies real pitch/venue
  // time that autoAllocate/detectConflicts know nothing about unless
  // surfaced here. cancelled_at IS NULL is the only "still on" signal
  // this table has (status is always 'confirmed' in practice).
  const { data: tournamentRows } = await supabase
    .from("tournaments")
    .select("id, status, pitch_id, host_team_id, teams(display_name, category, age_group, gender, squad_designation), club_pitches(display_name), venues(name)")
    .eq("host_club_id", clubId)
    .eq("event_date", dateIso)
    .is("cancelled_at", null)
  const tournaments: TournamentSummary[] = (tournamentRows ?? []).map((t) => ({
    id: t.id,
    hostTeamLabel: t.teams ? fullTeamLabel({ category: t.teams.category ?? "youth", ageGroup: t.teams.age_group, gender: t.teams.gender, squadDesignation: t.teams.squad_designation }) : "Unknown team",
    pitchId: t.pitch_id,
    pitchDisplayName: t.club_pitches?.display_name ?? null,
    venueName: t.venues?.name ?? null,
    status: t.status,
  }))

  if (teamIds.length === 0) {
    return { fixtures: [], unallocated: [], pitches, policy, conflicts: [], rugbyCode, tournaments }
  }

  const { data: rawFixtureRows } = await supabase
    .from("fixtures")
    .select(
      "id, owning_team_id, opponent_team_id, home_team_id, away_team_id, status, kickoff_date, kickoff_time, venue_id, pitch_id, raw_opposition_text, owning_scheduling_group_id, opponent_scheduling_group_id, home_away, mirror_fixture_id, season_id, teams!fixtures_owning_team_id_fkey(display_name, category, age_group, gender, squad_designation, club_id), opponent:teams!fixtures_opponent_team_id_fkey(display_name, club_id)"
    )
    .in("home_team_id", teamIds)
    .eq("kickoff_date", dateIso)
    .neq("status", "Cancelled")

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
  const fixtureRows = (rawFixtureRows ?? []).filter((f) => !f.mirror_fixture_id || f.id < f.mirror_fixture_id)

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

  // Section 79: a tournament with a real pitch assigned monopolizes that
  // pitch for the whole day -- flag any fixture already sitting on it as
  // a genuine hard conflict, same severity as a pitch/pitch double-booking,
  // rather than leaving the clash invisible just because tournaments live
  // outside detectConflicts' normal fixtures-only view.
  const tournamentPitchIds = new Set(tournaments.map((t) => t.pitchId).filter((id): id is string => Boolean(id)))
  for (const f of allocated) {
    if (f.pitchId && tournamentPitchIds.has(f.pitchId) && !conflicts.some((c) => c.fixtureId === f.fixtureId)) {
      const tournament = tournaments.find((t) => t.pitchId === f.pitchId)
      conflicts.push({ fixtureId: f.fixtureId, severity: "hard", reason: `${tournament?.pitchDisplayName ?? "This pitch"} is booked all day for ${tournament?.hostTeamLabel ?? "a"} tournament.` })
    }
  }

  return { fixtures: allocated, unallocated, pitches, policy, conflicts, rugbyCode, tournaments }
}
