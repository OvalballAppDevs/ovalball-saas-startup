"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"

import { ACTIVE_CONTEXT_COOKIE, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { autoAllocate } from "@/lib/pitch-allocation/auto-allocate"
import { resolveHomeAwayGroupIds } from "@/lib/fixtures/resolve-home-away-groups"
import { loadOpponentGroupLabels } from "@/lib/calendar/resolve-entry-participant"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"

import { getPitchAllocationBoard } from "./data"

/**
 * PITCH ALLOCATION MUTATION SERVICE.
 *
 * This file does NOT reimplement fixture scheduling. Every real change to
 * a fixture's kickoff/pitch/venue goes through the EXISTING canonical
 * RPCs (public.update_fixture_pitch / update_fixture_venue /
 * update_fixture_kickoff) -- the same three functions Fixture Management
 * already uses. Pitch Allocation only:
 *   1. resolves which of those RPCs to call, in what order, from a drag
 *      gesture or an applied proposal;
 *   2. re-reads the canonical fixture afterward and reports the REAL
 *      resulting state (a kickoff-time drag on a fixture with a real,
 *      active opponent club does not apply immediately -- see the
 *      discovered `update_fixture_kickoff` negotiation rule below -- so
 *      the caller must never assume "the RPC succeeded" means "the board
 *      should show the new time as final");
 *   3. records a PITCH_ALLOCATION-sourced audit_log row alongside the
 *      row(s) update_fixture_* already writes.
 *
 * DISCOVERED EXISTING RULE (Section 64/65 -- reported, not silently
 * resolved): update_fixture_kickoff() applies a kickoff-date/time change
 * IMMEDIATELY only when the fixture is Site-Admin-edited or has no real,
 * active opposing club; for a fixture between two genuinely active
 * Ovalball clubs, the SAME change instead becomes a proposal awaiting the
 * other club's agreement (kickoff_amendment_proposed_* columns), exactly
 * like a manual Fixture Management edit would. Pitch Allocation respects
 * this rather than bypassing it -- bypassing it would mean either
 * inventing a second, less-safe mutation path for the exact same field,
 * or silently overriding an opposing club's own negotiated fixture time
 * without their agreement. The board surfaces this honestly (a fixture
 * dragged to a new time on a fixture with a real opponent shows
 * "Time change proposed -- awaiting <Opponent>'s confirmation", not a
 * false "Moved").
 */

export interface AllocateResult {
  ok: boolean
  error?: string
  fixtureId: string
  appliedPitchId: string | null
  appliedKickoffTime: string | null
  kickoffProposed: boolean
}

const CALENDAR_PATHS = ["/calendar", "/calendar/agenda", "/calendar/pitch-allocation", "/fixtures"]

export async function requirePitchAllocationAccess(clubId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: "Not signed in." }

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)

  // Active context must genuinely BE this club -- an account that also
  // happens to hold Site Admin or another club's authority must not
  // exercise Pitch Allocation for a club it isn't currently operating as
  // (the same "active context is a lens, not authority" rule already
  // enforced everywhere else in Calendar this session).
  const activeIsThisClub = activeContext.kind === "club" && activeContext.id === clubId
  const activeIsSiteAdmin = ctx.isSiteAdmin && activeContext.kind === "site_admin"
  if (!activeIsThisClub && !activeIsSiteAdmin) {
    return { ok: false as const, error: "You must be operating as this club (or as an active Site Admin) to manage Pitch Allocation." }
  }

  // No new capability invented (Section 22's own instruction to audit
  // first): fixture.edit at CLUB scope already means exactly "Club Admin
  // or Fixture Secretary for this club" -- the same two roles Section
  // 23/24 name as Pitch Allocation's intended managers -- and, being
  // club-SCOPED (not team-scoped), a Team Admin/Coach/Manager's
  // team-scoped fixture.edit grant does NOT satisfy this check, which is
  // exactly Section 25's "do not silently grant club-wide scheduling
  // power" requirement, for free, from the capability engine's own scope
  // model.
  const allowed = activeIsSiteAdmin || (await hasCapability(supabase, "fixture.edit", "club", { clubId }))
  if (!allowed) return { ok: false as const, error: "You do not have Pitch Allocation access for this club." }

  return { ok: true as const, supabase, user }
}

/**
 * One drag mutation -- Sections 14-16: horizontal = kickoff time,
 * vertical = pitch, and a single drop across both axes is one coherent
 * call. `kickoffTime: undefined` means "don't touch kickoff"; pass null
 * explicitly only if a future "clear kickoff" affordance is added (not
 * built this pass).
 */
export async function allocateFixture(
  clubId: string,
  fixtureId: string,
  changes: { pitchId?: string | null; kickoffTime?: string }
): Promise<AllocateResult> {
  const auth = await requirePitchAllocationAccess(clubId)
  if (!auth.ok) return { ok: false, error: auth.error, fixtureId, appliedPitchId: null, appliedKickoffTime: null, kickoffProposed: false }
  const { supabase } = auth

  const { data: fixture } = await supabase
    .from("fixtures")
    .select("id, home_team_id, owning_team_id, kickoff_date, kickoff_time, venue_id, pitch_id, status, teams!fixtures_owning_team_id_fkey(club_id)")
    .eq("id", fixtureId)
    .maybeSingle()
  if (!fixture) return { ok: false, error: "Fixture not found.", fixtureId, appliedPitchId: null, appliedKickoffTime: null, kickoffProposed: false }

  // Defense in depth beyond update_fixture_pitch/kickoff's own checks
  // (Section 6/69): the fixture's HOME team must belong to THIS club --
  // never trust a client-supplied fixtureId to actually be one of this
  // club's home fixtures just because the board rendered it.
  const { data: homeTeam } = await supabase.from("teams").select("club_id").eq("id", fixture.home_team_id ?? "").maybeSingle()
  if (!homeTeam || homeTeam.club_id !== clubId) {
    return { ok: false, error: "That fixture is not a home fixture for this club.", fixtureId, appliedPitchId: null, appliedKickoffTime: null, kickoffProposed: false }
  }
  if (fixture.status === "Cancelled") {
    return { ok: false, error: "This fixture is cancelled and cannot be allocated.", fixtureId, appliedPitchId: null, appliedKickoffTime: null, kickoffProposed: false }
  }

  // Section 9-11: ONE atomic RPC for the whole schedule (venue + pitch +
  // kickoff) instead of up to three sequential calls -- a failure partway
  // through no longer leaves the pitch changed while kickoff didn't (or
  // vice versa). update_fixture_schedule takes the fixture's FULL desired
  // state; fields not being changed here are passed through as their
  // CURRENT value so the RPC's own internal diff treats them as no-ops.
  let targetVenueId = fixture.venue_id
  let targetPitchId = fixture.pitch_id
  if (changes.pitchId !== undefined && changes.pitchId !== fixture.pitch_id) {
    if (changes.pitchId) {
      const { data: pitch } = await supabase.from("club_pitches").select("club_id, venue_id, active").eq("id", changes.pitchId).maybeSingle()
      // Section 29/69: server independently resolves pitch -> venue ->
      // club ownership -- never trusts a board-generated pair. (The RPC
      // re-validates this too; this is a friendlier, earlier error.)
      if (!pitch || pitch.club_id !== clubId || !pitch.active) {
        return { ok: false, error: "That pitch does not belong to this club, or is not active.", fixtureId, appliedPitchId: null, appliedKickoffTime: null, kickoffProposed: false }
      }
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
  if (error) {
    return { ok: false, error: error.message, fixtureId, appliedPitchId: null, appliedKickoffTime: null, kickoffProposed: false }
  }

  for (const path of CALENDAR_PATHS) revalidatePath(path)
  revalidatePath(`/admin/fixtures/${fixtureId}`)

  return {
    ok: true,
    fixtureId,
    appliedPitchId: result?.applied_pitch_id ?? null,
    appliedKickoffTime: result?.applied_kickoff_time ?? null,
    kickoffProposed: result?.kickoff_proposed ?? false,
  }
}

export interface ProposalResult {
  ok: boolean
  error?: string
  proposalId?: string
}

/**
 * Section 35/42: Auto Allocate produces a PROPOSAL only -- no canonical
 * fixture is touched until Apply.
 *
 * Section 48: by DEFAULT (recalculateAll=false, every existing caller)
 * this only ever plans board.unallocated -- an already-allocated fixture
 * is passed through as an existingBookings entry that blocks time, never
 * as something the algorithm might re-place, so a manually-confirmed
 * allocation can never be silently reshuffled just by reopening the
 * board or clicking Auto Allocate again. recalculateAll=true is the
 * explicit, separate "Recalculate All" action: it re-plans EVERY home
 * fixture for the day, including ones already sitting on a pitch, from a
 * clean slate -- a deliberate full re-plan the user asked for by name,
 * never a side effect of the normal flow.
 */
export async function createPitchAllocationProposal(clubId: string, dateIso: string, recalculateAll = false): Promise<ProposalResult> {
  const auth = await requirePitchAllocationAccess(clubId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const { supabase, user } = auth

  const board = await getPitchAllocationBoard(supabase, clubId, dateIso)
  const existingBookings = recalculateAll
    ? []
    : board.fixtures
        .filter((f) => f.pitchId && f.kickoffTime)
        .map((f) => {
          const [h, m] = f.kickoffTime!.split(":").map(Number)
          const kickoff = h * 60 + m
          // Section 31-40: an already-placed fixture's own warm-up/pack-up
          // window blocks time too, same as autoAllocate's own internal
          // placements -- otherwise a newly-proposed fixture could land
          // during another fixture's warm-up or pack-up just because that
          // fixture was already on the board rather than being placed in
          // this same run.
          return { pitchId: f.pitchId!, start: kickoff - board.policy.warmUpMinutes, end: kickoff + (f.durationMinutes ?? 60) + board.policy.packUpMinutes + board.policy.turnaroundMinutes }
        })

  // Section 79: a confirmed tournament with a real pitch assigned
  // monopolizes that pitch for the whole day -- blocked here UNCONDITIONALLY
  // (even under recalculateAll, which otherwise clears existingBookings) so
  // Auto Allocate/Recalculate All can never propose a fixture onto a pitch
  // this club is using for a tournament today.
  for (const t of board.tournaments) {
    if (t.pitchId) existingBookings.push({ pitchId: t.pitchId, start: 0, end: 24 * 60 })
  }

  const candidates = recalculateAll ? [...board.fixtures, ...board.unallocated] : board.unallocated

  // Section 47/48: a shared mini-rugby scheduling group may hold only ONE
  // match per day across all its member teams -- enforced at the DB level
  // by internal.enforce_shared_team_fixture_capacity() (discovered live
  // this pass: two real fixture rows existed for U7 and U8 B, both
  // members of the same "U7/U8" scheduling group, on the same real day --
  // proposing/applying a pitch+time for both hit that trigger on the
  // second one). Detected and excluded HERE, upfront, so the proposal
  // review shows the real conflict before Apply, never a silent partial
  // failure discovered only when the RPC rejects it.
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
    .insert({ club_id: clubId, proposal_date: dateIso, created_by: user.id })
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

export async function getProposal(clubId: string, proposalId: string): Promise<{ ok: true; items: ProposalItemView[] } | { ok: false; error: string }> {
  const auth = await requirePitchAllocationAccess(clubId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const { supabase } = auth

  const { data: items } = await supabase
    .from("pitch_allocation_proposal_items")
    .select(
      "fixture_id, proposed_pitch_id, proposed_kickoff_time, is_unallocated, conflict_severity, conflict_reason, club_pitches(display_name), fixtures(raw_opposition_text, owning_team_id, opponent_team_id, home_team_id, owning_scheduling_group_id, opponent_scheduling_group_id, teams!fixtures_owning_team_id_fkey(display_name), opponent:teams!fixtures_opponent_team_id_fkey(display_name))"
    )
    .eq("proposal_id", proposalId)

  // Group-vs-group pass: same shared side-resolution predicate data.ts
  // uses, so a proposal item's title is never resolved a second,
  // inconsistent way -- a group participant here shows its real group
  // label ("U7/U8 Falcons"), never a single anchor team's own name.
  const referencedGroupIds = (items ?? []).flatMap((it) => {
    const f = it.fixtures
    if (!f) return []
    const { homeGroupId, awayGroupId } = resolveHomeAwayGroupIds(f)
    return [homeGroupId, awayGroupId]
  })
  const groupLabelById = await loadOpponentGroupLabels(supabase, referencedGroupIds)

  const views: ProposalItemView[] = (items ?? []).map((it) => {
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
  return { ok: true, items: views }
}

/** Section 43: apply every non-conflicting placement through the SAME allocateFixture() used for manual drags -- one mutation path, no duplicate apply logic. */
export interface ApplyProposalResult {
  ok: boolean
  error?: string
  appliedCount: number
  failedCount: number
  /** Section 43: never a silent partial failure -- every item that didn't apply is reported with its real reason, not just a count. */
  failures: { fixtureId: string; reason: string }[]
}

export async function applyPitchAllocationProposal(clubId: string, proposalId: string): Promise<ApplyProposalResult> {
  const auth = await requirePitchAllocationAccess(clubId)
  if (!auth.ok) return { ok: false, error: auth.error, appliedCount: 0, failedCount: 0, failures: [] }
  const { supabase, user } = auth

  const { data: proposal } = await supabase.from("pitch_allocation_proposals").select("club_id, status").eq("id", proposalId).maybeSingle()
  if (!proposal || proposal.club_id !== clubId) return { ok: false, error: "Proposal not found.", appliedCount: 0, failedCount: 0, failures: [] }
  if (proposal.status !== "draft") return { ok: false, error: "This proposal has already been applied or discarded.", appliedCount: 0, failedCount: 0, failures: [] }

  const { data: items } = await supabase
    .from("pitch_allocation_proposal_items")
    .select("fixture_id, proposed_pitch_id, proposed_kickoff_time, is_unallocated, conflict_severity")
    .eq("proposal_id", proposalId)

  let appliedCount = 0
  const failures: { fixtureId: string; reason: string }[] = []
  for (const item of items ?? []) {
    if (item.is_unallocated || item.conflict_severity === "hard") continue // never apply a hard-blocked or unallocated item
    const result = await allocateFixture(clubId, item.fixture_id, { pitchId: item.proposed_pitch_id, kickoffTime: item.proposed_kickoff_time ?? undefined })
    if (result.ok) appliedCount++
    else failures.push({ fixtureId: item.fixture_id, reason: result.error ?? "Could not apply this fixture's proposed allocation." })
  }

  await supabase.from("pitch_allocation_proposals").update({ status: "applied", applied_at: new Date().toISOString(), applied_by: user.id }).eq("id", proposalId)

  return { ok: true, appliedCount, failedCount: failures.length, failures }
}

export async function discardPitchAllocationProposal(clubId: string, proposalId: string): Promise<{ ok: boolean; error?: string }> {
  const auth = await requirePitchAllocationAccess(clubId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const { supabase } = auth
  const { error } = await supabase.from("pitch_allocation_proposals").update({ status: "discarded" }).eq("id", proposalId).eq("club_id", clubId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
