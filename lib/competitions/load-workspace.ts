import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { ExistingCommitment } from "@/lib/fixtures/conflicts"
import { fullTeamLabel } from "@/lib/teams/compact-label"
import type { Database } from "@/types/database.types"

import type { CompetitionWorkspace, SlotSourceRecord, WorkspaceMatch, WorkspaceParticipant, WorkspaceStage } from "./workspace-types"

/**
 * ONE READ OF A COMPETITION, FOR EVERY STEP OF THE CREATOR.
 *
 * Participants with their canonical club and team, stages with groups and
 * rounds, every Competition Match with its verifications and linked fixture
 * ids, the participating teams' other fixtures (for the conflict check) and
 * the participating clubs' grounds. Authority is the caller's: this runs with
 * the person's own client, under RLS.
 */

type Supabase = SupabaseClient<Database>

export async function loadCompetitionWorkspace(supabase: Supabase, editionId: string): Promise<CompetitionWorkspace | null> {
  const { data: edition } = await supabase
    .from("competition_editions")
    .select(
      "id, rugby_code, competition_id, competitions(id, name, slug, format, team_count, organiser_name, organiser_club_id, canonical_team_type_id), seasons(name, starts_on, ends_on, pre_season_starts_on)",
    )
    .eq("id", editionId)
    .maybeSingle()
  if (!edition?.competitions) return null
  const c = edition.competitions
  const rugbyCode = edition.rugby_code as "union" | "league"

  const [{ data: participantRows }, { data: stageRows }, { data: matchRows }, { data: teamTypes }] = await Promise.all([
    supabase
      .from("competition_participants")
      .select("id, slot, seed, status, club_directory_id, club_id, team_id, club_directory(name, home_ground, latitude, longitude), teams(rugby_code, category, age_group, gender, squad_designation, canonical_team_type_id)")
      .eq("edition_id", editionId)
      .order("slot"),
    supabase
      .from("competition_stages")
      .select("id, kind, name, sort_order, settings, competition_groups(id, name, sort_order), competition_rounds(round_number, name, round_date)")
      .eq("edition_id", editionId)
      .order("sort_order"),
    supabase
      .from("competition_matches")
      .select(
        "id, stage_id, group_id, round_number, bracket_slot, home_participant_id, away_participant_id, home_source, away_source, match_date, kickoff_time, venue_id, venue_text, pitch_id, status, verification_state, home_score, away_score, winner_participant_id, is_public, notes, sync_error, competition_match_fixtures(fixture_id), competition_match_verifications(id, participant_id, status, message, proposed_date, proposed_kickoff_time, proposed_venue_id, proposed_pitch_id)",
      )
      .eq("edition_id", editionId)
      .order("round_number", { nullsFirst: false })
      .order("bracket_slot", { nullsFirst: false }),
    supabase.from("canonical_team_types_by_code").select("id, label, sort_order").eq("rugby_code", rugbyCode).eq("is_offered", true).order("sort_order"),
  ])

  const stageIds = (stageRows ?? []).map((s) => s.id)
  const { data: memberRows } =
    stageIds.length > 0 ? await supabase.from("competition_group_members").select("group_id, participant_id, position").in("stage_id", stageIds).order("position") : { data: [] }

  const participants: WorkspaceParticipant[] = (participantRows ?? []).map((p) => ({
    id: p.id,
    slot: p.slot,
    seed: p.seed,
    status: p.status,
    clubDirectoryId: p.club_directory_id,
    clubName: p.club_directory?.name ?? "Unknown club",
    clubId: p.club_id,
    teamId: p.team_id,
    teamTypeId: p.teams?.canonical_team_type_id ?? null,
    teamLabel: p.teams
      ? fullTeamLabel({ category: p.teams.category, ageGroup: p.teams.age_group, gender: p.teams.gender, squadDesignation: p.teams.squad_designation, rugbyCode: p.teams.rugby_code })
      : null,
    homeGround: p.club_directory?.home_ground ?? null,
    lat: p.club_directory?.latitude != null ? Number(p.club_directory.latitude) : null,
    lng: p.club_directory?.longitude != null ? Number(p.club_directory.longitude) : null,
  }))

  const membersByGroup = new Map<string, string[]>()
  for (const m of memberRows ?? []) {
    const list = membersByGroup.get(m.group_id) ?? []
    list.push(m.participant_id)
    membersByGroup.set(m.group_id, list)
  }

  const stages: WorkspaceStage[] = (stageRows ?? []).map((s) => ({
    id: s.id,
    kind: s.kind as "league" | "knockout",
    name: s.name,
    sortOrder: s.sort_order,
    settings: (s.settings ?? {}) as WorkspaceStage["settings"],
    groups: [...(s.competition_groups ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((g) => ({ id: g.id, name: g.name, sortOrder: g.sort_order, members: membersByGroup.get(g.id) ?? [] })),
    rounds: [...(s.competition_rounds ?? [])]
      .sort((a, b) => a.round_number - b.round_number)
      .map((r) => ({ roundNumber: r.round_number, name: r.name, roundDate: r.round_date })),
  }))

  const matches: WorkspaceMatch[] = (matchRows ?? []).map((m) => ({
    id: m.id,
    stageId: m.stage_id,
    groupId: m.group_id,
    roundNumber: m.round_number,
    bracketSlot: m.bracket_slot,
    homeParticipantId: m.home_participant_id,
    awayParticipantId: m.away_participant_id,
    homeSource: (m.home_source ?? null) as SlotSourceRecord,
    awaySource: (m.away_source ?? null) as SlotSourceRecord,
    matchDate: m.match_date,
    kickoffTime: m.kickoff_time?.slice(0, 5) ?? null,
    venueId: m.venue_id,
    venueText: m.venue_text,
    pitchId: m.pitch_id,
    status: m.status,
    verificationState: m.verification_state,
    homeScore: m.home_score,
    awayScore: m.away_score,
    winnerParticipantId: m.winner_participant_id,
    isPublic: m.is_public,
    notes: m.notes,
    syncError: m.sync_error,
    linkedFixtureIds: (m.competition_match_fixtures ?? []).map((l) => l.fixture_id),
    verifications: (m.competition_match_verifications ?? []).map((v) => ({
      id: v.id,
      participantId: v.participant_id,
      status: v.status,
      message: v.message,
      proposedDate: v.proposed_date,
      proposedKickoff: v.proposed_kickoff_time?.slice(0, 5) ?? null,
      proposedVenueId: v.proposed_venue_id,
      proposedPitchId: v.proposed_pitch_id,
    })),
  }))

  // The participating teams' OTHER fixtures, for the conflict check. A fixture
  // this competition already projected is the match itself, not a clash.
  const teamIds = [...new Set(participants.map((p) => p.teamId).filter((id): id is string => Boolean(id)))]
  const linked = new Set(matches.flatMap((m) => m.linkedFixtureIds))
  const commitments: ExistingCommitment[] = []
  if (teamIds.length > 0) {
    const season = edition.seasons
    let q = supabase
      .from("fixtures")
      .select("id, owning_team_id, opponent_team_id, raw_opposition_text, kickoff_date, kickoff_time, venue_id, pitch_id, status")
      .or(`owning_team_id.in.(${teamIds.join(",")}),opponent_team_id.in.(${teamIds.join(",")})`)
      .neq("status", "Cancelled")
      .limit(2000)
    if (season) q = q.gte("kickoff_date", season.pre_season_starts_on ?? season.starts_on).lte("kickoff_date", season.ends_on)
    const { data: fixtures } = await q
    for (const f of fixtures ?? []) {
      if (linked.has(f.id)) continue
      commitments.push({
        key: f.id,
        label: f.raw_opposition_text,
        date: f.kickoff_date,
        kickoff: f.kickoff_time?.slice(0, 5) ?? null,
        teamIds: [f.owning_team_id, f.opponent_team_id].filter((id): id is string => Boolean(id)),
        venueId: f.venue_id,
        pitchId: f.pitch_id,
      })
    }
  }

  const clubIds = [...new Set(participants.map((p) => p.clubId).filter((id): id is string => Boolean(id)))]
  const [{ data: venueRows }, { data: pitchRows }] =
    clubIds.length > 0
      ? await Promise.all([
          supabase.from("venues").select("id, name, club_id, is_default_home").in("club_id", clubIds).eq("active", true).order("name"),
          supabase.from("club_pitches").select("id, display_name, venue_id, club_id").in("club_id", clubIds).eq("active", true).order("sort_order"),
        ])
      : [{ data: [] }, { data: [] }]

  return {
    editionId,
    competitionId: c.id,
    name: c.name,
    slug: c.slug,
    rugbyCode,
    seasonName: edition.seasons?.name ?? null,
    season: edition.seasons ? { startsOn: edition.seasons.starts_on, endsOn: edition.seasons.ends_on, preSeasonStartsOn: edition.seasons.pre_season_starts_on } : null,
    format: (c.format as CompetitionWorkspace["format"]) ?? null,
    teamCount: c.team_count,
    organiserName: c.organiser_name,
    organiserClubId: c.organiser_club_id,
    canonicalTeamTypeId: c.canonical_team_type_id,
    teamTypes: (teamTypes ?? []).map((t) => ({ id: t.id as string, label: t.label as string })),
    participants,
    stages,
    matches,
    commitments,
    venues: (venueRows ?? []).map((v) => ({ id: v.id, name: v.name, clubId: v.club_id as string, isDefaultHome: v.is_default_home })),
    pitches: (pitchRows ?? []).map((p) => ({ id: p.id, name: p.display_name, venueId: p.venue_id })),
  }
}
