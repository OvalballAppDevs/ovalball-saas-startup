import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { autoAllocate } from "./auto-allocate"
import { fixtureOccupiedWindow } from "./occupancy"
import { getPitchAllocationBoard } from "./board"
import { resolveHomeAwayGroupIds } from "../fixtures/resolve-home-away-groups"
import { loadOpponentGroupLabels } from "../mini-rugby/group-labels"

type Client = SupabaseClient<Database>

/**
 * PITCH ALLOCATION OPERATIONS -- the same writes from both clients (CA-M11.1).
 *
 * Moved from the website's server actions, minus the Next.js plumbing (cookies, revalidation) and minus
 * the action-layer gate, which each client keeps for itself: the website's `requirePitchAllocationAccess`
 * still wraps these, and the phone asks `my_capabilities` for `venue.pitch_allocation.*` before it draws
 * a control. The SERVER is the authority either way: `update_fixture_schedule` decides who may move a
 * fixture, and RLS on the proposal tables asks `venue.pitch_allocation.manage`.
 *
 * `p_source: "PITCH_ALLOCATION"` is the board's fingerprint in `audit_log`, whichever client saved.
 */

export interface AllocateResult {
  ok: boolean
  error?: string
  fixtureId: string
  appliedPitchId: string | null
  appliedKickoffTime: string | null
  /** True when the kick-off change was PROPOSED to the opposing club rather than applied. */
  kickoffProposed: boolean
}

const refused = (fixtureId: string, error: string): AllocateResult => ({ ok: false, error, fixtureId, appliedPitchId: null, appliedKickoffTime: null, kickoffProposed: false })

/**
 * Place (or move) one home fixture on a pitch and/or at a kick-off time. Defence in depth before the
 * atomic RPC: the fixture must be a home fixture of this club, not cancelled, and the pitch must be
 * this club's and active; the pitch's own ground becomes the fixture's ground.
 */
export async function allocateFixtureOnPitch(
  supabase: Client,
  clubId: string,
  fixtureId: string,
  changes: { pitchId?: string | null; kickoffTime?: string }
): Promise<AllocateResult> {
  const { data: fixture } = await supabase
    .from("fixtures")
    .select("id, home_team_id, owning_team_id, kickoff_date, kickoff_time, venue_id, pitch_id, status")
    .eq("id", fixtureId)
    .maybeSingle()
  if (!fixture) return refused(fixtureId, "Fixture not found.")
  const { data: homeTeam } = await supabase.from("teams").select("club_id").eq("id", fixture.home_team_id ?? "").maybeSingle()
  if (!homeTeam || homeTeam.club_id !== clubId) return refused(fixtureId, "That fixture is not a home fixture for this club.")
  if (fixture.status === "Cancelled") return refused(fixtureId, "This fixture is cancelled and cannot be allocated.")

  let targetVenueId = fixture.venue_id
  let targetPitchId = fixture.pitch_id
  if (changes.pitchId !== undefined && changes.pitchId !== fixture.pitch_id) {
    if (changes.pitchId) {
      const { data: pitch } = await supabase.from("club_pitches").select("club_id, venue_id, active").eq("id", changes.pitchId).maybeSingle()
      if (!pitch || pitch.club_id !== clubId || !pitch.active) return refused(fixtureId, "That pitch does not belong to this club, or is not active.")
      targetVenueId = pitch.venue_id ?? fixture.venue_id
    }
    targetPitchId = changes.pitchId
  }
  const targetKickoffTime = changes.kickoffTime !== undefined ? changes.kickoffTime : fixture.kickoff_time

  const { data: result, error } = await supabase
    .rpc("update_fixture_schedule", {
      p_fixture_id: fixtureId,
      p_kickoff_date: fixture.kickoff_date,
      p_kickoff_time: targetKickoffTime ?? undefined,
      p_venue_id: targetVenueId ?? undefined,
      p_pitch_id: targetPitchId ?? undefined,
      p_source: "PITCH_ALLOCATION",
    })
    .maybeSingle()
  if (error) return refused(fixtureId, error.message)
  return {
    ok: true,
    fixtureId,
    appliedPitchId: result?.applied_pitch_id ?? null,
    appliedKickoffTime: result?.applied_kickoff_time ?? null,
    kickoffProposed: result?.kickoff_proposed ?? false,
  }
}

/**
 * Take a fixture OFF its pitch. The board on the website has no control for this; the website's
 * Fixture Detail does it through `update_fixture_pitch` with no pitch, which is the canonical way to
 * clear a pitch (and what the phone's fixture console already calls). Same RPC, same audit.
 */
export async function clearFixturePitch(supabase: Client, fixtureId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc("update_fixture_pitch", {
    p_fixture_id: fixtureId,
    p_pitch_id: null as unknown as string,
    p_pitch_text: null as unknown as string,
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

export interface ProposalResult {
  ok: boolean
  error?: string
  proposalId?: string
}

/**
 * Build an allocation PROPOSAL for one day: the allocator's placements, written to the proposal
 * tables for review. Nothing is applied. Existing bookings block (plus the club's turnaround), every
 * tournament pitch is blocked for the whole day, and a mini-rugby shared group may play once per day.
 */
export async function createAllocationProposal(
  supabase: Client,
  clubId: string,
  dateIso: string,
  createdBy: string,
  recalculateAll = false
): Promise<ProposalResult> {
  const board = await getPitchAllocationBoard(supabase, clubId, dateIso)
  const existingBookings = recalculateAll
    ? []
    : board.fixtures
        .filter((f) => f.pitchId && f.kickoffTime)
        .map((f) => {
          const w = fixtureOccupiedWindow(f, board.policy)!
          return { pitchId: f.pitchId!, start: w.start, end: w.end + board.policy.turnaroundMinutes }
        })
  for (const t of board.tournaments) {
    if (t.pitchId) existingBookings.push({ pitchId: t.pitchId, start: 0, end: 24 * 60 })
  }
  const candidates = recalculateAll ? [...board.fixtures, ...board.unallocated] : board.unallocated
  const teamIds = candidates.map((f) => f.homeTeamId)
  const { data: groupMemberships } = teamIds.length > 0 ? await supabase.from("scheduling_group_members").select("team_id, group_id").in("team_id", teamIds) : { data: [] }
  const groupByTeamId = new Map((groupMemberships ?? []).map((g) => [g.team_id, g.group_id]))
  const seenGroupToday = new Set<string>()
  const eligible: typeof candidates = []
  const groupConflicts: { fixtureId: string; severity: "hard"; reason: string }[] = []
  for (const f of candidates) {
    const groupId = groupByTeamId.get(f.homeTeamId)
    if (groupId) {
      if (seenGroupToday.has(groupId)) {
        groupConflicts.push({ fixtureId: f.fixtureId, severity: "hard", reason: "This team shares a mini-rugby scheduling group with another fixture already committed on this day -- only one match per day is allowed for the shared group." })
        continue
      }
      seenGroupToday.add(groupId)
    }
    eligible.push(f)
  }
  const { placements } = autoAllocate(eligible, board.pitches, board.policy, dateIso, existingBookings)
  const allPlacements = [...placements, ...groupConflicts.map((c) => ({ fixtureId: c.fixtureId, pitchId: null, kickoffTime: null, conflict: c }))]
  const { data: proposal, error: proposalError } = await supabase
    .from("pitch_allocation_proposals")
    .insert({ club_id: clubId, proposal_date: dateIso, created_by: createdBy })
    .select("id")
    .single()
  if (proposalError || !proposal) return { ok: false, error: proposalError?.message ?? "Could not create proposal." }
  const items = allPlacements.map((p) => ({
    proposal_id: proposal.id,
    fixture_id: p.fixtureId,
    proposed_pitch_id: p.pitchId,
    proposed_kickoff_time: p.kickoffTime,
    is_unallocated: p.pitchId === null,
    conflict_severity: p.conflict?.severity ?? null,
    conflict_reason: p.conflict?.reason ?? null,
  }))
  if (items.length > 0) {
    const { error: itemsError } = await supabase.from("pitch_allocation_proposal_items").insert(items)
    if (itemsError) return { ok: false, error: itemsError.message }
  }
  return { ok: true, proposalId: proposal.id }
}

export interface ProposalItemView {
  fixtureId: string
  homeTeamLabel: string
  opponentLabel: string
  proposedPitchId: string | null
  proposedPitchName: string | null
  proposedKickoffTime: string | null
  isUnallocated: boolean
  conflictSeverity: "hard" | "warning" | null
  conflictReason: string | null
}

export async function readAllocationProposal(supabase: Client, proposalId: string): Promise<ProposalItemView[]> {
  const { data: items, error } = await supabase
    .from("pitch_allocation_proposal_items")
    .select(
      "fixture_id, proposed_pitch_id, proposed_kickoff_time, is_unallocated, conflict_severity, conflict_reason, club_pitches(display_name), fixtures(raw_opposition_text, owning_team_id, opponent_team_id, home_team_id, owning_scheduling_group_id, opponent_scheduling_group_id, teams!fixtures_owning_team_id_fkey(display_name), opponent:teams!fixtures_opponent_team_id_fkey(display_name))"
    )
    .eq("proposal_id", proposalId)
  if (error) throw error
  const referencedGroupIds = (items ?? []).flatMap((it) => {
    const f = it.fixtures
    if (!f) return []
    const { homeGroupId, awayGroupId } = resolveHomeAwayGroupIds(f)
    return [homeGroupId, awayGroupId]
  })
  const groupLabelById = await loadOpponentGroupLabels(supabase, referencedGroupIds)
  return (items ?? []).map((it) => {
    const f = it.fixtures
    const { homeGroupId, awayGroupId, homeIsOwning } = f ? resolveHomeAwayGroupIds(f) : { homeGroupId: null, awayGroupId: null, homeIsOwning: true }
    return {
      fixtureId: it.fixture_id,
      homeTeamLabel: (homeGroupId ? groupLabelById.get(homeGroupId) : null) ?? (homeIsOwning ? f?.teams?.display_name : f?.opponent?.display_name) ?? "Home team",
      opponentLabel: (awayGroupId ? groupLabelById.get(awayGroupId) : null) ?? (homeIsOwning ? f?.raw_opposition_text : f?.teams?.display_name) ?? "Opponent",
      proposedPitchId: it.proposed_pitch_id,
      proposedPitchName: it.club_pitches?.display_name ?? null,
      proposedKickoffTime: it.proposed_kickoff_time,
      isUnallocated: it.is_unallocated,
      conflictSeverity: it.conflict_severity as "hard" | "warning" | null,
      conflictReason: it.conflict_reason,
    }
  })
}

/** A reviewed proposal is closed: the website stages the eligible items as draft changes and discards it. */
export async function discardAllocationProposal(supabase: Client, clubId: string, proposalId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("pitch_allocation_proposals").update({ status: "discarded" }).eq("id", proposalId).eq("club_id", clubId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export interface SchedulingPolicySettings {
  autoAllocateHomeFixtures: boolean
  warmUpMinutes: number
  packUpMinutes: number
}

export const VALID_BUFFER_MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60] as const

/** The club's own buffers and auto-allocate switch: an upsert under RLS, exactly as the website's settings form saves it. */
export async function saveSchedulingPolicy(supabase: Client, clubId: string, updatedBy: string, settings: SchedulingPolicySettings): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(VALID_BUFFER_MINUTES as readonly number[]).includes(settings.warmUpMinutes) || !(VALID_BUFFER_MINUTES as readonly number[]).includes(settings.packUpMinutes)) {
    return { ok: false, error: "Warm-up and pack-up time must be in 5-minute increments between 0 and 60." }
  }
  const { error } = await supabase.from("club_scheduling_policy").upsert(
    {
      club_id: clubId,
      auto_allocate_home_fixtures: settings.autoAllocateHomeFixtures,
      warm_up_minutes: settings.warmUpMinutes,
      pack_up_minutes: settings.packUpMinutes,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "club_id" }
  )
  return error ? { ok: false, error: error.message } : { ok: true }
}

export interface PitchAllocationCapabilities {
  /** venue.pitch_allocation.view */
  view: boolean
  /** venue.pitch_allocation.manage */
  manage: boolean
}

/** The board's own two keys, asked of the server. Fixture edit and result recording are never consulted. */
export async function readPitchAllocationCapabilities(supabase: Client, clubId: string): Promise<PitchAllocationCapabilities> {
  const { data, error } = await supabase.rpc("my_capabilities", { p_scope_type: "club", p_club_id: clubId })
  if (error) return { view: false, manage: false }
  const allowed = new Set((data ?? []).filter((r) => r.allowed === true).map((r) => r.capability_key))
  return { view: allowed.has("venue.pitch_allocation.view"), manage: allowed.has("venue.pitch_allocation.manage") }
}

/** The next date on or after today with a live home fixture -- the board's default day, as on the website. */
export async function nextHomeFixtureDate(supabase: Client, clubId: string, todayIso: string): Promise<string> {
  const { data: teamRows } = await supabase.from("teams").select("id").eq("club_id", clubId)
  const teamIds = (teamRows ?? []).map((t) => t.id)
  if (teamIds.length === 0) return todayIso
  const { data } = await supabase
    .from("fixtures")
    .select("kickoff_date")
    .in("home_team_id", teamIds)
    .gte("kickoff_date", todayIso)
    .neq("status", "Cancelled")
    .is("archived_at", null)
    .order("kickoff_date", { ascending: true })
    .limit(1)
    .maybeSingle()
  return data?.kickoff_date ?? todayIso
}
